/**
 * Session-scoped facts about the Model Desk.
 *
 * "Session" means one run of the app: this is module state, so it resets when the window
 * reloads. That is the right granularity for AI_POLICY.md §2.3, which asks for a warning
 * before the *first* cloud send of a session — a flag persisted to the database would show it
 * once ever and then never again, which is not what "each session" means.
 */

let cloudSendHappened = false;

export function isFirstCloudSendOfSession(): boolean {
  return !cloudSendHappened;
}

export function markCloudSend(): void {
  cloudSendHappened = true;
}

/** Test seam. */
export function __resetSession(): void {
  cloudSendHappened = false;
}
