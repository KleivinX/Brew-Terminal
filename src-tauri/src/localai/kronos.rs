//! Kronos inference, natively.
//!
//! Kronos is a foundation model for candlestick data: a tokenizer turns each OHLCV candle into
//! two 10-bit tokens, and a decoder-only transformer continues the token sequence. This module
//! is a Rust port of the *inference* path of the reference implementation — nothing here
//! trains, and nothing here is this project's own modelling.
//!
//! Portions derived from Kronos (<https://github.com/shiyu-coder/Kronos>), `model/kronos.py`
//! and `model/module.py`, Copyright (c) 2025 ShiYu, MIT License. The full notice is in
//! `docs/THIRD_PARTY_NOTICES.md`. The weights are not shipped: the user downloads them from the
//! publisher, pinned by checksum in `catalogue.rs`.
//!
//! Why a port rather than running the original: the original needs Python, PyTorch and pandas.
//! Fetching and executing an unpinned interpreter stack is exactly what `localai` exists to
//! not do, and most of the people this app is for do not have Python installed. The forward
//! pass is linear layers, RMSNorm, rotary attention and embedding lookups, which is a few
//! hundred lines with no dependency this crate did not already have.
//!
//! How it is known to be right: upstream ships a deterministic regression fixture (greedy
//! decoding, pinned model revisions, expected output committed). `tests/kronos_parity.rs`
//! runs this code on the same input and requires the same numbers to upstream's own tolerance.
//!
//! Everything is `f32` on the CPU, single-threaded, with a key/value cache so that producing
//! one more candle costs one token of work rather than a whole pass over the context, and
//! with every sampled path stepping together so the weights are read once per step. The two
//! loops that dominate live in the `brew-kernel` crate, which is compiled for speed while this
//! one is compiled for size.

use std::collections::HashMap;
use std::path::Path;

use brew_kernel::dot;

use crate::error::{AppError, AppResult};

/// Open, high, low, close, volume, amount — the column order the model was trained on.
pub const FEATURES: usize = 6;
/// Minute, hour, weekday (Monday = 0), day of month, month.
pub type Stamp = [usize; 5];
/// The coarse and the fine token for one candle.
type Token = (usize, usize);

const RMS_EPS: f32 = 1e-5;
/// Normalised inputs are clipped to this many standard deviations, as upstream does.
const CLIP: f32 = 5.0;

fn bad_weights(detail: impl std::fmt::Display) -> AppError {
    tracing::warn!(%detail, "the Kronos weights could not be used");
    AppError::Storage("The model file is not a Kronos model this version can read.".into())
}

// ---------------------------------------------------------------------------------------------
// Weights
// ---------------------------------------------------------------------------------------------

/// The `F32` tensors of a `.safetensors` file, by name.
///
/// The format is an 8-byte little-endian header length, a JSON header mapping each tensor name
/// to its dtype, shape and byte range, then the raw data. The file has already passed its
/// checksum by the time it gets here, but every offset is still bounds-checked: a checksum
/// proves the bytes are the publisher's, not that they are well formed.
struct Tensors(HashMap<String, (Vec<usize>, Vec<f32>)>);

impl Tensors {
    fn load(path: &Path) -> AppResult<Self> {
        let bytes = std::fs::read(path).map_err(bad_weights)?;
        Self::parse(&bytes)
    }

