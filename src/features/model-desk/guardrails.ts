/**
 * Client-side layers 1 and 3 of the four in AI_POLICY.md §5.
 *
 * Layer 1 runs before a send: an advice-shaped prompt gets an inline note offering an
 * educational reframing. It is a **nudge, not a block** — the original text is never rewritten,
 * never replaced, and the send button stays enabled. A guardrail that silently edits what
 * someone typed is worse than none, because they no longer know what they asked.
 *
 * Layer 3 runs after a response: a match on the banned vocabulary adds a visible caution above
 * the answer. The answer is still shown in full. Hiding model output would leave the user
 * unable to judge whether their model is behaving, which is the thing they most need to see.
 *
 * This file necessarily contains the phrases it detects. `tests/safety/copy.test.ts` excludes
 * it for the same reason it excludes the lint rule definition, and asserts in exchange that
 * this list covers every phrase that rule bans.
 */

export interface AdviceNudge {
  /** The fragment of the prompt that triggered it, quoted back so the note is concrete. */
  matched: string;
  /** A suggested educational rewrite. Offered, never applied. */
  reframing: string;
}

interface AdvicePattern {
  pattern: RegExp;
  reframe: (subject: string) => string;
}

/** Cleans a captured subject so it reads inside a sentence. */
function subjectOf(raw: string | undefined): string {
  const cleaned = (raw ?? '').trim().replace(/[?.!,]+$/, '');
  return cleaned.length > 0 && cleaned.length <= 60 ? cleaned : 'it';
}

/**
 * The shapes AI_POLICY.md §5.1 names: what to buy, whether to sell, where a price is going,
 * and whether something is a good investment.
 */
const ADVICE_PATTERNS: AdvicePattern[] = [
  {
    pattern: /\b(?:should|shall)\s+i\s+(?:buy|invest\s+in|get\s+into)\s*([^?.!,\n]{0,60})/i,
    reframe: (s) => `What is ${s}, how does this kind of asset work, and what are its main risks?`,
  },
  {
    pattern: /\b(?:should|shall)\s+i\s+(?:sell|dump|exit|get\s+out\s+of)\s*([^?.!,\n]{0,60})/i,
    reframe: (s) => `What determines the value of ${s}, and what do people usually research first?`,
  },
  {
    pattern: /\b(?:should|shall)\s+i\s+(?:hold|keep|hodl)\s*([^?.!,\n]{0,60})/i,
    reframe: (s) => `How does ${s} work, and what would change its outlook one way or the other?`,
  },
  {
    pattern:
      /\bis\s+([^?.!,\n]{1,60}?)\s+a\s+(?:good|bad|smart|solid|sound)\s+(?:investment|buy|bet)\b/i,
    reframe: (s) => `What is ${s}, and what are the usual arguments and risks people weigh?`,
  },
  {
    pattern:
      /\b(?:when|what\s+time)\s+(?:should\s+i|to)\s+(?:buy|sell|enter|exit)\s*([^?.!,\n]{0,60})/i,
    reframe: (s) => `What drives the price of ${s}, and why is timing generally hard to call?`,
  },
  {
    pattern:
      /\b(?:price\s+prediction|predict\s+the\s+price|where\s+is\s+([^?.!,\n]{1,40}?)\s+(?:going|headed))\b/i,
    reframe: (s) =>
      `What has historically moved ${s}, and what are the limits of reasoning from that?`,
  },
  {
    pattern: /\bhow\s+much\s+(?:should\s+i|of\s+my\s+portfolio)\b/i,
    reframe: () => 'How do people generally think about sizing and diversification as concepts?',
  },
  {
    pattern: /\bwill\s+([^?.!,\n]{1,40}?)\s+(?:go\s+up|go\s+down|moon|crash|rise|fall)\b/i,
    reframe: (s) => `What factors are usually discussed when people look at ${s}?`,
  },
];

/**
 * Looks for an advice-shaped question.
 *
 * Returns the first match only. Listing every trigger would turn a gentle note into a lecture,
 * and the reframing for the first match is almost always the useful one.
 */
export function detectAdviceShapedPrompt(prompt: string): AdviceNudge | null {
  for (const { pattern, reframe } of ADVICE_PATTERNS) {
    const match = pattern.exec(prompt);
    if (match) {
      return {
        matched: match[0].trim(),
        reframing: reframe(subjectOf(match[1])),
      };
    }
  }
  return null;
}

/**
 * Vocabulary that earns a caution when it appears in a response.
 *
 * The first eleven are exactly the patterns `eslint-rules/local.js` bans in the app's own copy;
 * a test asserts this list still covers all of them. The rest are model-specific: things a
 * chat model says that the app's own copy would never contain.
 */
export const RESPONSE_CAUTION_PATTERNS: RegExp[] = [
  /\bscam\s+score\b/i,
  /\bfake\s+coin\b/i,
  /\bcoin\s+detector\b/i,
  /\bguaranteed?\s+(returns?|profit|gains?)\b/i,
  /\brisk[- ]free\b/i,
  /\bsafe\s+investment\b/i,
  /\bbest\s+trade\b/i,
  /\bstrong\s+buy\b/i,
  /\bprice\s+target\b/i,
  /\btrading\s+signals?\b/i,
  /\bto\s+the\s+moon\b/i,
  /\bi\s+(?:would\s+)?recommend\s+(?:buying|selling|holding|shorting)\b/i,
  /\byou\s+should\s+(?:buy|sell|hold|short|invest)\b/i,
  /\ballocate\s+\d+\s*%/i,
  /\bwill\s+(?:definitely|certainly|surely)\s+(?:rise|fall|go\s+up|go\s+down)\b/i,
];

/**
 * Scans a response and returns the phrases that earned a caution.
 *
 * Returns what matched rather than a boolean so the caution can quote it. A user told "this
 * answer contains advice-shaped language" learns nothing; one shown the phrase can judge it.
 */
export function scanResponse(text: string): string[] {
  const found: string[] = [];
  for (const pattern of RESPONSE_CAUTION_PATTERNS) {
    const match = pattern.exec(text);
    if (match && !found.includes(match[0])) {
      found.push(match[0]);
    }
  }
  return found;
}
