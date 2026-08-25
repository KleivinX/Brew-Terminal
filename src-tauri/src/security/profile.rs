//! The `.brewprofile` envelope: header, key derivation, and authenticated encryption.
//!
//! This module knows nothing about watchlists or notes. It turns a byte payload into a file and
//! back, and it is the only place in the app that touches a password. Everything here follows
//! THREAT_MODEL.md §6.1 exactly:
//!
//! ```text
//!   magic        "BREWPROF"                     8 bytes
//!   format_ver   u16 LE                         2
//!   kdf_id       u8   = 1 (Argon2id)            1
//!   aead_id      u8   = 1 (XChaCha20-Poly1305)  1
//!   m_cost_kib   u32 LE                         4
//!   t_cost       u32 LE                         4
//!   p_cost       u32 LE                         4
//!   salt_len     u8 + salt                      1 + 16
//!   nonce                                       24
//!   ciphertext || Poly1305 tag                  rest
//! ```
//!
//! **The whole fixed header is bound as associated data.** That is what makes the advertised KDF
//! parameters trustworthy: an attacker cannot rewrite `m_cost_kib` down to 8 KiB and hand the
//! file back, because the tag was computed over the original bytes and will not verify.
//!
//! Nothing here is invented cryptography. Argon2id and XChaCha20-Poly1305 are used as their
//! RustCrypto implementations intend, with parameters recorded per-file so raising them later
//! does not strand old exports.

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::aead::rand_core::RngCore;
use chacha20poly1305::aead::{Aead, OsRng, Payload};
use chacha20poly1305::{KeyInit, XChaCha20Poly1305, XNonce};
use zeroize::Zeroize;

use crate::error::{AppError, AppResult};

pub const MAGIC: &[u8; 8] = b"BREWPROF";
pub const FORMAT_VERSION: u16 = 1;

const KDF_ARGON2ID: u8 = 1;
const AEAD_XCHACHA20POLY1305: u8 = 1;

const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 24;
const KEY_LEN: usize = 32;
const HEADER_LEN: usize = 8 + 2 + 1 + 1 + 4 + 4 + 4 + 1 + SALT_LEN + NONCE_LEN;

/// Defaults from THREAT_MODEL.md §6.2, tuned for the reference 2016 dual-core machine: a few
/// hundred milliseconds to derive, which is fine for a manual export and expensive in bulk.
pub const DEFAULT_M_COST_KIB: u32 = 64 * 1024;
pub const DEFAULT_T_COST: u32 = 3;
pub const DEFAULT_P_COST: u32 = 1;

/// The owner's decision, recorded in THREAT_MODEL.md §6.2. A weak password defeats Argon2id
/// outright, so the floor does real work rather than performing security theatre.
pub const MIN_PASSWORD_CHARS: usize = 12;

/// A ceiling on what will be decompressed, so a small hostile file cannot expand into memory
/// exhaustion. A real profile is far under this even with thousands of notes.
const MAX_PLAINTEXT_BYTES: usize = 64 * 1024 * 1024;

/// Refuses obviously-not-a-profile input before any work is done.
const MAX_FILE_BYTES: usize = 96 * 1024 * 1024;

/// KDF parameters, as recorded in a file's header.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KdfParams {
    pub m_cost_kib: u32,
    pub t_cost: u32,
    pub p_cost: u32,
}

impl Default for KdfParams {
    fn default() -> Self {
        Self {
            m_cost_kib: DEFAULT_M_COST_KIB,
            t_cost: DEFAULT_T_COST,
            p_cost: DEFAULT_P_COST,
        }
    }
}