    fn parse(bytes: &[u8]) -> AppResult<Self> {
        let header_len = bytes
            .get(..8)
            .map(|b| u64::from_le_bytes(b.try_into().expect("8 bytes")) as usize)
            .ok_or_else(|| bad_weights("shorter than its header length"))?;
        let data_start = 8usize
            .checked_add(header_len)
            .filter(|end| *end <= bytes.len())
            .ok_or_else(|| bad_weights("header runs past the end of the file"))?;
        let header: HashMap<String, serde_json::Value> =
            serde_json::from_slice(&bytes[8..data_start]).map_err(bad_weights)?;
        let data = &bytes[data_start..];

        let mut out = HashMap::new();
        for (name, entry) in header {
            // `__metadata__` has no dtype; the two I64 buffers upstream stores are not needed.
            if entry["dtype"] != "F32" {
                continue;
            }
            let shape: Vec<usize> =
                serde_json::from_value(entry["shape"].clone()).map_err(bad_weights)?;
            let [begin, end]: [usize; 2] =
                serde_json::from_value(entry["data_offsets"].clone()).map_err(bad_weights)?;
            // Checked: a header claiming an absurd shape must not wrap round to a size that
            // happens to match.
            let expected = shape.iter().try_fold(4usize, |n, dim| n.checked_mul(*dim));
            let raw = data
                .get(begin..end)
                .filter(|raw| Some(raw.len()) == expected)
                .ok_or_else(|| bad_weights(format!("{name} has an impossible byte range")))?;
            let values = raw
                .chunks_exact(4)
                .map(|b| f32::from_le_bytes(b.try_into().expect("4 bytes")))
                .collect();
            out.insert(name, (shape, values));
        }
        Ok(Self(out))
    }

    fn take(&mut self, name: &str) -> AppResult<(Vec<usize>, Vec<f32>)> {
        self.0
            .remove(name)
            .ok_or_else(|| bad_weights(format!("{name} is missing")))
    }

    fn vector(&mut self, name: &str) -> AppResult<Vec<f32>> {
        Ok(self.take(name)?.1)
    }

    /// A `[rows, width]` table, returned with its width.
    fn table(&mut self, name: &str) -> AppResult<(Vec<f32>, usize)> {
        let (shape, values) = self.take(name)?;
        match shape[..] {
            [_, width] if width > 0 => Ok((values, width)),
            _ => Err(bad_weights(format!("{name} is not a table"))),
        }
    }

    fn linear(&mut self, prefix: &str, bias: bool) -> AppResult<Linear> {
        let (w, n_in) = self.table(&format!("{prefix}.weight"))?;
        let b = if bias {
            self.vector(&format!("{prefix}.bias"))?
        } else {
            Vec::new()
        };
        Ok(Linear { w, b, n_in })
    }

    /// How many `prefix.0`, `prefix.1`, … layers the file holds.
    fn count(&self, prefix: &str) -> usize {
        (0..)
            .take_while(|i| self.0.contains_key(&format!("{prefix}.{i}.norm1.weight")))
            .count()
    }
}

// ---------------------------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------------------------

struct Linear {
    /// `[n_out, n_in]`, row-major, so each output is one contiguous dot product.
    w: Vec<f32>,
    /// Empty when the layer has no bias.
    b: Vec<f32>,
    n_in: usize,
}

impl Linear {
    /// Applies the layer to every `n_in`-wide row of `x`.
    fn apply(&self, x: &[f32]) -> Vec<f32> {
        let mut out = Vec::new();
        brew_kernel::linear(x, &self.w, &self.b, self.n_in, &mut out);
        out
    }
}

fn rms_norm(x: &[f32], weight: &[f32]) -> Vec<f32> {
    let mut out = Vec::with_capacity(x.len());
    for row in x.chunks_exact(weight.len()) {
        let scale = (dot(row, row) / row.len() as f32 + RMS_EPS).sqrt().recip();
        out.extend(row.iter().zip(weight).map(|(v, w)| v * scale * w));
    }
    out
}

fn softmax(values: &mut [f32]) {
    let max = values.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let mut sum = 0.0;
    for v in values.iter_mut() {
        *v = (*v - max).exp();
        sum += *v;
    }
    for v in values.iter_mut() {
        *v /= sum;
    }
}

/// Keys and values already computed for earlier rows, `[rows, d_model]` each.
#[derive(Clone, Default)]
struct Cache {
    k: Vec<f32>,
    v: Vec<f32>,
}

