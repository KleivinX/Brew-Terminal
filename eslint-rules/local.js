/**
 * Project-local ESLint rules.
 *
 * These are not style preferences — each one enforces a guarantee stated in the project
 * documentation. They are the reason ADR-014 pins TypeScript to a version typescript-eslint
 * supports: without type-aware linting, these rules are where the safety promises would rot.
 */

/**
 * Words and phrases that must never reach a user-facing surface.
 *
 * From PRODUCT_SCOPE_V0_1.md §6. Language like "scam score" or "guaranteed" implies a verdict
 * or an outcome the app has no basis to offer, and "signal"/"best trade" implies advice.
 */
const BANNED_PATTERNS = [
  { pattern: /\bscam\s+score\b/i, why: 'implies a verdict the app cannot justify' },
  { pattern: /\bfake\s+coin\b/i, why: 'implies a legitimacy determination' },
  { pattern: /\bcoin\s+detector\b/i, why: 'implies a legitimacy determination' },
  { pattern: /\bguaranteed?\b/i, why: 'implies a certain outcome' },
  { pattern: /\brisk[- ]free\b/i, why: 'implies a certain outcome' },
  { pattern: /\bsafe\s+investment\b/i, why: 'implies a recommendation' },
  { pattern: /\bbest\s+trade\b/i, why: 'implies a recommendation' },
  { pattern: /\bstrong\s+buy\b/i, why: 'is a trading recommendation' },
  { pattern: /\bprice\s+target\b/i, why: 'is a price prediction' },
  { pattern: /\btrading\s+signals?\b/i, why: 'implies actionable trading guidance' },
  { pattern: /\bto\s+the\s+moon\b/i, why: 'is hype language' },
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
