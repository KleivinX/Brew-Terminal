# Brew Terminal — Threat Model

Scope: a single-user, local-first desktop app with no server, no accounts and no telemetry.
This document is an engineering artifact, not legal or compliance advice.

---

## 1. Assets worth protecting

| Asset                                      | Sensitivity                                        | Where it lives              |
| ------------------------------------------ | -------------------------------------------------- | --------------------------- |
| Provider API keys (market, news, cloud AI) | **High** — billable, sometimes account-linked      | OS keychain only            |
| `.brewprofile` export files                | **High** — user-portable copy of personal research | User-chosen filesystem path |
| Research notes                             | Medium — may contain personal reasoning            | SQLite                      |
| Watchlists                                 | Medium — reveals interests                         | SQLite                      |
| AI conversation history                    | Medium                                             | SQLite                      |
| Preferences, learning progress             | Low                                                | SQLite                      |
| Cached market/news data                    | Low                                                | SQLite                      |

## 2. Adversaries in scope

1. **Malicious or compromised provider** — returns hostile JSON, oversized payloads, or HTML/JS in text fields.
2. **Malicious `.brewprofile` file** — crafted by an attacker and handed to the user.
3. **Local malware / another user process** — reads files in the app data directory.
4. **Shoulder surfing / screen sharing** — keys or notes visible on screen.
5. **The developer's own mistakes** — a key logged, exported, or shipped in a fixture.
6. **Supply-chain compromise** — a malicious npm or crates.io dependency.

**Out of scope:** an attacker with root/admin on the machine, physical access with full-disk
access to an unlocked session, and OS-level keychain compromise. If those hold, no application
mitigation is meaningful, and claiming otherwise would be dishonest.

---

## 3. Untrusted provider content

**Threat:** a provider (or a MITM on a misconfigured endpoint) returns a coin named
`<img src=x onerror=…>`, a `NaN` price, a timestamp in the year 33000, a 200 MB body, or a
redirect to a file:// URL.

**Mitigations:**

- Deserialize into provider-specific DTOs, then range-check before normalizing: prices finite and non-negative, timestamps within [2000-01-01, now + 24 h], symbols matching `^[A-Za-z0-9.\-]{1,20}$`, currency ISO-4217-shaped, strings length-capped.
- Response body cap (2 MB default, per-endpoint override); requests time out at 15 s; redirects capped at 3 and restricted to https.
- HTTPS enforced for all remote providers. The only permitted plaintext HTTP is a loopback AI endpoint, and the UI labels it distinctly.
- React escapes text by default; `dangerouslySetInnerHTML` is banned by an ESLint rule with no allowed exceptions. Provider-supplied HTML is never rendered — descriptions are converted to plain text.
- Article/community links open in the OS browser via the Tauri opener, with an https-scheme allowlist. No in-app navigation to third-party pages, so no third-party origin ever executes inside the app's webview.
- Webview CSP: `default-src 'self'`, `connect-src` IPC only, `script-src 'self'`, `object-src 'none'`, `frame-src 'none'`. Remote images are fetched and cached by Rust or not shown; `img-src` is `'self' data:`.
- One bad record fails that record, not the request. A malformed row is dropped with a counter, not a blanked table.

---

## 4. API keys

**Threat:** key leaks through logs, error strings, IPC payloads, exports, crash reports or screenshots.

**Mitigations:**

- Keys live only in the OS keychain (`keyring` crate). Never in SQLite, config files, environment files, or fixtures.
- Keys are read inside the Rust HTTP layer at request time and are never sent over IPC. `get_provider_config` returns `has_credential: bool` and a masked hint (`sk-…4f2a`) — the full value is unrecoverable through the IPC surface by construction.
- `tracing` runs behind a redaction layer that strips known secret values and query parameters matching `(api[_-]?key|token|secret|apikey|auth)` before any log write.
- `AppError` messages are user-safe by type: no raw URLs with query strings, no raw provider bodies.
- Exports exclude credentials with no v0.1 opt-in.
- CI check: a test asserts that a fixture key value appears in no log output, no serialized error, no IPC response and no export payload. `gitleaks` runs in CI over the repo.
- **Linux caveat, stated plainly:** where no Secret Service provider is running (minimal WMs, some headless setups), the app offers a session-only in-memory key that is discarded on quit, with an explicit warning. It never silently falls back to a plaintext file.

---

## 5. Local data at rest

The SQLite database is **not** encrypted in v0.1. Rationale: without an account or a password
prompt, any key the app can retrieve unattended is retrievable by anything running as the user —
so DB encryption would provide the appearance of protection, not protection. Instead:

- The DB is created with `0600` permissions in the OS-designated app data directory.
- No secrets are stored in it, so the worst case is disclosure of watchlists, notes and cache — Medium, not High.
- The Privacy page says exactly this, in plain language, rather than implying the file is encrypted.
- SQLCipher remains a documented future option and is worth revisiting if optional app-lock ever ships (`DECISIONS.md` can carry the ADR then).

---

## 6. `.brewprofile` encryption

### 6.1 Construction

```
File layout:
  magic        "BREWPROF"                     (8 bytes)
  format_ver   u16 LE                         (2 bytes)  = 1
  kdf_id       u8                             (1 byte)   = 1 (Argon2id)
  aead_id      u8                             (1 byte)   = 1 (XChaCha20-Poly1305)
  m_cost_kib   u32 LE                         (4 bytes)
  t_cost       u32 LE                         (4 bytes)
  p_cost       u32 LE                         (4 bytes)
  salt_len     u8  + salt                     (16 bytes)
  nonce                                       (24 bytes)
  ciphertext || Poly1305 tag                  (rest)

key        = Argon2id(password, salt, m_cost, t_cost, p_cost) -> 32 bytes
ciphertext = XChaCha20-Poly1305(key, nonce, plaintext, aad = header_bytes)
plaintext  = zstd(JSON payload)
```