/// One query row attending over every cached row, head by head.
fn attend(q: &[f32], cache: &Cache, rows: usize, heads: usize, out: &mut Vec<f32>) {
    let d = q.len();
    let head_dim = d / heads;
    let scale = (head_dim as f32).sqrt().recip();
    let mut scores = vec![0.0f32; rows];

    for h in 0..heads {
        let span = h * head_dim..(h + 1) * head_dim;
        for (j, score) in scores.iter_mut().enumerate() {
            *score = dot(&q[span.clone()], &cache.k[j * d..][span.clone()]) * scale;
        }
        softmax(&mut scores);

        let start = out.len();
        out.resize(start + head_dim, 0.0);
        for (j, p) in scores.iter().enumerate() {
            let v = &cache.v[j * d..][span.clone()];
            for (o, v) in out[start..].iter_mut().zip(v) {
                *o += p * v;
            }
        }
    }
}

/// Pre-norm transformer block: causal self-attention with rotary positions, then a gated
/// feed-forward (`w2(silu(w1 x) * w3 x)`).
struct Block {
    norm1: Vec<f32>,
    q: Linear,
    k: Linear,
    v: Linear,
    out: Linear,
    inv_freq: Vec<f32>,
    norm2: Vec<f32>,
    w1: Linear,
    w2: Linear,
    w3: Linear,
}

impl Block {
    fn load(t: &mut Tensors, prefix: &str) -> AppResult<Self> {
        let attn = format!("{prefix}.self_attn");
        let block = Self {
            norm1: t.vector(&format!("{prefix}.norm1.weight"))?,
            q: t.linear(&format!("{attn}.q_proj"), true)?,
            k: t.linear(&format!("{attn}.k_proj"), true)?,
            v: t.linear(&format!("{attn}.v_proj"), true)?,
            out: t.linear(&format!("{attn}.out_proj"), true)?,
            inv_freq: t.vector(&format!("{attn}.rotary.inv_freq"))?,
            norm2: t.vector(&format!("{prefix}.norm2.weight"))?,
            w1: t.linear(&format!("{prefix}.ffn.w1"), false)?,
            w2: t.linear(&format!("{prefix}.ffn.w2"), false)?,
            w3: t.linear(&format!("{prefix}.ffn.w3"), false)?,
        };
        // The head count is derived from these two lengths, so they have to divide.
        let (d, pair) = (block.norm1.len(), 2 * block.inv_freq.len());
        if pair == 0 || d == 0 || d % pair != 0 {
            return Err(bad_weights(format!("{prefix} has an unexpected shape")));
        }
        Ok(block)
    }

    /// Rotates each head of one row by its position. `x' = x·cos + rotate_half(x)·sin`.
    fn rotate(&self, row: &mut [f32], pos: usize) {
        let half = self.inv_freq.len();
        for head in row.chunks_exact_mut(2 * half) {
            for (j, freq) in self.inv_freq.iter().enumerate() {
                let (sin, cos) = (pos as f32 * freq).sin_cos();
                let (a, b) = (head[j], head[j + half]);
                head[j] = a * cos - b * sin;
                head[j + half] = b * cos + a * sin;
            }
        }
    }

    /// Runs the new rows in `x` through the block, in place.
    ///
    /// Each cache holds the earlier positions of one sequence. Because attention is causal,
    /// their outputs never depend on what comes after, so they are not recomputed — with an
    /// empty cache this is an ordinary full forward pass.
    ///
    /// The rows are either all one sequence's (one cache: a context being read in order) or
    /// one row from each of several sequences (a cache apiece: every sampled path taking its
    /// next step together). The second form is what makes sampling affordable: the linear
    /// layers run once over all the paths, so each weight matrix is read from memory once per
    /// step instead of once per path.
    fn forward(&self, x: &mut [f32], caches: &mut [&mut Cache]) {
        let d = self.norm1.len();
        let heads = d / (2 * self.inv_freq.len());
        debug_assert!(caches.len() == 1 || caches.len() == x.len() / d);

        let h = rms_norm(x, &self.norm1);
        let (mut q, mut k, v) = (self.q.apply(&h), self.k.apply(&h), self.v.apply(&h));

        let mut mixed = Vec::with_capacity(x.len());
        let rows = q
            .chunks_exact_mut(d)
            .zip(k.chunks_exact_mut(d))
            .zip(v.chunks_exact(d));
        for (i, ((q, k), v)) in rows.enumerate() {
            // One cache: every row goes to it. Several: row `i` goes to cache `i`.
            let cache = &mut *caches[i.min(caches.len() - 1)];
            let pos = cache.k.len() / d;
            self.rotate(q, pos);
            self.rotate(k, pos);
            cache.k.extend_from_slice(k);
            cache.v.extend_from_slice(v);
            attend(q, cache, pos + 1, heads, &mut mixed);
        }
        for (x, a) in x.iter_mut().zip(self.out.apply(&mixed)) {
            *x += a;
        }

        let h = rms_norm(x, &self.norm2);
        let gate = self.w3.apply(&h);
        let hidden: Vec<f32> = self
            .w1
            .apply(&h)
            .iter()
            .zip(gate)
            .map(|(a, g)| a / (1.0 + (-a).exp()) * g)
            .collect();
        for (x, f) in x.iter_mut().zip(self.w2.apply(&hidden)) {
            *x += f;
        }
    }
}

