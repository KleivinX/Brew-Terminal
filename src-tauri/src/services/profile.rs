//! Export and import of the encrypted `.brewprofile`.
//!
//! The file is written and read **in Rust**. The frontend picks a path and supplies a password;
//! it never receives the plaintext payload and never receives the file bytes. That keeps the
//! decrypted contents of someone's entire profile out of the process that renders untrusted
//! provider strings, for the same reason API keys are kept out of it.
//!
//! Import order is fixed and each step exists for a reason:
//!
//! 1. Read and authenticate. A tampered file fails here, before any parsing.
//! 2. Parse and validate. A valid tag proves provenance, not sanity.
//! 3. Back up the database, checkpointing the WAL first so the copy is complete.
//! 4. Apply inside one transaction.
//!
//! Steps 1 and 2 both precede step 3, so a bad file costs the user nothing at all. See
//! THREAT_MODEL.md §6.3.

use std::path::{Path, PathBuf};
use std::time::Duration;

use zeroize::Zeroizing;

use crate::db::{migrations, repo_profile};
use crate::error::{AppError, AppResult};
use crate::models::{now_epoch_secs, ImportMode, ImportResult, ProfilePayload, ProfileSummary};
use crate::security::profile;
use crate::state::{with_db, AppState};

/// A pause after a failed password.
///
/// This does not stop offline cracking — the file is on disk and Argon2id is the real defence.
/// It makes *guessing through this UI* unattractive, which is a smaller but real threat: someone
/// with brief access to an unlocked machine trying a handful of likely passwords.
const FAILED_PASSWORD_DELAY: Duration = Duration::from_millis(750);

#[derive(Debug, serde::Serialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: String,
    #[cfg_attr(test, ts(type = "number"))]
    pub bytes: u64,
}

fn read_file(path: &str) -> AppResult<Vec<u8>> {
    std::fs::read(path).map_err(|error| {
        // The path came from the user's own file picker, but it still does not belong in a
        // payload that reaches the UI as an error string.
        tracing::warn!(?error, "could not read the profile file");
        AppError::Storage("That file could not be read.".into())
    })
}

/// Writes an encrypted profile to `path`.
///
/// The password is held in a `Zeroizing<String>` so it is wiped when this returns. Being honest
/// about the limit: the buffer Tauri deserialised the IPC argument into is outside this app's
/// control and is not zeroized. What can be wiped, is.
pub async fn export(state: &AppState, path: String, password: String) -> AppResult<ExportResult> {
    let password = Zeroizing::new(password);
    profile::validate_password(&password)?;

    let now = now_epoch_secs();
    let payload = with_db(state.pool.clone(), move |conn| {
        let schema_version = migrations::current_version(conn)?;
        repo_profile::gather(conn, schema_version, now)
    })
    .await?;

    let json = Zeroizing::new(serde_json::to_vec(&payload)?);

    // Argon2id is CPU- and memory-bound for a few hundred milliseconds. Off the async runtime.
    let sealed = tokio::task::spawn_blocking(move || profile::seal(&json, &password))
        .await
        .map_err(|error| AppError::Storage(format!("export task failed: {error}")))??;

    std::fs::write(&path, &sealed).map_err(|error| {
        tracing::warn!(?error, "could not write the profile file");
        AppError::Storage("The profile could not be written to that location.".into())
    })?;

    tracing::info!(bytes = sealed.len(), "wrote an encrypted profile");

    Ok(ExportResult {
        path,
        bytes: sealed.len() as u64,
    })
}

/// Decrypts and validates a file without writing anything.
///
/// This is what backs the "here is what is in it" step: the user chooses merge or replace while
/// looking at real counts from the real file, not a promise about what it might contain.
pub async fn inspect(
    state: &AppState,
    path: String,
    password: String,
) -> AppResult<ProfileSummary> {
    let payload = decrypt_and_validate(state, path, password).await?;
    Ok(ProfileSummary::of(&payload))
}