The entire fixed header is bound as additional authenticated data, so downgrading `format_ver`
or weakening the advertised KDF parameters invalidates the tag. Salt and nonce come from the OS
CSPRNG. Nothing here is invented cryptography: Argon2id and XChaCha20-Poly1305 are used as
their RustCrypto implementations intend.

### 6.2 Parameters

Proposed defaults, tuned for the reference 2016 dual-core machine: `m_cost = 64 MiB`,
`t_cost = 3`, `p_cost = 1`. Expected derivation cost is a few hundred milliseconds there,
which is acceptable for a manual export/import and materially expensive to brute-force.
Parameters are recorded per-file, so raising them later does not break old files.

**Resolved (owner decision, 2026-08-22):** exports require a **minimum 12-character password**
and show a live strength meter. A forgotten password is unrecoverable and a weak one defeats
Argon2id outright, so the floor is doing real work rather than performing security theatre.
The strength meter scores length, character-class variety and common-password membership, and
is advisory above the 12-character floor.

### 6.3 Handling rules

- Password is read into a `Zeroize`-wrapped buffer, never logged, never sent over IPC in cleartext beyond the single command invocation, and zeroized on drop. The derived key is likewise zeroized.
- Decryption is all-or-nothing: authenticate first, then parse. A tampered file fails before any parsing of attacker-controlled structure.
- The decrypted payload is schema-validated with the same rigor as provider data — a valid tag proves the file came from someone with the password, not that its contents are sane.
- Import writes inside one transaction, after an automatic DB backup, and requires an explicit merge-or-replace choice.
- Import is rate-limited (short delay after a failed password) to make offline-adjacent guessing through the UI unattractive. The real defence is the KDF.
- The UI states, without softening, that a forgotten password means the file cannot be recovered by anyone including the project.

### 6.4 Residual risks accepted

- A weak user password defeats any KDF. Mitigation is the 12-character floor plus the strength meter — neither of which stops a determined user from choosing `passwordpassword`.
- Export files inherit the security of wherever the user puts them. If that is a synced cloud folder, the file's protection is the password alone — which is precisely why it is encrypted.

---

## 7. Cloud AI privacy

**Threat:** private notes or watchlists silently transmitted to a third party.

**Mitigations:**

- Cloud AI is disabled until the user configures it, and no request is ever made without a direct user action. No background summarization, no prefetch, no "helpful" auto-context.
- Context attachment is explicit and itemized: the pre-send panel lists every item that will be transmitted, with a character count, and the user confirms.
- Mode is labelled at all times. "Local · offline" is shown **only** when the configured endpoint resolves to a loopback address; anything else reads "Local endpoint · network".
- `ai_outbound_log` records provider, mode, character count and context kinds for every send — never prompt text — and Settings → Privacy renders it.
- Model output is treated as untrusted text: rendered as plain text/escaped Markdown, no HTML, no auto-executed links.
- Prompt-injection reality check: a hostile news headline or community post attached as context can attempt to steer the model. Attached context is wrapped in explicit delimiters and labelled as untrusted quoted material in the system prompt. Forged delimiters inside attached text are neutralised before assembly. This reduces the risk; it does not eliminate it, and the docs say so.

**One transport exception, deliberately made (ADR-029).** §3 states that all outbound HTTP is
HTTPS-only. The Model Desk's adapter is the single exception: it permits plain HTTP **when, and
only when, the endpoint's host resolves to a loopback address**. Every local model server people
actually run serves plain HTTP on `127.0.0.1` and ships no certificate, so enforcing HTTPS there
would have broken the one mode that transmits nothing off the machine. A non-loopback host must
use HTTPS, and a cloud endpoint gets no loopback exemption at all — it carries a credential.

**Residual risk accepted:** the host is resolved once to classify it and again by the HTTP client
when the request is sent. A resolver answering differently between the two would make the
"Local · offline" label wrong. This is not defended against; it is disclosed.

---

## 8. Supply chain

- Dependencies are few and justified individually in `DEPENDENCIES.md`; adding one requires an ADR-style note.
- Lockfiles committed; `npm ci` and `cargo build --locked` in CI.
- `cargo audit` / `cargo deny` and `npm audit` run in CI; advisories block merge at high severity.
- No `postinstall` scripts from direct dependencies without review; Dependabot updates are reviewed, not auto-merged.
- No analytics, session-replay, or font/CDN loads at runtime. Typefaces are bundled and served from the app's own origin.
- **One background request path exists, and only one: the alert poller.** It is off by default, makes no request at all unless the user has both switched it on and armed an alert, and fetches only the assets those alerts name. Everything else in the app still traces to a direct user action. The exception is bounded in `services::alerts` and the setting that enables it says what it does — an undocumented exception would be the more serious problem than the requests.

---

## 9. Tauri configuration hardening

- Capabilities are least-privilege: the frontend gets the app's own commands, plus a narrowly scoped opener and dialog. No filesystem scope beyond the explicit export/import dialog paths. No shell plugin.
- `withGlobalTauri: false` — no `window.__TAURI__` grab-bag on the page.
- Devtools disabled in release builds.
- Strict CSP as in §3.
- Updater is not enabled in v0.1; if it ever is, it requires signed releases and gets its own ADR.

---

## 10. Open security questions

1. Should Settings offer an optional app-lock (password-gated launch)? It changes the §5 calculus and would justify SQLCipher. Currently out of v0.1 scope.
2. Should AI conversation history be exportable at all? Currently excluded from `.brewprofile`.
3. Linux keychain fallback: is session-only memory storage the right degradation, or should key entry simply be refused on systems without a Secret Service?