fn blocks(t: &mut Tensors, prefix: &str) -> AppResult<Vec<Block>> {
    (0..t.count(prefix))
        .map(|i| Block::load(t, &format!("{prefix}.{i}")))
        .collect()
}

/// Runs `x` through `blocks`, each continuing from its cache.
fn run(blocks: &[Block], caches: &mut [Cache], mut x: Vec<f32>) -> Vec<f32> {
    for (block, cache) in blocks.iter().zip(caches) {
        block.forward(&mut x, &mut [cache]);
    }
    x
}

fn empty_caches(blocks: &[Block]) -> Vec<Cache> {
    vec![Cache::default(); blocks.len()]
}

// ---------------------------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------------------------

/// Candles to tokens and back. Quantisation is by sign: each of the 20 latent dimensions
/// becomes one bit, the first ten forming the coarse token and the last ten the fine one.
pub struct Tokenizer {
    embed: Linear,
    encoder: Vec<Block>,
    quant: Linear,
    post_quant: Linear,
    decoder: Vec<Block>,
    head: Linear,
    s1_bits: usize,
}

impl Tokenizer {
    pub fn load(path: &Path) -> AppResult<Self> {
        let mut t = Tensors::load(path)?;
        let tokenizer = Self {
            embed: t.linear("embed", true)?,
            encoder: blocks(&mut t, "encoder")?,
            quant: t.linear("quant_embed", true)?,
            // Width of the coarse half, read off the layer that decodes it alone.
            s1_bits: t.table("post_quant_embed_pre.weight")?.1,
            post_quant: t.linear("post_quant_embed", true)?,
            decoder: blocks(&mut t, "decoder")?,
            head: t.linear("head", true)?,
        };
        if tokenizer.embed.n_in != FEATURES || tokenizer.post_quant.n_in <= tokenizer.s1_bits {
            return Err(bad_weights("the tokenizer has an unexpected shape"));
        }
        Ok(tokenizer)
    }

    fn bits(&self) -> usize {
        self.post_quant.n_in
    }

    fn encode(&self, x: &[f32]) -> Vec<Token> {
        let mut caches = empty_caches(&self.encoder);
        let z = self
            .quant
            .apply(&run(&self.encoder, &mut caches, self.embed.apply(x)));
        let index = |bits: &[f32]| {
            bits.iter()
                .enumerate()
                .fold(0, |acc, (i, bit)| acc | usize::from(*bit > 0.0) << i)
        };
        z.chunks_exact(self.bits())
            .map(|row| (index(&row[..self.s1_bits]), index(&row[self.s1_bits..])))
            .collect()
    }

    /// Decodes `tokens` as the continuation of whatever `caches` has already decoded.
    ///
    /// The decoder is causal too, so the context — identical for every sampled path — is
    /// decoded once and each path only pays for its own new candles.
    fn decode(&self, caches: &mut [Cache], tokens: &[Token]) -> Vec<f32> {
        let scale = (self.bits() as f32).sqrt().recip();
        let mut latent = Vec::with_capacity(tokens.len() * self.bits());
        for (s1, s2) in tokens {
            for (index, width) in [(s1, self.s1_bits), (s2, self.bits() - self.s1_bits)] {
                latent.extend((0..width).map(|i| if index >> i & 1 == 1 { scale } else { -scale }));
            }
        }
        self.head
            .apply(&run(&self.decoder, caches, self.post_quant.apply(&latent)))
    }
}