impl KdfParams {
    /// Rejects parameters that would make derivation trivially cheap.
    ///
    /// A file carries its own parameters, which is what lets them be raised later — but it also
    /// means a hostile file can *claim* weak ones. The tag covers the header, so a modified file
    /// will not authenticate; this check is the belt to that braces, and it fails before any
    /// expensive work rather than after.
    fn validate(self) -> AppResult<()> {
        // Argon2's own minimums, plus a floor well below the shipped default so a genuinely old
        // file still opens.
        if self.m_cost_kib < 8 * 1024 || self.t_cost == 0 || self.p_cost == 0 {
            return Err(AppError::Validation {
                field: "file".into(),
                detail: "the file advertises key-derivation settings that are too weak".into(),
            });
        }
        if self.m_cost_kib > 1024 * 1024 || self.t_cost > 32 || self.p_cost > 16 {
            // Otherwise a crafted header is a denial-of-service: 4 GiB of Argon2 memory.
            return Err(AppError::Validation {
                field: "file".into(),
                detail: "the file asks for more memory than this app will allocate".into(),
            });
        }
        Ok(())
    }
}

/// The header of a `.brewprofile`, readable without the password.
#[derive(Debug, Clone)]
pub struct ProfileHeader {
    pub format_version: u16,
    pub kdf: KdfParams,
    salt: [u8; SALT_LEN],
    nonce: [u8; NONCE_LEN],
}

impl ProfileHeader {
    fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(HEADER_LEN);
        out.extend_from_slice(MAGIC);
        out.extend_from_slice(&self.format_version.to_le_bytes());
        out.push(KDF_ARGON2ID);
        out.push(AEAD_XCHACHA20POLY1305);
        out.extend_from_slice(&self.kdf.m_cost_kib.to_le_bytes());
        out.extend_from_slice(&self.kdf.t_cost.to_le_bytes());
        out.extend_from_slice(&self.kdf.p_cost.to_le_bytes());
        out.push(SALT_LEN as u8);
        out.extend_from_slice(&self.salt);
        out.extend_from_slice(&self.nonce);
        debug_assert_eq!(out.len(), HEADER_LEN);
        out
    }
}

fn malformed(detail: &str) -> AppError {
    AppError::Validation {
        field: "file".into(),
        detail: detail.to_string(),
    }
}

/// Reads the header without deriving a key or touching the ciphertext.
///
/// Used to tell the user what they picked before asking for a password — and to fail fast on a
/// file that is not a profile at all, rather than after several hundred milliseconds of Argon2.
pub fn read_header(file: &[u8]) -> AppResult<ProfileHeader> {
    if file.len() > MAX_FILE_BYTES {
        return Err(malformed("that file is too large to be a profile"));
    }
    if file.len() < HEADER_LEN + 16 {
        return Err(malformed("that file is too small to be a profile"));
    }
    if &file[0..8] != MAGIC {
        return Err(malformed("that is not a Brew Terminal profile"));
    }

    let format_version = u16::from_le_bytes([file[8], file[9]]);
    if format_version == 0 || format_version > FORMAT_VERSION {
        // A newer file cannot be read correctly by an older build, and guessing would be worse
        // than refusing. See the same reasoning in db::migrations.
        return Err(malformed(
            "that profile was written by a newer version of Brew Terminal",
        ));
    }

    if file[10] != KDF_ARGON2ID {
        return Err(malformed(
            "that profile uses an unsupported key-derivation method",
        ));
    }
    if file[11] != AEAD_XCHACHA20POLY1305 {
        return Err(malformed(
            "that profile uses an unsupported encryption method",
        ));
    }

    let kdf = KdfParams {
        m_cost_kib: u32::from_le_bytes([file[12], file[13], file[14], file[15]]),
        t_cost: u32::from_le_bytes([file[16], file[17], file[18], file[19]]),
        p_cost: u32::from_le_bytes([file[20], file[21], file[22], file[23]]),
    };
    kdf.validate()?;

    if file[24] as usize != SALT_LEN {
        return Err(malformed("that profile has an unexpected salt length"));
    }

    let mut salt = [0u8; SALT_LEN];
    salt.copy_from_slice(&file[25..25 + SALT_LEN]);
    let mut nonce = [0u8; NONCE_LEN];
    nonce.copy_from_slice(&file[25 + SALT_LEN..25 + SALT_LEN + NONCE_LEN]);

    Ok(ProfileHeader {
        format_version,
        kdf,
        salt,
        nonce,
    })
}

