//! Extracting the engine archive.
//!
//! An archive is the least trustworthy input this app handles. It arrives over the network, it
//! is written to disk, and something inside it is then executed. Two classic attacks apply:
//!
//! * **Path traversal (zip slip).** An entry named `../../../.zshrc` escapes the destination.
//!   `safe_join` refuses absolute paths, any `..` component, Windows drive prefixes and
//!   (deliberately) anything with a backslash, which a tar entry has no business containing.
//! * **Decompression bombs.** A few hundred kilobytes can expand to fill a disk. Extraction
//!   stops at `MAX_TOTAL_BYTES` and `MAX_ENTRIES`.
//!
//! These checks are performed here rather than being left to `tar` or `zip`, because the point
//! is not to trust either of them with it.

use std::path::{Component, Path, PathBuf};

use crate::error::{AppError, AppResult};

/// The engine archives are tens of megabytes unpacked. This leaves generous headroom while
/// still bounding a hostile archive.
const MAX_TOTAL_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_ENTRIES: usize = 10_000;

fn refused(detail: &str) -> AppError {
    tracing::warn!(detail, "refusing an archive entry");
    AppError::Storage("The downloaded archive could not be unpacked safely.".into())
}

/// Resolves an archive entry path against `root`, refusing anything that could escape it.
pub fn safe_join(root: &Path, entry: &Path) -> AppResult<PathBuf> {
    if entry.is_absolute() {
        return Err(refused("absolute path"));
    }

    // A backslash is a separator on Windows and an ordinary character elsewhere, so an entry
    // containing one means something different depending on where it is unpacked. Nothing
    // legitimate in these archives has one.
    if entry.to_string_lossy().contains('\\') {
        return Err(refused("backslash in entry name"));
    }

    let mut out = root.to_path_buf();
    for component in entry.components() {
        match component {
            Component::Normal(part) => out.push(part),
            // `./` is harmless and common.
            Component::CurDir => {}
            Component::ParentDir => return Err(refused("`..` in entry name")),
            Component::RootDir | Component::Prefix(_) => {
                return Err(refused("rooted or prefixed entry name"))
            }
        }
    }

    // Belt and braces: even with the component checks above, the result must still be inside.
    if !out.starts_with(root) {
        return Err(refused("entry resolved outside the destination"));
    }

    Ok(out)
}

/// Unpacks a `.tar.gz` into `dest`.
pub fn extract_tar_gz(archive: &Path, dest: &Path) -> AppResult<()> {
    let file = std::fs::File::open(archive)
        .map_err(|error| AppError::Storage(format!("could not open the archive: {error}")))?;
    let decoder = flate2::read::GzDecoder::new(file);
    let mut tar = tar::Archive::new(decoder);

    std::fs::create_dir_all(dest)
        .map_err(|error| AppError::Storage(format!("could not create the destination: {error}")))?;

    let mut total: u64 = 0;
    let mut count: usize = 0;

    let entries = tar
        .entries()
        .map_err(|error| AppError::Storage(format!("could not read the archive: {error}")))?;

    for entry in entries {
        let mut entry =
            entry.map_err(|error| AppError::Storage(format!("archive entry failed: {error}")))?;

        count += 1;
        if count > MAX_ENTRIES {
            return Err(refused("too many entries"));
        }

        let path = entry
            .path()
            .map_err(|error| AppError::Storage(format!("unreadable entry name: {error}")))?
            .into_owned();

        // Symlinks and hard links can point outside the destination even when their own name
        // is clean, so they are skipped rather than resolved. Nothing in these builds needs one.
        let kind = entry.header().entry_type();
        if kind.is_symlink() || kind.is_hard_link() {
            tracing::debug!(path = %path.display(), "skipping a link in the archive");
            continue;
        }

        total = total.saturating_add(entry.header().size().unwrap_or(0));
        if total > MAX_TOTAL_BYTES {
            return Err(refused("archive expands beyond the size cap"));
        }

        let target = safe_join(dest, &path)?;

        if kind.is_dir() {
            std::fs::create_dir_all(&target)
                .map_err(|error| AppError::Storage(format!("could not create dir: {error}")))?;
            continue;
        }

        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| AppError::Storage(format!("could not create dir: {error}")))?;
        }

        entry
            .unpack(&target)
            .map_err(|error| AppError::Storage(format!("could not write an entry: {error}")))?;
    }

    Ok(())
}

