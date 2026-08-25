import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { DisclaimerNote } from '@/components/status/DisclaimerNote';
import { ipc, IpcError } from '@/lib/ipc';
import { pickProfileFile, pickSaveLocation } from '@/lib/dialog';
import type { ImportMode, ProfileSummary } from '@/types/domain';
import { MIN_PASSWORD_CHARS, scorePassword } from './passwordStrength';
import styles from './ProfilePanel.module.css';

function defaultFileName(): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `brew-terminal-${stamp}.brewprofile`;
}

/**
 * Encrypted export and import.
 *
 * The shape of the import flow is the point: **pick a file, decrypt it, look at what is in it,
 * then choose how to apply it.** Nothing is written until that last step, and the summary shown
 * comes from the real decrypted file rather than a promise about what it should contain. See
 * DATA_MODEL.md §6 and THREAT_MODEL.md §6.3.
 *
 * The password never reaches this component's state beyond the field itself, and the decrypted
 * payload never reaches the frontend at all — Rust reads and writes the file.
 */
export function ProfilePanel() {
  const queryClient = useQueryClient();

  const [exportPassword, setExportPassword] = useState('');
  const [exportConfirm, setExportConfirm] = useState('');
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const [importPath, setImportPath] = useState<string | null>(null);
  const [importPassword, setImportPassword] = useState('');
  const [summary, setSummary] = useState<ProfileSummary | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  const strength = scorePassword(exportPassword);
  const passwordsMatch = exportPassword === exportConfirm;
  const canExport = exportPassword.length > 0 && passwordsMatch && strength.level !== 'too-short';

  const messageOf = (error: unknown, fallback: string): string =>
    error instanceof IpcError ? error.message : fallback;

  const runExport = useMutation({
    mutationFn: async () => {
      const path = await pickSaveLocation(defaultFileName());
      if (path === null) return null;
      return ipc('export_profile', { path, password: exportPassword });
    },
    onSuccess: (result) => {
      setExportError(null);
      if (result === null) return;
      setExportPassword('');
      setExportConfirm('');
      setExportMessage(
        `Written to ${result.path} — ${result.bytes.toLocaleString()} bytes, encrypted.`,
      );
    },
    onError: (error) => {
      setExportMessage(null);
      setExportError(messageOf(error, 'The profile could not be exported.'));
    },
  });

  const inspect = useMutation({
    mutationFn: async () => {
      const path = importPath ?? (await pickProfileFile());
      if (path === null) return null;
      setImportPath(path);
      const result = await ipc('inspect_profile', { path, password: importPassword });
      return result;
    },
    onSuccess: (result) => {
      setImportError(null);
      if (result !== null) setSummary(result);
    },
    onError: (error) => {
      setSummary(null);
      setImportError(messageOf(error, 'That file could not be opened.'));
    },
  });

  const runImport = useMutation({
    mutationFn: (mode: ImportMode) =>
      ipc('import_profile', { path: importPath as string, password: importPassword, mode }),
    onSuccess: (result) => {
      setImportError(null);
      setSummary(null);
      setImportPassword('');
      setImportPath(null);
      setImportMessage(
        `Imported. Your previous data was backed up to ${result.backupPath} before anything changed.`,
      );
      // Everything the import touched is now stale.
      void queryClient.invalidateQueries();
    },
    onError: (error) => {
      setImportError(messageOf(error, 'The profile could not be imported.'));
    },
  });

  return (
    <div className={styles.stack}>
      <Panel title="Export an encrypted profile">
        <div className={styles.body}>
          <p className={styles.intro}>
            Writes your watchlists, notes, learning progress and settings to a single encrypted
            file. Useful for moving to another computer, or as a backup you keep yourself.
          </p>

          <p className={styles.warning}>
            <strong>A forgotten password cannot be recovered.</strong> Not by you, not by this
            project, not by anyone. The file is encrypted with the password and nothing else — there
            is no reset, no recovery key and no back door.
          </p>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="profile-password">
              Password
            </label>
            <Input
              id="profile-password"
              type="password"
              value={exportPassword}
              autoComplete="new-password"
              onChange={(event) => {
                setExportPassword(event.target.value);
                setExportError(null);
              }}
            />

            <div className={styles.meter} aria-hidden="true">
              {[1, 2, 3, 4].map((bar) => (
                <span
                  key={bar}
                  className={[
                    styles.meterBar,
                    strength.score >= bar ? styles[`meter_${strength.level}`] : null,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                />
              ))}
            </div>
            <p className={styles.help} role="status">
              {exportPassword.length === 0
                ? `At least ${MIN_PASSWORD_CHARS} characters. A few unrelated words beats a short one with symbols.`
                : `${strength.label}${strength.advice ? ` — ${strength.advice}` : ''}`}
            </p>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="profile-password-confirm">
              Password again
            </label>
            <Input
              id="profile-password-confirm"
              type="password"
              value={exportConfirm}
              autoComplete="new-password"
              invalid={exportConfirm.length > 0 && !passwordsMatch}
              onChange={(event) => setExportConfirm(event.target.value)}
            />
            {exportConfirm.length > 0 && !passwordsMatch ? (
              <p className={styles.error}>Those do not match.</p>
            ) : null}
          </div>

          {exportError ? (
            <p className={styles.error} role="alert">
              {exportError}
            </p>
          ) : null}
          {exportMessage ? (
            <p className={styles.ok} role="status">
              {exportMessage}
            </p>
          ) : null}

          <div className={styles.actions}>
            <Button
              variant="primary"
              size="sm"
              disabled={!canExport || runExport.isPending}
              onClick={() => runExport.mutate()}
            >
              {runExport.isPending ? 'Encrypting…' : 'Choose location and export'}
            </Button>
          </div>

          <p className={styles.help}>
            The file contains no API keys. Keys stay in this computer&rsquo;s credential store and
            are re-entered on a new machine.
          </p>
        </div>
      </Panel>

      <Panel title="Import a profile">
        <div className={styles.body}>
          <p className={styles.intro}>
            Open a <span className="tabular">.brewprofile</span> file. You will see what is in it
            before anything is written, and your current data is backed up first either way.
          </p>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="import-password">
              Password for that file
            </label>
            <Input
              id="import-password"
              type="password"
              value={importPassword}
              autoComplete="off"
              onChange={(event) => {
                setImportPassword(event.target.value);
                setImportError(null);
              }}
            />
          </div>

          <div className={styles.actions}>
            <Button
              variant="secondary"
              size="sm"
              disabled={importPassword.length === 0 || inspect.isPending}
              onClick={() => inspect.mutate()}
            >
              {inspect.isPending ? 'Opening…' : 'Choose a file and open it'}
            </Button>

            {importPath ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setImportPath(null);
                  setSummary(null);
                  setImportError(null);
                }}
              >
                Pick a different file
              </Button>
            ) : null}
          </div>

          {importError ? (
            <p className={styles.error} role="alert">
              {importError}
            </p>
          ) : null}
          {importMessage ? (
            <p className={styles.ok} role="status">
              {importMessage}
            </p>
          ) : null}

          {summary ? (
            <div className={styles.summary}>
              <h3 className={styles.summaryTitle}>What is in that file</h3>
              <dl className={styles.counts}>
                <div>
                  <dt>Watchlists</dt>
                  <dd className="tabular">{summary.watchlists}</dd>
                </div>
                <div>
                  <dt>Watchlist items</dt>
                  <dd className="tabular">{summary.watchlistItems}</dd>
                </div>
                <div>
                  <dt>Notes</dt>
                  <dd className="tabular">{summary.notes}</dd>
                </div>
                <div>
                  <dt>Learning progress</dt>
                  <dd className="tabular">{summary.progress}</dd>
                </div>
                <div>
                  <dt>Bookmarks</dt>
                  <dd className="tabular">{summary.bookmarks}</dd>
                </div>
                <div>
                  <dt>Settings</dt>
                  <dd className="tabular">{summary.preferences}</dd>
                </div>
              </dl>
              <p className={styles.help}>
                Exported {new Date(summary.exportedAt * 1000).toLocaleString()} by Brew Terminal{' '}
                {summary.appVersion}.
              </p>

              <p className={styles.choose}>How should this be applied?</p>
              <div className={styles.actions}>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={runImport.isPending}
                  onClick={() => runImport.mutate('merge')}
                >
                  Merge with what is here
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={runImport.isPending}
                  onClick={() => runImport.mutate('replace')}
                >
                  Replace what is here
                </Button>
              </div>
              <p className={styles.help}>
                Merge adds and updates, and deletes nothing. Replace clears your watchlists, notes,
                progress, bookmarks and settings first — the backup written before the import is how
                you undo that.
              </p>
            </div>
          ) : null}
        </div>
      </Panel>

      <Panel title="How the file is protected">
        <div className={styles.note}>
          <p>
            The password is put through Argon2id — a key-derivation function designed to be slow and
            memory-hungry, so guessing at scale is expensive — and the result encrypts the file with
            XChaCha20-Poly1305. The settings used are recorded inside each file, so files written
            today still open after those settings are strengthened.
          </p>
          <p>
            The file is authenticated as well as encrypted. If a single byte is altered, it will not
            open at all, rather than opening into something subtly wrong.
          </p>
          <p>
            Where you put the file is up to you. In a synced folder, on a USB stick or in an email
            attachment, the password is the only thing protecting it — which is exactly why the file
            is encrypted rather than trusting the location.
          </p>
          <DisclaimerNote variant="block" />
        </div>
      </Panel>
    </div>
  );
}