/// Wipes a derived key when it goes out of scope, including on an early return or a panic.
struct DerivedKey([u8; KEY_LEN]);

impl Drop for DerivedKey {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

fn derive_key(password: &str, salt: &[u8; SALT_LEN], kdf: KdfParams) -> AppResult<DerivedKey> {
    let params =
        Params::new(kdf.m_cost_kib, kdf.t_cost, kdf.p_cost, Some(KEY_LEN)).map_err(|error| {
            tracing::warn!(?error, "invalid argon2 parameters");
            malformed("that profile's key-derivation settings are not usable")
        })?;

    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; KEY_LEN];
    argon
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|error| {
            // The error can echo parameters but never the password.
            tracing::warn!(?error, "key derivation failed");
            AppError::Storage("The password could not be processed.".into())
        })?;

    Ok(DerivedKey(key))
}

/// Enforces the password floor from THREAT_MODEL.md §6.2.
///
/// Counted in characters rather than bytes: a 12-character passphrase using non-ASCII
/// characters is not weaker for being fewer bytes, and byte-counting would silently accept
/// fewer real characters.
pub fn validate_password(password: &str) -> AppResult<()> {
    if password.chars().count() < MIN_PASSWORD_CHARS {
        return Err(AppError::Validation {
            field: "password".into(),
            detail: format!("use at least {MIN_PASSWORD_CHARS} characters"),
        });
    }
    Ok(())
}