// ---------------------------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------------------------

pub struct Kronos {
    emb_s1: Vec<f32>,
    emb_s2: Vec<f32>,
    fusion: Linear,
    /// Minute, hour, weekday, day, month — the order of a [`Stamp`].
    time: [Vec<f32>; 5],
    blocks: Vec<Block>,
    norm: Vec<f32>,
    dep_q: Linear,
    dep_k: Linear,
    dep_v: Linear,
    dep_out: Linear,
    dep_heads: usize,
    dep_norm: Vec<f32>,
    head_s1: Linear,
    head_s2: Linear,
}

/// Everything the model has computed for the candles fed so far.
#[derive(Clone)]
struct State {
    layers: Vec<Cache>,
    /// Keys and values of the final hidden states, for the fine-token step.
    dep: Cache,
    /// The final hidden state of the most recent candle.
    last: Vec<f32>,
}

impl Kronos {
    pub fn load(path: &Path) -> AppResult<Self> {
        let mut t = Tensors::load(path)?;
        let dep = "dep_layer.cross_attn";
        let dep_freqs = t.vector(&format!("{dep}.rotary.inv_freq"))?.len();
        let time = ["minute", "hour", "weekday", "day", "month"]
            .map(|unit| t.vector(&format!("time_emb.{unit}_embed.weight")));
        let [minute, hour, weekday, day, month] = time;

        let model = Self {
            emb_s1: t.vector("embedding.emb_s1.weight")?,
            emb_s2: t.vector("embedding.emb_s2.weight")?,
            fusion: t.linear("embedding.fusion_proj", true)?,
            time: [minute?, hour?, weekday?, day?, month?],
            blocks: blocks(&mut t, "transformer")?,
            norm: t.vector("norm.weight")?,
            dep_q: t.linear(&format!("{dep}.q_proj"), true)?,
            dep_k: t.linear(&format!("{dep}.k_proj"), true)?,
            dep_v: t.linear(&format!("{dep}.v_proj"), true)?,
            dep_out: t.linear(&format!("{dep}.out_proj"), true)?,
            dep_heads: 0,
            dep_norm: t.vector("dep_layer.norm.weight")?,
            head_s1: t.linear("head.proj_s1", true)?,
            head_s2: t.linear("head.proj_s2", true)?,
        };
        let d = model.norm.len();
        if d == 0 || dep_freqs == 0 || model.blocks.is_empty() || model.fusion.n_in != 2 * d {
            return Err(bad_weights("the model has an unexpected shape"));
        }
        Ok(Self {
            dep_heads: d / (2 * dep_freqs),
            ..model
        })
    }

    fn d(&self) -> usize {
        self.norm.len()
    }

    fn fresh(&self) -> State {
        State {
            layers: vec![Cache::default(); self.blocks.len()],
            dep: Cache::default(),
            last: Vec::new(),
        }
    }

