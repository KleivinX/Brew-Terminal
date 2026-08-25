import { z } from 'zod';

/**
 * The Learn content schema.
 *
 * Content is authored as JSON and validated at build time, in tests, and again on load. The
 * point of validating three times is that authoring mistakes should fail loudly at the moment
 * they are made rather than rendering as an empty page months later — and a cross-reference to
 * a glossary term that does not exist is invisible until someone clicks it.
 *
 * Everything here is plain text, deliberately. There is no HTML and no Markdown rendering, so
 * content cannot introduce an injection surface. See DEPENDENCIES.md.
 */

const id = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'ids are lowercase kebab-case');

/** Keeps prose readable and stops a wall of text arriving as one paragraph. */
const paragraph = z.string().min(20).max(900);

export const glossaryCategory = z.enum(['markets', 'stocks', 'crypto', 'risk', 'mechanics']);

export const glossaryEntrySchema = z
  .object({
    id,
    term: z.string().min(1).max(60),
    /** Other names for the same thing, matched by search. */
    aliases: z.array(z.string().min(1).max(60)).max(6).default([]),
    category: glossaryCategory,
    /** One sentence. Shown in search results and in the index. */
    short: z.string().min(20).max(220),
    body: z.array(paragraph).min(1).max(8),
    /** Glossary ids. Validated to exist in `validateContent`. */
    seeAlso: z.array(id).max(8).default([]),
  })
  .strict();

export const lessonSchema = z
  .object({
    id,
    title: z.string().min(3).max(90),
    summary: z.string().min(20).max(300),
    body: z.array(paragraph).min(2).max(12),
    /** Glossary ids introduced by this lesson. Validated to exist. */
    keyTerms: z.array(id).max(12).default([]),
  })
  .strict();

export const learningPathSchema = z
  .object({
    id,
    title: z.string().min(3).max(60),
    description: z.string().min(20).max(300),
    lessons: z.array(lessonSchema).min(3).max(12),
  })
  .strict();

export type GlossaryEntry = z.infer<typeof glossaryEntrySchema>;
export type Lesson = z.infer<typeof lessonSchema>;
export type LearningPath = z.infer<typeof learningPathSchema>;

export interface LearnContent {
  glossary: GlossaryEntry[];
  paths: LearningPath[];
}

/**
 * Banned vocabulary, checked across every string in the content bundle.
 *
 * The ESLint rule covers source files; content is JSON, so it needs its own pass. Educational
 * copy is exactly where advice-shaped language creeps in most easily — it is the one place in
 * the app whose whole job is to explain, and explaining slides into recommending.
 *
 * See PRODUCT_SCOPE_V0_1.md §6.
 */
const BANNED: { pattern: RegExp; why: string }[] = [
  { pattern: /\bscam score\b/i, why: 'implies a verdict' },
  { pattern: /\bguaranteed?\s+(returns?|profit|gains?)\b/i, why: 'implies a certain outcome' },
  { pattern: /\brisk[- ]free\b/i, why: 'implies a certain outcome' },
  { pattern: /\bsafe investment\b/i, why: 'implies a recommendation' },
  { pattern: /\bbest (trade|stock|coin|investment)\b/i, why: 'implies a recommendation' },
  { pattern: /\bstrong buy\b/i, why: 'is a trading recommendation' },
  { pattern: /\bprice target\b/i, why: 'is a price prediction' },
  { pattern: /\btrading signals?\b/i, why: 'implies actionable guidance' },
  { pattern: /\bto the moon\b/i, why: 'is hype language' },
  { pattern: /\byou should (buy|sell|invest|hold)\b/i, why: 'is direct financial advice' },
  { pattern: /\bwe recommend\b/i, why: 'is direct financial advice' },
];

export interface ValidationIssue {
  where: string;
  problem: string;
}

/**
 * Validates a whole content bundle: shapes, unique ids, cross-references, and language.
 *
 * Returns every problem rather than throwing on the first, so an author fixing content sees
 * the full list in one pass.
 */
export function validateContent(raw: { glossary: unknown; paths: unknown }): {
  content: LearnContent | null;
  issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];

  const glossaryResult = z.array(glossaryEntrySchema).safeParse(raw.glossary);
  const pathsResult = z.array(learningPathSchema).safeParse(raw.paths);

  if (!glossaryResult.success) {
    for (const issue of glossaryResult.error.issues) {
      issues.push({ where: `glossary.${issue.path.join('.')}`, problem: issue.message });
    }
  }
  if (!pathsResult.success) {
    for (const issue of pathsResult.error.issues) {
      issues.push({ where: `paths.${issue.path.join('.')}`, problem: issue.message });
    }
  }

  if (!glossaryResult.success || !pathsResult.success) {
    return { content: null, issues };
  }

  const glossary = glossaryResult.data;
  const paths = pathsResult.data;

  // --- unique ids ---
  const seenTerms = new Set<string>();
  for (const entry of glossary) {
    if (seenTerms.has(entry.id)) {
      issues.push({ where: `glossary/${entry.id}`, problem: 'duplicate glossary id' });
    }
    seenTerms.add(entry.id);
  }

  const seenPaths = new Set<string>();
  for (const path of paths) {
    if (seenPaths.has(path.id)) {
      issues.push({ where: `paths/${path.id}`, problem: 'duplicate path id' });
    }
    seenPaths.add(path.id);

    const seenLessons = new Set<string>();
    for (const lesson of path.lessons) {
      if (seenLessons.has(lesson.id)) {
        issues.push({
          where: `paths/${path.id}/${lesson.id}`,
          problem: 'duplicate lesson id within the path',
        });
      }
      seenLessons.add(lesson.id);
    }
  }

  // --- cross-references resolve ---
  for (const entry of glossary) {
    for (const ref of entry.seeAlso) {
      if (!seenTerms.has(ref)) {
        issues.push({
          where: `glossary/${entry.id}`,
          problem: `seeAlso points at "${ref}", which is not a glossary entry`,
        });
      }
      if (ref === entry.id) {
        issues.push({ where: `glossary/${entry.id}`, problem: 'seeAlso points at itself' });
      }
    }
  }

  for (const path of paths) {
    for (const lesson of path.lessons) {
      for (const ref of lesson.keyTerms) {
        if (!seenTerms.has(ref)) {
          issues.push({
            where: `paths/${path.id}/${lesson.id}`,
            problem: `keyTerms points at "${ref}", which is not a glossary entry`,
          });
        }
      }
    }
  }

  // --- language ---
  const checkText = (where: string, text: string): void => {
    for (const { pattern, why } of BANNED) {
      const match = pattern.exec(text);
      if (match) {
        issues.push({ where, problem: `"${match[0]}" ${why}` });
      }
    }
  };

  for (const entry of glossary) {
    checkText(`glossary/${entry.id}`, [entry.term, entry.short, ...entry.body].join(' '));
  }
  for (const path of paths) {
    checkText(`paths/${path.id}`, `${path.title} ${path.description}`);
    for (const lesson of path.lessons) {
      checkText(
        `paths/${path.id}/${lesson.id}`,
        [lesson.title, lesson.summary, ...lesson.body].join(' '),
      );
    }
  }

  return { content: issues.length === 0 ? { glossary, paths } : null, issues };
}
