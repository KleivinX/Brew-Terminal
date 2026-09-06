import type { ConnectorInfo, ConnectorStage, TermsRisk } from '@/types/domain';

/**
 * The words the connectors table uses, in one place.
 *
 * Separate from the components because the table, the detail panel and the tests all have to
 * agree on them — and because "what does this badge actually mean" is the question this whole
 * screen exists to answer, so the answers deserve somewhere to be read.
 */

export const STAGE_LABEL: Record<ConnectorStage, string> = {
  wired: 'Wired',
  declined: 'Declined',
  candidate: 'Not reviewed',
};

/** What the stage commits the reader to believing. */
export const STAGE_MEANING: Record<ConnectorStage, string> = {
  wired:
    'Terms read and recorded, adapter written, tests passing. The limits and attribution shown here come from the provider.',
  declined:
    'Terms read, and the answer was no — or not yet. The reason is recorded so nobody repeats the research.',
  candidate:
    'A name and a category. Nobody has read this provider’s terms, so this app makes no claim about its limits, its licence, or whether it could be used at all.',
};

export const AUTH_LABEL: Record<NonNullable<ConnectorInfo['auth']>, string> = {
  keyless: 'No key',
  'api-key': 'API key',
  oauth: 'OAuth',
  mixed: 'Key optional',
};

export const RISK_TONE: Record<TermsRisk, 'ok' | 'caution' | 'warn'> = {
  'core-ok': 'ok',
  tight: 'caution',
  'paid-for-production': 'caution',
  'requires-written-agreement': 'warn',
};

/**
 * One word for what this connector is doing right now.
 *
 * "Always on" is its own state rather than being folded into "On", because two wired adapters
 * genuinely have no switch — the services that use them construct them directly — and showing
 * them as switchable would be showing a control that does nothing.
 */
export function statusLabel(connector: ConnectorInfo): string {
  if (connector.stage === 'declined') return 'Not used';
  if (connector.stage === 'candidate') return '—';
  if (!connector.userControllable) return 'Always on';
  if (connector.requiresCredential && !connector.hasCredential) return 'Needs a key';
  return connector.enabled ? 'On' : 'Off';
}