    /// Feeds candles (as tokens, with their timestamps) into the model.
    ///
    /// Either every candle belongs to the one state given, in order, or there is one candle
    /// for each of several states — see [`Block::forward`].
    fn feed(&self, states: &mut [State], tokens: &[Token], stamps: &[Stamp]) {
        let d = self.d();
        let scale = (d as f32).sqrt();
        assert!(states.len() == 1 || states.len() == tokens.len());

        let mut pairs = Vec::with_capacity(tokens.len() * 2 * d);
        for (s1, s2) in tokens {
            pairs.extend(self.emb_s1[s1 * d..(s1 + 1) * d].iter().map(|v| v * scale));
            pairs.extend(self.emb_s2[s2 * d..(s2 + 1) * d].iter().map(|v| v * scale));
        }
        let mut x = self.fusion.apply(&pairs);
        for (x, stamp) in x.chunks_exact_mut(d).zip(stamps) {
            // Upstream's order of addition: hour, weekday, day, month, minute.
            for unit in [1, 2, 3, 4, 0] {
                let embedding = &self.time[unit][stamp[unit] * d..];
                for (x, e) in x.iter_mut().zip(embedding) {
                    *x += e;
                }
            }
        }

        for (layer, block) in self.blocks.iter().enumerate() {
            let mut caches: Vec<&mut Cache> =
                states.iter_mut().map(|s| &mut s.layers[layer]).collect();
            block.forward(&mut x, &mut caches);
        }

        let x = rms_norm(&x, &self.norm);
        let (keys, values) = (self.dep_k.apply(&x), self.dep_v.apply(&x));
        let last = states.len() - 1;
        for (i, row) in x.chunks_exact(d).enumerate() {
            let state = &mut states[i.min(last)];
            state.dep.k.extend_from_slice(&keys[i * d..(i + 1) * d]);
            state.dep.v.extend_from_slice(&values[i * d..(i + 1) * d]);
            state.last = row.to_vec();
        }
    }

    /// The next candle's two tokens for each state: the coarse one from the last hidden state,
    /// then the fine one conditioned on the coarse one just chosen.
    fn next(&self, states: &[State], pick: &mut impl FnMut(&mut [f32]) -> usize) -> Vec<Token> {
        let d = self.d();
        let last: Vec<f32> = states.iter().flat_map(|s| s.last.iter().copied()).collect();

        let mut logits = self.head_s1.apply(&last);
        let vocab = logits.len() / states.len();
        let coarse: Vec<usize> = logits.chunks_exact_mut(vocab).map(&mut *pick).collect();

        // Each query is a single row at position zero, where the rotary rotation is the
        // identity — so, as in upstream at inference, no rotation is applied on either side.
        let siblings: Vec<f32> = coarse
            .iter()
            .flat_map(|s1| self.emb_s1[s1 * d..(s1 + 1) * d].iter().copied())
            .collect();
        let mut mixed = Vec::with_capacity(last.len());
        for (query, state) in self.dep_q.apply(&siblings).chunks_exact(d).zip(states) {
            let rows = state.dep.k.len() / d;
            attend(query, &state.dep, rows, self.dep_heads, &mut mixed);
        }

        let mut x = self.dep_out.apply(&mixed);
        for (x, h) in x.iter_mut().zip(&last) {
            *x += h;
        }
        let mut logits = self.head_s2.apply(&rms_norm(&x, &self.dep_norm));
        let vocab = logits.len() / states.len();
        let fine = logits.chunks_exact_mut(vocab).map(&mut *pick);
        coarse.iter().copied().zip(fine).collect()
    }
}

// ---------------------------------------------------------------------------------------------
// Sampling and prediction
// ---------------------------------------------------------------------------------------------

/// How the next token is chosen.
#[derive(Debug, Clone, Copy)]
pub enum Sampling {
    /// Always the most likely token. One path, fully deterministic — what upstream's regression
    /// fixture uses, and so what the parity test uses.
    Greedy,
    /// Draws from the smallest set of tokens whose probability reaches `top_p`, `paths` times
    /// over. The seed is fixed by the caller, so the same candles give the same paths.
    Nucleus {
        temperature: f32,
        top_p: f32,
        paths: usize,
        seed: u64,
    },
}

/// SplitMix64. A statistical generator is all sampling needs, and owning the six lines means
/// the paths are reproducible across platforms and releases rather than tied to a crate's
/// stream.
fn uniform(state: &mut u64) -> f32 {
    *state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    ((z ^ (z >> 31)) >> 40) as f32 / (1u64 << 24) as f32
}

fn argmax(values: &[f32]) -> usize {
    (0..values.len())
        .max_by(|a, b| values[*a].total_cmp(&values[*b]))
        .unwrap_or(0)
}

