/**
 * Project-local ESLint rules.
 *
 * These are not style preferences — each one enforces a guarantee stated in the project
 * documentation. They are the reason ADR-014 pins TypeScript to a version typescript-eslint
 * supports: without type-aware linting, these rules are where the safety promises would rot.
 */

/**
 * Words and phrases the app may never say in its own voice.
 *
 * This list governs *Brew Terminal's copy*, not what a provider or a model says. It is
 * deliberately narrower than it used to be. The old list also banned "price target",
 * "strong buy" and "trading signal", which are not claims — they are the names of things real
 * terminals show. Banning the vocabulary banned the features, and a research tool that cannot
 * display an analyst rating because of a lint rule is hobbled for no safety gain.
 *
 * What stays banned is what the app has no basis to assert in the first place. A verdict on
 * whether something is a scam, or a promise that a return is guaranteed or risk-free, is not a
 * feature that needs unlocking — it is a claim that would be false however it were framed.
 *
 * Third-party ratings and targets are fine to render *attributed*: "Mean analyst target $180
 * (24 analysts, via Finnhub)" reports what other people think and says whose opinion it is.
 * "Price target: $180" in the app's own voice does not, and is what the review in
 * PRODUCT_SCOPE_V0_1.md §6 is for.
 */
const BANNED_PATTERNS = [
  // Verdicts on legitimacy. The app has no basis for one and will not be acquiring one.
  { pattern: /\bscam\s+score\b/i, why: 'implies a verdict the app cannot justify' },
  { pattern: /\bfake\s+coin\b/i, why: 'implies a legitimacy determination' },
  { pattern: /\bcoin\s+detector\b/i, why: 'implies a legitimacy determination' },

  // Claims about outcomes. False for every market instrument that exists, so no framing
  // rescues them.
  {
    pattern: /\bguaranteed?\s+(?:returns?|profits?|gains?|income)\b/i,
    why: 'promises an outcome nothing can promise',
  },
  {
    pattern: /\brisk[- ]free\s+(?:returns?|profits?|trade|investment)\b/i,
    why: 'no market instrument is risk-free',
  },
  { pattern: /\bsafe\s+investment\b/i, why: 'is a verdict on suitability' },
  // Both apostrophes: editors turn a typed ' into ’ and the rule should not be dodgeable by
  // smart quotes.
  { pattern: /\bcan['’]?t\s+lose\b/i, why: 'promises an outcome nothing can promise' },
  { pattern: /\bto\s+the\s+moon\b/i, why: 'is hype, and hype is a promise in disguise' },

  // The app speaking as though it had a position. Showing someone else's is fine; holding one
  // is what makes software an adviser.
  {
    pattern: /\bwe\s+recommend\s+(?:buying|selling|shorting)\b/i,
    why: 'is the app taking a position',
  },
  { pattern: /\byou\s+should\s+(?:buy|sell|short)\b/i, why: 'is the app taking a position' },
  { pattern: /\bour\s+(?:pick|call)\s+of\s+the\b/i, why: 'is the app taking a position' },
];

const noBannedCopy = {
  meta: {
    type: 'problem',
    docs: { description: 'Ban advice-shaped or hype language in user-facing copy.' },
    schema: [],
    messages: {
      banned:
        'User-facing copy must not contain "{{text}}" — it {{why}}. See PRODUCT_SCOPE_V0_1.md §6.',
    },
  },
  create(context) {
    const check = (node, value) => {
      if (typeof value !== 'string' || value.length < 3) return;
      for (const { pattern, why } of BANNED_PATTERNS) {
        const match = pattern.exec(value);
        if (match) {
          context.report({ node, messageId: 'banned', data: { text: match[0], why } });
          return;
        }
      }
    };

    return {
      Literal(node) {
        check(node, node.value);
      },
      JSXText(node) {
        check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked);
      },
    };
  },
};

const noCrossFeatureImport = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'A feature slice may not import from another feature slice. Shared code moves down into components/ or lib/.',
    },
    schema: [],
    messages: {
      cross:
        'Feature "{{from}}" must not import from feature "{{to}}". Move the shared code into lib/ or components/ instead. See ARCHITECTURE.md §3.1.',
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();
    const match = /[\\/]src[\\/]features[\\/]([^\\/]+)[\\/]/.exec(filename);
    if (!match) return {};
    const currentFeature = match[1];

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (typeof source !== 'string') return;
        const target = /^@[\\/]features[\\/]([^\\/]+)/.exec(source);
        if (target && target[1] !== currentFeature) {
          context.report({
            node: node.source,
            messageId: 'cross',
            data: { from: currentFeature, to: target[1] },
          });
        }
      },
    };
  },
};

const noRawHtml = {
  meta: {
    type: 'problem',
    docs: { description: 'Ban dangerouslySetInnerHTML — provider content is untrusted.' },
    schema: [],
    messages: {
      danger:
        'dangerouslySetInnerHTML is banned with no exceptions. Provider and model output is untrusted input; render it as text. See THREAT_MODEL.md §3.',
    },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name && node.name.name === 'dangerouslySetInnerHTML') {
          context.report({ node, messageId: 'danger' });
        }
      },
    };
  },
};

export default {
  rules: {
    'no-banned-copy': noBannedCopy,
    'no-cross-feature-import': noCrossFeatureImport,
    'no-raw-html': noRawHtml,
  },
};
