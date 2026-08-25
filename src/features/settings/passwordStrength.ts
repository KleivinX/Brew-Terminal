/**
 * The export password meter described in THREAT_MODEL.md §6.2.
 *
 * Two things it is not. It is **not a gate** — the only hard requirement is the 12-character
 * floor, which Rust enforces; everything here is advice. And it is **not an entropy estimate**:
 * a real one needs a large dictionary and a pattern model, and shipping a number that looks
 * precise while being a guess would be worse than a coarse honest scale.
 *
 * What it does score is what a user can actually act on: length, character-class variety, and
 * whether the thing they typed is one of the passwords everybody tries first.
 */

export const MIN_PASSWORD_CHARS = 12;

export type StrengthLevel = 'too-short' | 'weak' | 'fair' | 'strong';

export interface PasswordStrength {
  level: StrengthLevel;
  label: string;
  /** One concrete thing that would improve it, or null when there is nothing to add. */
  advice: string | null;
  /** 0–4, for the meter bars. */
  score: number;
}

/**
 * The passwords and patterns that get tried first.
 *
 * Deliberately short. A real cracking dictionary is millions of entries and shipping one would
 * add megabytes to catch cases the length floor already makes rare — but "passwordpassword" is
 * exactly the 16-character string someone reaches for when told to use twelve characters, and
 * it is worth naming.
 */
const COMMON = [
  'password',
  'passwort',
  'qwerty',
  'azerty',
  'letmein',
  'welcome',
  'iloveyou',
  'monkey',
  'dragon',
  'football',
  'baseball',
  'sunshine',
  'princess',
  'admin',
  'login',
  'abc123',
  'trustno1',
  'starwars',
  'whatever',
  'brewterminal',
  'bitcoin',
];

function isRepeatedOrSequential(value: string): boolean {
  const lower = value.toLowerCase();

  /*
   * "aaaaaaaaaaaa", or a short unit repeated to reach the floor: "abcabcabcabc".
   *
   * Checked against an infinite repetition rather than an exact multiple, because someone
   * padding to twelve characters usually stops mid-unit — "abcabcabcabca" is every bit as
   * guessable as "abcabcabcabc" and an exact-multiple check would wave it through.
   */
  for (let unit = 1; unit <= 4; unit += 1) {
    if (lower.length <= unit) continue;
    let repeats = true;
    for (let i = unit; i < lower.length; i += 1) {
      if (lower[i] !== lower[i % unit]) {
        repeats = false;
        break;
      }
    }
    if (repeats) return true;
  }

  // "123456789012" or "abcdefghijkl".
  let ascending = true;
  for (let i = 1; i < lower.length; i += 1) {
    if (lower.charCodeAt(i) !== lower.charCodeAt(i - 1) + 1) {
      ascending = false;
      break;
    }
  }
  return ascending && lower.length > 4;
}

function classesUsed(value: string): number {
  let classes = 0;
  if (/[a-z]/.test(value)) classes += 1;
  if (/[A-Z]/.test(value)) classes += 1;
  if (/[0-9]/.test(value)) classes += 1;
  if (/[^a-zA-Z0-9]/.test(value)) classes += 1;
  return classes;
}

export function scorePassword(value: string): PasswordStrength {
  const length = [...value].length;

  if (length < MIN_PASSWORD_CHARS) {
    return {
      level: 'too-short',
      label: `${MIN_PASSWORD_CHARS - length} more character${
        MIN_PASSWORD_CHARS - length === 1 ? '' : 's'
      } needed`,
      advice: `Exports require at least ${MIN_PASSWORD_CHARS} characters.`,
      score: 0,
    };
  }

  const lower = value.toLowerCase();
  const containsCommon = COMMON.some((word) => lower.includes(word));

  if (containsCommon || isRepeatedOrSequential(value)) {
    return {
      level: 'weak',
      label: 'Weak',
      advice: containsCommon
        ? 'That contains a word attackers try first. A few unrelated words work better.'
        : 'That is a repeated or sequential pattern, which is guessed quickly.',
      score: 1,
    };
  }

  const classes = classesUsed(value);

  // Length does most of the work — a long passphrase of plain words beats a short one with
  // punctuation sprinkled in, and saying otherwise would push people toward the weaker habit.
  if (length >= 20 || (length >= 16 && classes >= 2)) {
    return { level: 'strong', label: 'Strong', advice: null, score: 4 };
  }

  if (length >= 16 || classes >= 3) {
    return {
      level: 'fair',
      label: 'Fair',
      advice: 'Longer is the easiest improvement. Four or five unrelated words is plenty.',
      score: 3,
    };
  }

  return {
    level: 'fair',
    label: 'Fair',
    advice: 'Length helps more than symbols. Try adding a couple more words.',
    score: 2,
  };
}
