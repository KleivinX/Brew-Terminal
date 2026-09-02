/**
 * Text helpers for the notes workspace.
 *
 * Separate from the component so they can be tested directly — these are the two places the
 * list view can quietly mangle what someone wrote.
 */

/** Mirrors `repo_notes::MAX_NOTE_BODY`. */
export const MAX_NOTE_BODY = 20_000;
/** Mirrors `repo_notes::MAX_NOTE_TITLE`. */
export const MAX_NOTE_TITLE = 200;

/** How much of a note body the list row shows. */
const SNIPPET_LENGTH = 120;

/**
 * One line of preview text from a note body.
 *
 * Newlines collapse to spaces so a note that starts with a blank line or a Markdown heading
 * still previews as something readable rather than as an empty row. Truncation is by
 * `Array.from`, not `slice`: `slice` counts UTF-16 code units and will cut an emoji or any
 * astral character in half, leaving a lone surrogate that renders as a replacement glyph.
 */
export function snippetOf(body: string): string {
  const flattened = body.replace(/\s+/g, ' ').trim();
  if (!flattened) return '';

  const characters = Array.from(flattened);
  if (characters.length <= SNIPPET_LENGTH) return flattened;
  return `${characters.slice(0, SNIPPET_LENGTH).join('').trimEnd()}…`;
}

/**
 * The display symbol for a note attached to an asset.
 *
 * Canonical ids look like `crypto:cg:bitcoin`, so the last segment is the identifier a reader
 * recognises. Falls back to the whole id rather than to an empty tag — an unfamiliar shape
 * should still show something rather than a blank chip.
 */
export function noteSymbol(assetId: string): string {
  const last = assetId.split(':').filter(Boolean).pop();
  return (last ?? assetId).toUpperCase();
}