async fn decrypt_and_validate(
    state: &AppState,
    path: String,
    password: String,
) -> AppResult<ProfilePayload> {
    let password = Zeroizing::new(password);
    let file = read_file(&path)?;

    // Fails fast on something that is not a profile at all, before spending Argon2 time.
    profile::read_header(&file)?;

    let plaintext = tokio::task::spawn_blocking(move || profile::open(&file, &password))
        .await
        .map_err(|error| AppError::Storage(format!("import task failed: {error}")))?;

    let plaintext = match plaintext {
        Ok(bytes) => Zeroizing::new(bytes),
        Err(error) => {
            if matches!(error, AppError::ProfileAuthFailed) {
                tokio::time::sleep(FAILED_PASSWORD_DELAY).await;
            }
            return Err(error);
        }
    };

    let payload: ProfilePayload = serde_json::from_slice(&plaintext).map_err(|error| {
        // Authenticated, so this is a file we wrote in a shape we no longer read — or one
        // someone with the password crafted. Either way the detail stays in the log.
        tracing::warn!(?error, "an authenticated profile did not parse");
        AppError::Validation {
            field: "file".into(),
            detail: "that profile's contents are not in a format this version can read".into(),
        }
    })?;

    let schema_version =
        with_db(state.pool.clone(), |conn| migrations::current_version(conn)).await?;
    repo_profile::validate(&payload, schema_version)?;

    Ok(payload)
}

/// Copies the database aside before an import touches it.
///
/// The WAL is checkpointed first: without that, a copy of the main database file can be missing
/// everything written since the last checkpoint, which would make the backup quietly useless at
/// exactly the moment it is needed.
fn backup_database(conn: &rusqlite::Connection, db_path: &Path) -> AppResult<PathBuf> {
    /*
     * `wal_checkpoint(TRUNCATE)` returns (busy, log, checkpointed). A non-zero `busy` means
     * another connection held a read lock and the checkpoint did *not* complete — in which case
     * the main database file is missing everything written since the last one, and copying it
     * would produce a backup that looks fine and is not.
     *
     * So a busy checkpoint aborts the import. Refusing to proceed is the only honest option:
     * the alternative is telling someone their data is backed up when it is not, immediately
     * before overwriting it.
     */
    let busy: i64 = conn
        .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| row.get(0))
        .map_err(|error| {
            tracing::warn!(?error, "could not checkpoint the WAL before backing up");
            AppError::Storage(
                "Your current data could not be prepared for backup, so nothing was imported."
                    .into(),
            )
        })?;

    if busy != 0 {
        tracing::warn!("WAL checkpoint was blocked; refusing to write a partial backup");
        return Err(AppError::Storage(
            "Your current data is in use and could not be backed up completely, so nothing was \
             imported. Close any other Brew Terminal window and try again."
                .into(),
        ));
    }

    let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    let backup = db_path.with_extension(format!("pre-import-{stamp}.bak"));

    std::fs::copy(db_path, &backup).map_err(|error| {
        tracing::warn!(?error, "could not write the pre-import backup");
        AppError::Storage(
            "A backup of your current data could not be written, so nothing was imported.".into(),
        )
    })?;

    Ok(backup)
}

