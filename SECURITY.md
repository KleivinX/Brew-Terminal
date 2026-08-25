# Security policy

## Reporting a vulnerability

**Do not open a public issue for a security vulnerability.**

Report it privately through GitHub's [private vulnerability
reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)
on this repository. If that is unavailable, contact the project owner through the address in
the repository profile.

Please include: what the issue is, how to reproduce it, what an attacker could achieve, and the
version and OS you tested on. A proof of concept helps.

**What to expect.** This is a small open-source project without a dedicated security team, so
no formal response-time guarantee is offered — anything else would be a promise it cannot keep.
Reports will be acknowledged as soon as they are seen, and credited in the fix unless you
prefer otherwise. Please give a reasonable window to fix before public disclosure.

## Scope

**In scope:**

- Leaking API keys or credentials through logs, errors, IPC payloads, exports or the UI
- Code execution via untrusted provider content, news articles, community posts or model output
- Weaknesses in `.brewprofile` encryption or its key derivation
- Data sent to a remote service without an explicit user action
- Escaping the webview's CSP or the Tauri capability restrictions
- SQL injection or path traversal through a command

**Out of scope:**

- Anything requiring root/administrator access on the machine
- Anything requiring physical access to an unlocked session
- Compromise of the OS keychain itself
- The SQLite database being readable by the user who owns it — this is [documented, intended behaviour](docs/THREAT_MODEL.md#5-local-data-at-rest), not a vulnerability
- Vulnerabilities in a data provider's own service
- Missing hardening that has no demonstrated impact

## Design commitments

These are the guarantees this project intends to keep. A break in any of them is a security
bug worth reporting:

1. **API keys never enter the webview.** They live in the OS keychain and are used only inside the Rust process. The IPC surface returns a boolean and a masked hint, never a key.
2. **The webview cannot reach the network.** CSP restricts `connect-src` to IPC. All HTTP happens in Rust.
3. **Nothing leaves the device without a user action.** No background sync, no prefetch to remote services, no telemetry.
4. **Provider content is untrusted.** Validated before use, rendered as text, never as HTML. `dangerouslySetInnerHTML` is banned by a lint rule with no exceptions.
5. **External links open in the OS browser**, https only. No third-party origin executes inside the app.
6. **Exports contain no credentials**, and are authenticated-encrypted with a memory-hard KDF.

Full analysis, including what is explicitly _not_ protected: [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).

## Supported versions

The project is pre-1.0. Only the latest release receives fixes.
