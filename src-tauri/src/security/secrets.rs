//! Credential storage, backed by the operating system's own keychain.
//!
//! The guarantee this module exists to keep: **an API key never crosses the IPC boundary.**
//! The frontend can ask whether a credential exists and can see a masked hint; it can never
//! read the value back. Keys are read inside the Rust HTTP layer at request time and nowhere
//! else. See THREAT_MODEL.md §4.

use keyring::Entry;

use crate::error::{AppError, AppResult};

/// Keychain service name. Shared by every provider entry; the provider id is the account.
const SERVICE: &str = "com.brewterminal.app";

/// Guards against a caller storing something enormous in the keychain by accident.
const MAX_SECRET_LEN: usize = 4096;

/// How a credential is being held.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StorageBackend {
    /// The OS keychain. Survives a restart.
    Keychain,
    /// In memory for this session only. Used where no Secret Service is available — see
    /// `SessionSecrets` and THREAT_MODEL.md §4.
    SessionOnly,
}

fn entry(provider_id: &str) -> AppResult<Entry> {
    Entry::new(SERVICE, provider_id).map_err(|error| {
        tracing::warn!(provider = provider_id, ?error, "keychain unavailable");
        AppError::Storage("The system keychain is not available.".into())
    })
}

pub fn store(provider_id: &str, secret: &str) -> AppResult<()> {
    if secret.trim().is_empty() {
        return Err(AppError::Validation {
            field: "apiKey".into(),
            detail: "the key is empty".into(),
        });
    }
    if secret.len() > MAX_SECRET_LEN {
        return Err(AppError::Validation {
            field: "apiKey".into(),
            detail: "that does not look like an API key".into(),
        });
    }

    entry(provider_id)?.set_password(secret).map_err(|error| {
        // The error is logged without the secret; `error` from keyring carries no key material.
        tracing::warn!(provider = provider_id, ?error, "could not store credential");
        AppError::Storage("The key could not be saved to the system keychain.".into())
    })
}

/// Reads a credential. Called only from the HTTP layer, immediately before a request.
pub fn read(provider_id: &str) -> Option<String> {
    match entry(provider_id).ok()?.get_password() {
        Ok(secret) => Some(secret),
        Err(keyring::Error::NoEntry) => None,
        Err(error) => {
            tracing::warn!(provider = provider_id, ?error, "could not read credential");
            None
        }
    }
}

pub fn exists(provider_id: &str) -> bool {
    read(provider_id).is_some()
}

pub fn delete(provider_id: &str) -> AppResult<()> {
    match entry(provider_id)?.delete_credential() {
        Ok(()) => Ok(()),
        // Deleting something that is not there is the state the caller wanted.
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => {
            tracing::warn!(
                provider = provider_id,
                ?error,
                "could not delete credential"
            );
            Err(AppError::Storage(
                "The key could not be removed from the system keychain.".into(),
            ))
        }
    }
}

/// A masked hint, safe to show and safe to send over IPC.
///
/// This is the *only* representation of a key that ever leaves this module.
pub fn masked_hint(provider_id: &str) -> Option<String> {
    read(provider_id).map(|secret| super::redact::mask_secret(&secret))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Storing an empty or absurd value is a caller bug; catching it here keeps junk out of
    /// the user's keychain. These run without touching the real keychain.
    #[test]
    fn rejects_empty_secrets() {
        assert!(store("test-provider", "").is_err());
        assert!(store("test-provider", "   ").is_err());
    }

    #[test]
    fn rejects_absurdly_long_secrets() {
        assert!(store("test-provider", &"x".repeat(MAX_SECRET_LEN + 1)).is_err());
    }

    #[test]
    fn masking_never_reveals_the_middle() {
        let masked = super::super::redact::mask_secret("sk-abcdefghijklmnopqrstuvwxyz");
        assert!(!masked.contains("ghijklmnopqrstuv"));
        assert!(masked.contains('…'));
    }
}