/// Imports a profile.
///
/// Nothing is written until the file has been authenticated, parsed and validated, and a backup
/// of the current database exists. The apply itself is one transaction, so a failure part-way
/// leaves the database exactly as it was rather than half-merged.
pub async fn import(
    state: &AppState,
    path: String,
    password: String,
    mode: ImportMode,
) -> AppResult<ImportResult> {
    let payload = decrypt_and_validate(state, path, password).await?;
    let summary = ProfileSummary::of(&payload);
    let db_path = state.db_path.clone();

    let backup_path = with_db(state.pool.clone(), move |conn| {
        let backup = backup_database(conn, &db_path)?;

        let tx = conn.transaction()?;
        repo_profile::apply(&tx, &payload, mode)?;
        tx.commit()?;

        Ok(backup.display().to_string())
    })
    .await?;

    tracing::info!(?mode, "imported a profile");

    Ok(ImportResult {
        mode,
        summary,
        backup_path,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::AppState;

    const PASSWORD: &str = "correct horse battery staple";

    fn state() -> (AppState, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::bootstrap(dir.path().to_path_buf()).unwrap();
        (state, dir)
    }

    async fn seed(state: &AppState) {
        with_db(state.pool.clone(), |conn| {
            conn.execute_batch(
                "INSERT INTO assets (id, asset_type, symbol, name, currency, created_at, updated_at)
                 VALUES ('crypto:cg:bitcoin','crypto','BTC','Bitcoin','USD',1,1);
                 INSERT INTO notes (id, asset_id, title, body_md, created_at, updated_at)
                 VALUES ('note-1','crypto:cg:bitcoin','Research','A private note',1,1);
                 INSERT INTO preferences (key, value, updated_at) VALUES ('theme','\"soft\"',1);",
            )?;
            Ok(())
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn a_profile_round_trips_through_a_real_file() {
        let (source, source_dir) = state();
        seed(&source).await;
        let file = source_dir.path().join("mine.brewprofile");

        let written = export(&source, file.display().to_string(), PASSWORD.to_string())
            .await
            .unwrap();
        assert!(written.bytes > 0);
        assert!(file.exists());

        let (target, _target_dir) = state();
        let result = import(
            &target,
            file.display().to_string(),
            PASSWORD.to_string(),
            ImportMode::Merge,
        )
        .await
        .unwrap();

        assert_eq!(result.summary.notes, 1);
        assert!(std::path::Path::new(&result.backup_path).exists());

        let note: String = with_db(target.pool.clone(), |conn| {
            Ok(
                conn.query_row("SELECT body_md FROM notes WHERE id = 'note-1'", [], |row| {
                    row.get(0)
                })?,
            )
        })
        .await
        .unwrap();
        assert_eq!(note, "A private note");
    }

    /// The one thing a user can see without decrypting: their notes must not be readable in the
    /// file. This is the assertion that would catch an export path that forgot to encrypt.
    #[tokio::test]
    async fn the_file_on_disk_reveals_nothing() {
        let (state, dir) = state();
        seed(&state).await;
        let file = dir.path().join("mine.brewprofile");

        export(&state, file.display().to_string(), PASSWORD.to_string())
            .await
            .unwrap();

        let bytes = std::fs::read(&file).unwrap();
        for needle in [
            b"A private note".as_slice(),
            b"Bitcoin".as_slice(),
            b"note-1".as_slice(),
            b"soft".as_slice(),
        ] {
            assert!(
                !bytes.windows(needle.len()).any(|w| w == needle),
                "the export leaked {}",
                String::from_utf8_lossy(needle)
            );
        }
    }

    #[tokio::test]
    async fn a_wrong_password_imports_nothing_and_leaves_no_backup() {
        let (source, dir) = state();
        seed(&source).await;
        let file = dir.path().join("mine.brewprofile");
        export(&source, file.display().to_string(), PASSWORD.to_string())
            .await
            .unwrap();

        let (target, target_dir) = state();
        let result = import(
            &target,
            file.display().to_string(),
            "not the password at all".to_string(),
            ImportMode::Merge,
        )
        .await;

        assert!(matches!(result, Err(AppError::ProfileAuthFailed)));

        // Authentication happens before the backup, so a bad password costs nothing — not even
        // a stray backup file cluttering the data directory.
        let backups = std::fs::read_dir(target_dir.path())
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().contains("pre-import"))
            .count();
        assert_eq!(backups, 0);

        let notes: i64 = with_db(target.pool.clone(), |conn| {
            Ok(conn.query_row("SELECT COUNT(*) FROM notes", [], |row| row.get(0))?)
        })
        .await
        .unwrap();
        assert_eq!(notes, 0);
    }

    #[tokio::test]
    async fn a_tampered_file_imports_nothing() {
        let (source, dir) = state();
        seed(&source).await;
        let file = dir.path().join("mine.brewprofile");
        export(&source, file.display().to_string(), PASSWORD.to_string())
            .await
            .unwrap();

        let mut bytes = std::fs::read(&file).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 0x01;
        std::fs::write(&file, &bytes).unwrap();

        let (target, _target_dir) = state();
        let result = import(
            &target,
            file.display().to_string(),
            PASSWORD.to_string(),
            ImportMode::Merge,
        )
        .await;

        assert!(matches!(result, Err(AppError::ProfileAuthFailed)));
    }

    /// The backup is only worth writing if it can actually be restored from. This opens the
    /// copy and checks the row that the import was about to destroy is in it.
    #[tokio::test]
    async fn the_backup_contains_the_data_the_import_replaced() {
        let (source, dir) = state();
        seed(&source).await;
        let file = dir.path().join("mine.brewprofile");
        export(&source, file.display().to_string(), PASSWORD.to_string())
            .await
            .unwrap();

        let (target, _target_dir) = state();
        with_db(target.pool.clone(), |conn| {
            conn.execute(
                "INSERT INTO notes (id, title, body_md, created_at, updated_at)
                 VALUES ('doomed','Doomed','about to be replaced',1,1)",
                [],
            )?;
            Ok(())
        })
        .await
        .unwrap();

        let result = import(
            &target,
            file.display().to_string(),
            PASSWORD.to_string(),
            ImportMode::Replace,
        )
        .await
        .unwrap();

        // Open the backup directly and confirm the destroyed row survives in it.
        let backup = rusqlite::Connection::open(&result.backup_path).unwrap();
        let body: String = backup
            .query_row("SELECT body_md FROM notes WHERE id = 'doomed'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(body, "about to be replaced");
    }

    #[tokio::test]
    async fn inspecting_a_file_writes_nothing() {
        let (source, dir) = state();
        seed(&source).await;
        let file = dir.path().join("mine.brewprofile");
        export(&source, file.display().to_string(), PASSWORD.to_string())
            .await
            .unwrap();

        let (target, _target_dir) = state();
        let summary = inspect(&target, file.display().to_string(), PASSWORD.to_string())
            .await
            .unwrap();

        assert_eq!(summary.notes, 1);
        assert_eq!(summary.assets, 1);

        let notes: i64 = with_db(target.pool.clone(), |conn| {
            Ok(conn.query_row("SELECT COUNT(*) FROM notes", [], |row| row.get(0))?)
        })
        .await
        .unwrap();
        assert_eq!(notes, 0, "inspect must not write");
    }

    #[tokio::test]
    async fn a_short_password_is_refused_before_anything_is_written() {
        let (state, dir) = state();
        let file = dir.path().join("mine.brewprofile");

        let result = export(&state, file.display().to_string(), "short".to_string()).await;

        assert!(matches!(result, Err(AppError::Validation { .. })));
        assert!(!file.exists(), "a refused export must not leave a file");
    }

    #[tokio::test]
    async fn a_file_that_is_not_a_profile_is_refused() {
        let (state, dir) = state();
        let file = dir.path().join("holiday-photo.jpg");
        std::fs::write(&file, b"\xff\xd8\xff\xe0 not a profile").unwrap();

        let result = inspect(&state, file.display().to_string(), PASSWORD.to_string()).await;
        assert!(matches!(result, Err(AppError::Validation { .. })));
    }

    #[tokio::test]
    async fn replace_clears_local_data_but_the_backup_survives_it() {
        let (source, dir) = state();
        seed(&source).await;
        let file = dir.path().join("mine.brewprofile");
        export(&source, file.display().to_string(), PASSWORD.to_string())
            .await
            .unwrap();

        let (target, _target_dir) = state();
        with_db(target.pool.clone(), |conn| {
            conn.execute(
                "INSERT INTO notes (id, title, body_md, created_at, updated_at)
                 VALUES ('local','Local','about to be replaced',1,1)",
                [],
            )?;
            Ok(())
        })
        .await
        .unwrap();

        let result = import(
            &target,
            file.display().to_string(),
            PASSWORD.to_string(),
            ImportMode::Replace,
        )
        .await
        .unwrap();

        let ids: Vec<String> = with_db(target.pool.clone(), |conn| {
            let mut stmt = conn.prepare("SELECT id FROM notes ORDER BY id")?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
            let mut out = Vec::new();
            for row in rows {
                out.push(row?);
            }
            Ok(out)
        })
        .await
        .unwrap();

        assert_eq!(ids, vec!["note-1".to_string()]);
        // The replaced note is still recoverable from the backup this import wrote.
        assert!(std::path::Path::new(&result.backup_path).exists());
    }
}