/// Nucleus sampling, as upstream's `top_k_top_p_filtering` followed by a multinomial draw: the
/// token that crosses `top_p` is kept, and everything after it is dropped.
fn nucleus(logits: &mut [f32], temperature: f32, top_p: f32, rng: &mut u64) -> usize {
    for v in logits.iter_mut() {
        *v /= temperature;
    }
    softmax(logits);
    let mut order: Vec<usize> = (0..logits.len()).collect();
    order.sort_by(|a, b| logits[*b].total_cmp(&logits[*a]));

    let mut kept = 0.0;
    let mut cut = order.len();
    for (rank, index) in order.iter().enumerate() {
        kept += logits[*index];
        if kept > top_p {
            cut = rank + 1;
            break;
        }
    }

    let mut target = uniform(rng) * order[..cut].iter().map(|i| logits[*i]).sum::<f32>();
    for index in &order[..cut] {
        target -= logits[*index];
        if target <= 0.0 {
            return *index;
        }
    }
    order[cut - 1]
}

/// Continues `candles` by `stamps_ahead.len()` candles.
///
/// Returns one path per sample, each `[candle][feature]` in the input's own units. Mirrors
/// upstream's `KronosPredictor.predict`: per-column z-score over the context, clip, tokenize,
/// generate, decode, undo the z-score.
///
/// While context plus generated candles fit in `max_context` the window never moves, so each
/// new candle reuses everything already computed. Past that the window slides, every position
/// shifts, and the pass is redone from scratch each step — correct, and slow, which is why the
/// caller keeps requests inside the window.
pub fn predict(
    tokenizer: &Tokenizer,
    model: &Kronos,
    candles: &[[f32; FEATURES]],
    stamps: &[Stamp],
    stamps_ahead: &[Stamp],
    max_context: usize,
    sampling: Sampling,
) -> Vec<Vec<[f32; FEATURES]>> {
    assert_eq!(candles.len(), stamps.len(), "one timestamp per candle");
    assert!(!candles.is_empty() && max_context > 0);

    let n = candles.len() as f64;
    let mut mean = [0.0f32; FEATURES];
    let mut std = [0.0f32; FEATURES];
    for f in 0..FEATURES {
        let m = candles.iter().map(|c| c[f] as f64).sum::<f64>() / n;
        let var = candles
            .iter()
            .map(|c| (c[f] as f64 - m).powi(2))
            .sum::<f64>()
            / n;
        mean[f] = m as f32;
        std[f] = var.sqrt() as f32 + 1e-5;
    }
    let x: Vec<f32> = candles
        .iter()
        .flat_map(|c| (0..FEATURES).map(|f| ((c[f] - mean[f]) / std[f]).clamp(-CLIP, CLIP)))
        .collect();

    let context = tokenizer.encode(&x);
    let all_stamps = [stamps, stamps_ahead].concat();
    let steps = stamps_ahead.len();

    let (paths, mut rng) = match sampling {
        Sampling::Greedy => (1, 0),
        Sampling::Nucleus { paths, seed, .. } => (paths.max(1), seed),
    };
    let mut pick = |logits: &mut [f32]| match sampling {
        Sampling::Greedy => argmax(logits),
        Sampling::Nucleus {
            temperature, top_p, ..
        } => nucleus(logits, temperature, top_p, &mut rng),
    };

    // The context is the same for every path, so it is run once and copied.
    // ponytail: each path owns a whole copy of the context's cache, about 7 MB for Kronos-small
    // at 180 candles. Sharing the prefix and keeping only each path's own suffix is the upgrade
    // if the path count or the context grows.
    let window = context.len().min(max_context);
    let mut shared = model.fresh();
    model.feed(
        std::slice::from_mut(&mut shared),
        &context[context.len() - window..],
        &stamps[stamps.len() - window..],
    );
    let mut states = vec![shared; paths];
    let mut tokens = vec![context.clone(); paths];

    for step in 0..steps {
        let picked = model.next(&states, &mut pick);
        for (tokens, token) in tokens.iter_mut().zip(&picked) {
            tokens.push(*token);
        }

        let len = context.len() + step + 1;
        if len <= max_context {
            // Every path takes its step together: one candle each, all at the same time.
            model.feed(&mut states, &picked, &vec![all_stamps[len - 1]; paths]);
        } else {
            for (state, tokens) in states.iter_mut().zip(&tokens) {
                *state = model.fresh();
                model.feed(
                    std::slice::from_mut(state),
                    &tokens[len - max_context..],
                    &all_stamps[len - max_context..len],
                );
            }
        }
    }

    // Inside the window the decoder has the same context under every path, so it is decoded
    // once. Past it, each path's window starts somewhere different and is decoded whole.
    let total = context.len() + steps;
    let from = if total <= max_context {
        context.len()
    } else {
        total - max_context
    };
    let mut decoded_context = empty_caches(&tokenizer.decoder);
    if total <= max_context {
        tokenizer.decode(&mut decoded_context, &context);
    }

    tokens
        .iter()
        .map(|tokens| {
            let decoded = tokenizer.decode(&mut decoded_context.clone(), &tokens[from..]);
            decoded[decoded.len() - steps * FEATURES..]
                .chunks_exact(FEATURES)
                .map(|row| std::array::from_fn(|f| row[f] * std[f] + mean[f]))
                .collect()
        })
        .collect()
}