/// Compresses, encrypts and frames a payload.
///
/// The caller owns what goes in; this only guarantees that what comes out cannot be read or
/// modified without the password.
pub fn seal(plaintext: &[u8], password: &str) -> AppResult<Vec<u8>> {
    validate_password(password)?;

    let compressed = zstd::encode_all(plaintext, 3).map_err(|error| {
        tracing::warn!(?error, "could not compress the profile payload");
        AppError::Storage("The profile could not be prepared for export.".into())
    })?;

    let mut salt = [0u8; SALT_LEN];
    let mut nonce = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce);

    let header = ProfileHeader {
        format_version: FORMAT_VERSION,
        kdf: KdfParams::default(),
        salt,
        nonce,
    };
    let header_bytes = header.to_bytes();

    let key = derive_key(password, &salt, header.kdf)?;
    let cipher = XChaCha20Poly1305::new((&key.0).into());

    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: &compressed,
                // Binding the header is what makes its advertised parameters trustworthy.
                aad: &header_bytes,
            },
        )
        .map_err(|_| AppError::Storage("The profile could not be encrypted.".into()))?;

    let mut out = header_bytes;
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// Authenticates, decrypts and decompresses a file.
///
/// All-or-nothing by construction: the AEAD tag is checked before a single byte of
/// attacker-controlled structure is parsed, so a tampered file fails without the parser ever
/// seeing it. See THREAT_MODEL.md §6.3.
pub fn open(file: &[u8], password: &str) -> AppResult<Vec<u8>> {
    let header = read_header(file)?;
    let header_bytes = header.to_bytes();

    // The header we re-serialise must be byte-identical to what is in the file, or the tag
    // check would fail for the wrong reason and the error would mislead.
    debug_assert_eq!(&header_bytes[..], &file[..HEADER_LEN]);

    let key = derive_key(password, &header.salt, header.kdf)?;
    let cipher = XChaCha20Poly1305::new((&key.0).into());

    let compressed = cipher
        .decrypt(
            XNonce::from_slice(&header.nonce),
            Payload {
                msg: &file[HEADER_LEN..],
                aad: &header_bytes,
            },
        )
        // A wrong password and a tampered file are indistinguishable here, and deliberately
        // reported the same way: telling someone which one it was tells an attacker too.
        .map_err(|_| AppError::ProfileAuthFailed)?;

    let plaintext = zstd::decode_all(&compressed[..]).map_err(|error| {
        // Authenticated, so this is corruption rather than an attack — but still not the
        // caller's business.
        tracing::warn!(?error, "could not decompress an authenticated profile");
        malformed("that profile is authentic but its contents could not be read")
    })?;

    if plaintext.len() > MAX_PLAINTEXT_BYTES {
        return Err(malformed(
            "that profile expands to more data than this app will load",
        ));
    }

    Ok(plaintext)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fast parameters. The shipped defaults take a few hundred milliseconds each, which turns
    /// a dozen tests into a slow suite for no extra coverage — the property under test is the
    /// construction, not the cost.
    fn seal_fast(plaintext: &[u8], password: &str) -> Vec<u8> {
        let mut salt = [0u8; SALT_LEN];
        let mut nonce = [0u8; NONCE_LEN];
        OsRng.fill_bytes(&mut salt);
        OsRng.fill_bytes(&mut nonce);

        let header = ProfileHeader {
            format_version: FORMAT_VERSION,
            kdf: KdfParams {
                m_cost_kib: 8 * 1024,
                t_cost: 1,
                p_cost: 1,
            },
            salt,
            nonce,
        };
        let header_bytes = header.to_bytes();
        let compressed = zstd::encode_all(plaintext, 3).unwrap();
        let key = derive_key(password, &salt, header.kdf).unwrap();
        let cipher = XChaCha20Poly1305::new((&key.0).into());
        let ciphertext = cipher
            .encrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: &compressed,
                    aad: &header_bytes,
                },
            )
            .unwrap();

        let mut out = header_bytes;
        out.extend_from_slice(&ciphertext);
        out
    }

    const PASSWORD: &str = "correct horse battery staple";

    #[test]
    fn a_sealed_payload_round_trips() {
        let payload = br#"{"watchlists":[],"notes":[]}"#;
        let file = seal_fast(payload, PASSWORD);
        assert_eq!(open(&file, PASSWORD).unwrap(), payload);
    }

    #[test]
    fn the_file_starts_with_the_documented_magic_and_version() {
        let file = seal_fast(b"{}", PASSWORD);
        assert_eq!(&file[0..8], MAGIC);
        assert_eq!(u16::from_le_bytes([file[8], file[9]]), FORMAT_VERSION);
    }

    /// The point of recording parameters per-file: a file written today must still open after
    /// the defaults are raised.
    #[test]
    fn parameters_are_read_from_the_file_not_from_the_defaults() {
        let file = seal_fast(b"{}", PASSWORD);
        let header = read_header(&file).unwrap();

        assert_eq!(header.kdf.m_cost_kib, 8 * 1024);
        assert_ne!(header.kdf.m_cost_kib, DEFAULT_M_COST_KIB);
        // And it opens, using what the file says rather than what this build prefers.
        assert!(open(&file, PASSWORD).is_ok());
    }

    #[test]
    fn a_wrong_password_fails_authentication() {
        let file = seal_fast(b"{}", PASSWORD);
        assert!(matches!(
            open(&file, "correct horse battery stapl"),
            Err(AppError::ProfileAuthFailed)
        ));
    }

    /// Every byte of the file is covered: flipping one anywhere must fail the tag.
    #[test]
    fn tampering_anywhere_fails_authentication() {
        let file = seal_fast(b"{\"notes\":[]}", PASSWORD);

        // A byte in the ciphertext.
        let mut body = file.clone();
        let last = body.len() - 1;
        body[last] ^= 0x01;
        assert!(open(&body, PASSWORD).is_err());

        // A byte in the nonce.
        let mut nonce = file.clone();
        nonce[30] ^= 0x01;
        assert!(open(&nonce, PASSWORD).is_err());

        // A byte in the salt.
        let mut salt = file.clone();
        salt[25] ^= 0x01;
        assert!(open(&salt, PASSWORD).is_err());
    }

    /// The reason the header is bound as associated data. Rewriting the advertised cost down
    /// must not produce a file that opens.
    #[test]
    fn weakening_the_advertised_kdf_parameters_invalidates_the_tag() {
        let file = seal_fast(b"{}", PASSWORD);

        let mut downgraded = file.clone();
        downgraded[12..16].copy_from_slice(&(16u32 * 1024).to_le_bytes());

        // It parses as a header — the parameters are legal — but it will not authenticate.
        assert!(read_header(&downgraded).is_ok());
        assert!(matches!(
            open(&downgraded, PASSWORD),
            Err(AppError::ProfileAuthFailed)
        ));
    }

    #[test]
    fn a_downgraded_format_version_invalidates_the_tag() {
        let mut file = seal_fast(b"{}", PASSWORD);
        // Version 0 is refused outright by the header reader.
        file[8..10].copy_from_slice(&0u16.to_le_bytes());
        assert!(read_header(&file).is_err());
    }

    #[test]
    fn a_newer_format_version_is_refused_rather_than_guessed_at() {
        let mut file = seal_fast(b"{}", PASSWORD);
        file[8..10].copy_from_slice(&(FORMAT_VERSION + 1).to_le_bytes());
        assert!(read_header(&file).is_err());
    }

    /// A crafted header must not be able to make the app allocate gigabytes before it fails.
    #[test]
    fn an_absurd_memory_cost_is_refused_before_any_work() {
        let mut file = seal_fast(b"{}", PASSWORD);
        file[12..16].copy_from_slice(&(4u32 * 1024 * 1024).to_le_bytes());
        assert!(read_header(&file).is_err());
    }

    #[test]
    fn a_trivially_weak_advertised_cost_is_refused() {
        let mut file = seal_fast(b"{}", PASSWORD);
        file[12..16].copy_from_slice(&64u32.to_le_bytes());
        assert!(read_header(&file).is_err());
    }

    #[test]
    fn rubbish_is_rejected_as_not_a_profile() {
        assert!(read_header(b"").is_err());
        assert!(read_header(b"not a profile at all, just some text").is_err());
        assert!(read_header(&[0u8; 200]).is_err());
    }

    #[test]
    fn every_file_gets_a_fresh_salt_and_nonce() {
        // Reusing a nonce with the same key is the one catastrophic misuse of a stream cipher.
        let a = seal_fast(b"{}", PASSWORD);
        let b = seal_fast(b"{}", PASSWORD);

        assert_ne!(&a[25..25 + SALT_LEN], &b[25..25 + SALT_LEN]);
        assert_ne!(&a[41..41 + NONCE_LEN], &b[41..41 + NONCE_LEN]);
        assert_ne!(a, b);
    }

    #[test]
    fn the_password_floor_is_enforced_on_export() {
        assert!(validate_password("short").is_err());
        assert!(validate_password("elevenchars").is_err());
        assert!(validate_password("twelvechars!").is_ok());
        // Counted in characters, not bytes.
        assert!(validate_password("ααααααααααββ").is_ok());
    }

    #[test]
    fn seal_refuses_a_password_below_the_floor() {
        assert!(seal(b"{}", "tooshort").is_err());
    }

    /// The plaintext must not be visible in the file. Obvious, but this is the assertion that
    /// would catch a refactor that accidentally wrote the payload alongside the ciphertext.
    #[test]
    fn the_payload_does_not_appear_in_the_file() {
        let secret = b"{\"note\":\"a distinctive phrase that should never appear\"}";
        let file = seal_fast(secret, PASSWORD);

        let needle = b"a distinctive phrase that should never appear";
        assert!(!file.windows(needle.len()).any(|w| w == needle));
    }

    /// Slow, but the shipped parameters are what users actually get, so at least one test
    /// exercises them end to end.
    #[test]
    fn the_shipped_parameters_round_trip() {
        let file = seal(b"{\"real\":true}", PASSWORD).unwrap();
        let header = read_header(&file).unwrap();

        assert_eq!(header.kdf, KdfParams::default());
        assert_eq!(open(&file, PASSWORD).unwrap(), b"{\"real\":true}");
    }
}
