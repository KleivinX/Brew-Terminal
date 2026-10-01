//! The two loops that local model inference spends its time in.
//!
//! This is a separate crate for exactly one reason: the app is built with `opt-level = "s"`,
//! which keeps the installer small and also stops the compiler vectorising these loops.
//! Measured on the development machine (a 2017 dual-core i5), the dot product below runs at
//! 2.5 GFLOP/s under `"s"` and 10.5 under `3`, and the reference-fixture run with a 256-candle
//! context went from 6.2 s to 2.8 s when these loops moved here. A per-package profile override
//! (see the workspace `Cargo.toml`) compiles this crate, and only this crate, for speed.
//!
//! ponytail: single-threaded. Rows are independent, so splitting them across
//! `std::thread::scope` threads is the next step if a projection needs to be faster than the
//! 7.8 s it takes on that machine today; it would not change a single output bit.
//!
//! Both functions are `#[inline(never)]` so that link-time optimisation cannot fold them back
//! into a size-optimised caller and undo that.

/// Eight running sums rather than one, so the compiler can vectorise it: a single `f32`
/// accumulator pins the order of the additions, and with it scalar code.
#[inline(never)]
pub fn dot(a: &[f32], b: &[f32]) -> f32 {
    dot_inline(a, b)
}

#[inline(always)]
fn dot_inline(a: &[f32], b: &[f32]) -> f32 {
    let mut acc = [0.0f32; 8];
    let (a8, b8) = (a.chunks_exact(8), b.chunks_exact(8));
    let tail: f32 = a8
        .remainder()
        .iter()
        .zip(b8.remainder())
        .map(|(x, y)| x * y)
        .sum();
    for (x, y) in a8.zip(b8) {
        for i in 0..8 {
            acc[i] += x[i] * y[i];
        }
    }
    acc.iter().sum::<f32>() + tail
}

/// Rows per block. Sixteen rows of a 512-wide layer are 32 KB — a first-level cache.
const BLOCK: usize = 16;

/// A linear layer applied to every `n_in`-wide row of `x`, appended to `out`.
///
/// `weights` is `[n_out, n_in]` row-major, so each output is one contiguous dot product.
/// `bias` is either `n_out` long or empty.
///
/// The loop is weights-outer within a block of input rows. Going row by row instead reads the
/// whole weight matrix — megabytes — from main memory once per row; this way it is read once
/// per sixteen rows while the rows themselves sit in cache. For the context pass, where there
/// are hundreds of rows, that is most of the running time.
#[inline(never)]
pub fn linear(x: &[f32], weights: &[f32], bias: &[f32], n_in: usize, out: &mut Vec<f32>) {
    let n_out = weights.len() / n_in;
    let start = out.len();
    out.resize(start + x.len() / n_in * n_out, 0.0);

    for (b, block) in x.chunks(BLOCK * n_in).enumerate() {
        for (o, w) in weights.chunks_exact(n_in).enumerate() {
            let bias = bias.get(o).copied().unwrap_or(0.0);
            for (r, row) in block.chunks_exact(n_in).enumerate() {
                out[start + (b * BLOCK + r) * n_out + o] = dot_inline(row, w) + bias;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_length_that_is_not_a_multiple_of_eight_is_summed_whole() {
        let a: Vec<f32> = (1..=11).map(|v| v as f32).collect();
        assert_eq!(dot(&a, &a), 506.0);
    }

    #[test]
    fn a_linear_layer_is_one_dot_product_per_output_plus_its_bias() {
        let mut out = Vec::new();
        // Two rows through [[1, 2], [3, 4], [5, 6]], with and without a bias.
        let w = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0];
        linear(&[1.0, 1.0, 2.0, 0.0], &w, &[10.0, 20.0, 30.0], 2, &mut out);
        assert_eq!(out, [13.0, 27.0, 41.0, 12.0, 26.0, 40.0]);

        out.clear();
        linear(&[1.0, 1.0], &w, &[], 2, &mut out);
        assert_eq!(out, [3.0, 7.0, 11.0]);
    }

    #[test]
    fn rows_land_in_order_across_a_block_boundary_and_after_existing_output() {
        // Forty rows is two and a half blocks; the layer is the identity on one input.
        let x: Vec<f32> = (0..40).map(|v| v as f32).collect();
        let mut out = vec![-1.0];
        linear(&x, &[1.0], &[], 1, &mut out);
        assert_eq!(out[0], -1.0);
        assert_eq!(out[1..], x[..]);
    }
}