/// The calendar fields the model embeds, read in UTC.
pub fn stamp(epoch_secs: i64) -> Stamp {
    use chrono::{Datelike, Timelike};
    let at = chrono::DateTime::from_timestamp(epoch_secs, 0).unwrap_or_default();
    [
        at.minute() as usize,
        at.hour() as usize,
        at.weekday().num_days_from_monday() as usize,
        at.day() as usize,
        at.month() as usize,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_timestamp_becomes_the_fields_the_model_embeds() {
        // 2024-06-18 11:15 UTC was a Tuesday.
        assert_eq!(stamp(1_718_709_300), [15, 11, 1, 18, 6]);
    }

    #[test]
    fn nucleus_sampling_never_leaves_the_nucleus() {
        // Probabilities ≈ 0.64, 0.24, 0.09, 0.03: a top_p of 0.7 keeps the first two only.
        let mut rng = 7;
        for _ in 0..500 {
            let mut logits = [3.0, 2.0, 1.0, 0.0];
            assert!(nucleus(&mut logits, 1.0, 0.7, &mut rng) < 2);
        }
    }

    #[test]
    fn the_same_seed_draws_the_same_tokens() {
        let draw = |mut rng: u64| -> Vec<usize> {
            (0..50)
                .map(|_| nucleus(&mut [1.0, 1.0, 1.0, 1.0], 1.0, 1.0, &mut rng))
                .collect()
        };
        assert_eq!(draw(42), draw(42));
        assert_ne!(draw(42), draw(43));
    }

    #[test]
    fn a_malformed_weights_file_is_refused_rather_than_read_out_of_bounds() {
        let file = |header: &str, data: &[u8]| {
            let mut bytes = (header.len() as u64).to_le_bytes().to_vec();
            bytes.extend(header.as_bytes());
            bytes.extend(data);
            bytes
        };
        let good = r#"{"w":{"dtype":"F32","shape":[1,2],"data_offsets":[0,8]}}"#;
        let past_end = r#"{"w":{"dtype":"F32","shape":[1,2],"data_offsets":[0,80]}}"#;
        let wrong_size = r#"{"w":{"dtype":"F32","shape":[3,2],"data_offsets":[0,8]}}"#;
        let data = [1.0f32.to_le_bytes(), 2.0f32.to_le_bytes()].concat();

        let mut parsed = Tensors::parse(&file(good, &data)).unwrap();
        assert_eq!(parsed.table("w").unwrap(), (vec![1.0, 2.0], 2));

        let overflowing = format!(
            r#"{{"w":{{"dtype":"F32","shape":[{},2],"data_offsets":[0,8]}}}}"#,
            usize::MAX / 2 + 1
        );
        assert!(Tensors::parse(&file(&overflowing, &data)).is_err());
        assert!(Tensors::parse(&file(past_end, &data)).is_err());
        assert!(Tensors::parse(&file(wrong_size, &data)).is_err());
        assert!(Tensors::parse(&[1, 2, 3]).is_err());
        assert!(Tensors::parse(&u64::MAX.to_le_bytes()).is_err());
    }
}
