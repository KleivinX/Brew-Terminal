//! What the app offers to download, pinned.
//!
//! Nothing here is discovered at runtime. Every entry names an exact URL, an exact byte length
//! and an exact SHA-256, all taken from the publisher's own metadata on 2026-08-29 (GitHub's
//! release asset digests; Hugging Face's LFS `oid`). A download that does not match its entry
//! is deleted rather than used.
//!
//! What that does and does not prove, stated plainly: it proves the bytes are the ones the
//! publisher advertised. It is not a review of the software or the weights, and it is not
//! protection against the publisher themselves. The UI says so before anything is fetched.
//!
//! Pinning also means the app never silently upgrades the engine underneath someone. Moving to
//! a newer llama.cpp build is a code change with a new checksum, which is the point.

use serde::Serialize;

/// The llama.cpp build every engine asset below comes from.
pub const ENGINE_BUILD: &str = "b10687";
pub const ENGINE_PROJECT: &str = "llama.cpp";
pub const ENGINE_LICENCE: &str = "MIT";
pub const ENGINE_SOURCE_URL: &str = "https://github.com/ggml-org/llama.cpp";

/// A downloadable inference engine build for one platform.
#[derive(Debug, Clone, Copy)]
pub struct EngineAsset {
    /// `std::env::consts::OS`
    pub os: &'static str,
    /// `std::env::consts::ARCH`
    pub arch: &'static str,
    pub url: &'static str,
    pub sha256: &'static str,
    pub size_bytes: u64,
    pub archive: ArchiveKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArchiveKind {
    TarGz,
    Zip,
}

/// Engine builds, one per platform this app ships on.
///
/// The Windows entry is the plain CPU build on purpose. The CUDA, ROCm, Vulkan and SYCL builds
/// exist, but each needs a matching driver stack that this app cannot check for, and shipping
/// one that fails to start on the wrong machine is worse than one that is merely slower.
pub const ENGINE_ASSETS: &[EngineAsset] = &[
    EngineAsset {
        os: "macos",
        arch: "aarch64",
        url: "https://github.com/ggml-org/llama.cpp/releases/download/b10687/llama-b10687-bin-macos-arm64.tar.gz",
        sha256: "ad1f407db2b21eb636779ef90c493b327ce55b59ab4fc43ed8197c5c61839b0a",
        size_bytes: 11_027_677,
        archive: ArchiveKind::TarGz,
    },
    EngineAsset {
        os: "macos",
        arch: "x86_64",
        url: "https://github.com/ggml-org/llama.cpp/releases/download/b10687/llama-b10687-bin-macos-x64.tar.gz",
        sha256: "9250762748c64398477725ceb43ed43bfac452a2bb13b6abcada7389bff83fb5",
        size_bytes: 11_091_114,
        archive: ArchiveKind::TarGz,
    },
    EngineAsset {
        os: "linux",
        arch: "x86_64",
        url: "https://github.com/ggml-org/llama.cpp/releases/download/b10687/llama-b10687-bin-ubuntu-x64.tar.gz",
        sha256: "3ea69deaab84792fca5982c975c6bebed4c2c664294b662852602e0be11f09e7",
        size_bytes: 16_384_157,
        archive: ArchiveKind::TarGz,
    },
    EngineAsset {
        os: "windows",
        arch: "x86_64",
        url: "https://github.com/ggml-org/llama.cpp/releases/download/b10687/llama-b10687-bin-win-cpu-x64.zip",
        sha256: "7671db956d077e7f055c7b6b0cf48e58726785212497468d0fc3b40c6aa9adae",
        size_bytes: 18_131_074,
        archive: ArchiveKind::Zip,
    },
];

/// The engine build for the machine this is running on, if there is one.
pub fn engine_for_this_platform() -> Option<&'static EngineAsset> {
    ENGINE_ASSETS
        .iter()
        .find(|asset| asset.os == std::env::consts::OS && asset.arch == std::env::consts::ARCH)
}

/// A model the user can download.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct ModelEntry {
    pub id: &'static str,
    pub name: &'static str,
    /// What it is, in one line, without marketing.
    pub description: &'static str,
    pub parameters: &'static str,
    pub quantisation: &'static str,
    #[cfg_attr(test, ts(type = "number"))]
    pub size_bytes: u64,
    /// Rough working memory needed to run it, weights plus context. An estimate, and labelled
    /// as one in the UI — it depends on context length and what else is running.
    #[cfg_attr(test, ts(type = "number"))]
    pub approx_ram_mb: u32,
    pub licence: &'static str,
    pub publisher: &'static str,
    pub source_url: &'static str,
    #[serde(skip)]
    pub url: &'static str,
    #[serde(skip)]
    pub sha256: &'static str,
    #[serde(skip)]
    pub file_name: &'static str,
}