/// Unpacks a `.zip` into `dest`.
pub fn extract_zip(archive: &Path, dest: &Path) -> AppResult<()> {
    let file = std::fs::File::open(archive)
        .map_err(|error| AppError::Storage(format!("could not open the archive: {error}")))?;
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|error| AppError::Storage(format!("could not read the archive: {error}")))?;

    std::fs::create_dir_all(dest)
        .map_err(|error| AppError::Storage(format!("could not create the destination: {error}")))?;

    if zip.len() > MAX_ENTRIES {
        return Err(refused("too many entries"));
    }

    let mut total: u64 = 0;

    for index in 0..zip.len() {
        let mut entry = zip
            .by_index(index)
            .map_err(|error| AppError::Storage(format!("archive entry failed: {error}")))?;

        // `enclosed_name` is the crate's own traversal check. `safe_join` runs as well rather
        // than instead — this is the step that executes something afterwards.
        let Some(name) = entry.enclosed_name() else {
            return Err(refused("unsafe entry name"));
        };

        total = total.saturating_add(entry.size());
        if total > MAX_TOTAL_BYTES {
            return Err(refused("archive expands beyond the size cap"));
        }

        let target = safe_join(dest, &name)?;

        if entry.is_dir() {
            std::fs::create_dir_all(&target)
                .map_err(|error| AppError::Storage(format!("could not create dir: {error}")))?;
            continue;
        }

        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| AppError::Storage(format!("could not create dir: {error}")))?;
        }

        let mut out = std::fs::File::create(&target)
            .map_err(|error| AppError::Storage(format!("could not write an entry: {error}")))?;
        std::io::copy(&mut entry, &mut out)
            .map_err(|error| AppError::Storage(format!("could not write an entry: {error}")))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ordinary_names_resolve_inside_the_destination() {
        let root = Path::new("/tmp/dest");
        assert_eq!(
            safe_join(root, Path::new("build/bin/llama-server")).unwrap(),
            Path::new("/tmp/dest/build/bin/llama-server")
        );
        assert_eq!(
            safe_join(root, Path::new("./bin/llama-server")).unwrap(),
            Path::new("/tmp/dest/bin/llama-server")
        );
    }

    /// The attack this whole module exists for.
    #[test]
    fn traversal_is_refused() {
        let root = Path::new("/tmp/dest");
        assert!(safe_join(root, Path::new("../escaped")).is_err());
        assert!(safe_join(root, Path::new("a/../../escaped")).is_err());
        assert!(safe_join(root, Path::new("a/b/../../../escaped")).is_err());
    }

    #[test]
    fn absolute_and_rooted_names_are_refused() {
        let root = Path::new("/tmp/dest");
        assert!(safe_join(root, Path::new("/etc/passwd")).is_err());
        assert!(safe_join(root, Path::new("/")).is_err());
    }

    #[test]
    fn backslash_names_are_refused_on_every_platform() {
        // On Unix this is one filename containing a backslash; on Windows it is a path. It is
        // refused in both cases so the archive cannot mean different things in different
        // places.
        let root = Path::new("/tmp/dest");
        assert!(safe_join(root, Path::new(r"..\..\escaped")).is_err());
        assert!(safe_join(root, Path::new(r"a\b")).is_err());
    }

    /// Builds a `.tar.gz` containing one entry with `entry_name`, bypassing the tar crate's
    /// own refusal to write a traversing path.
    ///
    /// The name is written straight into the header's raw name field, because that is what a
    /// hostile archive actually contains — `Builder::append_data` rejects `..` before it ever
    /// reaches disk, so going through it would test the wrong thing entirely.
    fn tar_gz_with_entry(path: &Path, entry_name: &str, payload: &[u8]) {
        let mut header = tar::Header::new_gnu();
        {
            let name_field = &mut header.as_gnu_mut().unwrap().name;
            name_field.fill(0);
            name_field[..entry_name.len()].copy_from_slice(entry_name.as_bytes());
        }
        header.set_size(payload.len() as u64);
        header.set_mode(0o644);
        header.set_entry_type(tar::EntryType::Regular);
        header.set_cksum();

        let mut raw = Vec::new();
        raw.extend_from_slice(header.as_bytes());
        raw.extend_from_slice(payload);
        // Entries are padded to a 512-byte boundary, then the archive ends with two zero blocks.
        raw.resize(raw.len().div_ceil(512) * 512, 0);
        raw.extend_from_slice(&[0u8; 1024]);

        let file = std::fs::File::create(path).unwrap();
        let mut encoder = flate2::write::GzEncoder::new(file, flate2::Compression::fast());
        std::io::Write::write_all(&mut encoder, &raw).unwrap();
        encoder.finish().unwrap();
    }

    #[test]
    fn a_tar_that_tries_to_escape_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let archive_path = dir.path().join("evil.tar.gz");
        tar_gz_with_entry(&archive_path, "../escaped.txt", b"pwned");

        let dest = dir.path().join("dest");
        assert!(
            extract_tar_gz(&archive_path, &dest).is_err(),
            "a traversing entry must abort the whole extraction"
        );
        assert!(
            !dir.path().join("escaped.txt").exists(),
            "the traversing entry must not have been written"
        );
    }

    #[test]
    fn a_tar_with_an_absolute_entry_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let archive_path = dir.path().join("absolute.tar.gz");
        tar_gz_with_entry(
            &archive_path,
            "/tmp/brew-terminal-should-not-exist",
            b"pwned",
        );

        assert!(extract_tar_gz(&archive_path, &dir.path().join("dest")).is_err());
        assert!(!Path::new("/tmp/brew-terminal-should-not-exist").exists());
    }

    #[test]
    fn an_ordinary_tar_extracts() {
        let dir = tempfile::tempdir().unwrap();
        let archive_path = dir.path().join("fine.tar.gz");

        {
            let file = std::fs::File::create(&archive_path).unwrap();
            let encoder = flate2::write::GzEncoder::new(file, flate2::Compression::fast());
            let mut builder = tar::Builder::new(encoder);

            let payload = b"#!/bin/sh\n";
            let mut header = tar::Header::new_gnu();
            header.set_size(payload.len() as u64);
            header.set_mode(0o755);
            header.set_cksum();
            builder
                .append_data(&mut header, "build/bin/llama-server", &payload[..])
                .unwrap();
            builder.into_inner().unwrap().finish().unwrap();
        }

        let dest = dir.path().join("dest");
        extract_tar_gz(&archive_path, &dest).unwrap();

        assert!(dest.join("build/bin/llama-server").exists());
    }
}