/// The offered models.
///
/// Chosen to run on the reference machine — a 2016 dual-core Intel MacBook with 8 GB and no
/// usable GPU — rather than to look impressive on a workstation. Everything here is instruction
/// tuned, small, and quantised to Q4_K_M, which is the usual balance point between size and
/// coherence. A model that cannot answer a glossary question on that machine is not useful
/// here regardless of how it benchmarks.
pub const MODELS: &[ModelEntry] = &[
    ModelEntry {
        id: "qwen2.5-0.5b-instruct-q4km",
        name: "Qwen2.5 0.5B Instruct",
        description:
            "The smallest option. Fast on any machine and fine for defining terms, but it \
             loses the thread on longer questions.",
        parameters: "0.5B",
        quantisation: "Q4_K_M",
        size_bytes: 491_400_032,
        approx_ram_mb: 1200,
        licence: "Apache-2.0",
        publisher: "Qwen",
        source_url: "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF",
        url: "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf",
        sha256: "74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db",
        file_name: "qwen2.5-0.5b-instruct-q4_k_m.gguf",
    },
    ModelEntry {
        id: "llama-3.2-1b-instruct-q4km",
        name: "Llama 3.2 1B Instruct",
        description:
            "A good default. Handles a follow-up question and stays readable, and still starts \
             quickly on an older laptop.",
        parameters: "1B",
        quantisation: "Q4_K_M",
        size_bytes: 807_694_464,
        approx_ram_mb: 1800,
        licence: "Llama 3.2 Community License",
        publisher: "Meta, packaged by bartowski",
        source_url: "https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF",
        url: "https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf",
        sha256: "6f85a640a97cf2bf5b8e764087b1e83da0fdb51d7c9fab7d0fece9385611df83",
        file_name: "Llama-3.2-1B-Instruct-Q4_K_M.gguf",
    },
    ModelEntry {
        id: "qwen2.5-1.5b-instruct-q4km",
        name: "Qwen2.5 1.5B Instruct",
        description:
            "The most capable of these, and the slowest. Worth it if your machine has the \
             memory to spare.",
        parameters: "1.5B",
        quantisation: "Q4_K_M",
        size_bytes: 986_048_768,
        approx_ram_mb: 2400,
        licence: "Apache-2.0",
        publisher: "Qwen, packaged by bartowski",
        source_url: "https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF",
        url: "https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf",
        sha256: "1adf0b11065d8ad2e8123ea110d1ec956dab4ab038eab665614adba04b6c3370",
        file_name: "Qwen2.5-1.5B-Instruct-Q4_K_M.gguf",
    },
];

pub fn model_by_id(id: &str) -> Option<&'static ModelEntry> {
    MODELS.iter().find(|model| model.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn is_sha256_hex(value: &str) -> bool {
        value.len() == 64
            && value
                .chars()
                .all(|c| c.is_ascii_hexdigit() && !c.is_uppercase())
    }

    #[test]
    fn every_download_is_https() {
        // The shared client enforces this too. Asserting it here means a bad catalogue entry
        // fails the build rather than at the moment a user presses download.
        for asset in ENGINE_ASSETS {
            assert!(asset.url.starts_with("https://"), "{}", asset.url);
        }
        for model in MODELS {
            assert!(model.url.starts_with("https://"), "{}", model.url);
            assert!(model.source_url.starts_with("https://"), "{}", model.id);
        }
    }

    #[test]
    fn every_entry_pins_a_real_checksum_and_size() {
        for asset in ENGINE_ASSETS {
            assert!(
                is_sha256_hex(asset.sha256),
                "{} has no usable sha256",
                asset.url
            );
            assert!(asset.size_bytes > 0, "{} has no size", asset.url);
        }
        for model in MODELS {
            assert!(
                is_sha256_hex(model.sha256),
                "{} has no usable sha256",
                model.id
            );
            assert!(model.size_bytes > 0, "{} has no size", model.id);
        }
    }

    #[test]
    fn model_ids_are_unique() {
        let mut seen = std::collections::HashSet::new();
        for model in MODELS {
            assert!(seen.insert(model.id), "duplicate model id {}", model.id);
        }
    }

    #[test]
    fn each_platform_appears_at_most_once() {
        let mut seen = std::collections::HashSet::new();
        for asset in ENGINE_ASSETS {
            assert!(
                seen.insert((asset.os, asset.arch)),
                "two engine builds claim {}/{}",
                asset.os,
                asset.arch
            );
        }
    }

    /// The build this test runs on must be able to find its own engine, or the feature is
    /// simply unavailable there and nobody noticed.
    #[test]
    fn this_platform_has_an_engine_build() {
        assert!(
            engine_for_this_platform().is_some(),
            "no engine pinned for {}/{}",
            std::env::consts::OS,
            std::env::consts::ARCH
        );
    }

    #[test]
    fn the_url_filename_matches_the_recorded_one() {
        // A mismatch here would download the right bytes to the wrong name and then fail to
        // find them again.
        for model in MODELS {
            assert!(
                model.url.ends_with(model.file_name),
                "{} downloads {} but records {}",
                model.id,
                model.url,
                model.file_name
            );
        }
    }

    #[test]
    fn every_engine_url_matches_the_pinned_build() {
        for asset in ENGINE_ASSETS {
            assert!(
                asset.url.contains(ENGINE_BUILD),
                "{} is not from build {ENGINE_BUILD}",
                asset.url
            );
        }
    }
}
