import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { NotesRoute } from '@/features/notes/NotesRoute';
import { MAX_NOTE_BODY, MAX_NOTE_TITLE, noteSymbol, snippetOf } from '@/features/notes/noteText';
import { __resetHarness } from '@/lib/ipc.browser';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWithProviders } from '../setup/renderWithProviders';
import { findAccessibilityViolations, describeViolations } from '../setup/axe';

beforeEach(() => {
  __resetHarness();
});

/**
 * Renders the route behind both of its paths, the way the real router registers it.
 *
 * The shared helper mounts a bare `MemoryRouter` with no `<Routes>`, so `useParams` never
 * yields a `noteId` and the component can never resolve a selected note — everything that
 * depends on one silently does nothing. Mirroring the real path pair here also makes the deep
 * link itself testable.
 */
function renderNotes(route = '/notes') {
  return renderWithProviders(
    <Routes>
      <Route path="/notes" element={<NotesRoute />} />
      <Route path="/notes/:noteId" element={<NotesRoute />} />
    </Routes>,
    { route },
  );
}

/**
 * Headroom for anything that waits on a round trip.
 *
 * `waitFor` defaults to one second. Saving or deleting a note goes through a mutation, a query
 * invalidation and a refetch, and on a loaded machine — the whole suite in parallel workers,
 * or a Rust build alongside it — that chain does not reliably finish inside a second. The same
 * allowance the compare tests already make for their panels.
 */
const SETTLE = { timeout: 4000 } as const;

function list(): HTMLElement {
  return screen.getByRole('region', { name: 'Notes' });
}

function editor(): HTMLElement {
  return screen.getByRole('region', { name: 'Note editor' });
}

async function write(title: string, body: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getAllByRole('button', { name: /new note|write your first note/i })[0]!);
  await user.type(await screen.findByLabelText('Title'), title);
  await user.type(screen.getByLabelText('Note'), body);
  await user.click(screen.getByRole('button', { name: 'Save note' }));
}

describe('notes workspace', () => {
  it('starts empty and says what to do about it', async () => {
    renderNotes();

    await waitFor(() => expect(within(list()).getByText('No notes yet')).toBeInTheDocument(), SETTLE);
    await waitFor(
      () => expect(within(editor()).getByText('Nothing open')).toBeInTheDocument(),
      SETTLE,
    );
    expect(
      within(list()).getByRole('button', { name: 'Write your first note' }),
    ).toBeInTheDocument();
  });

  it('writes a note and shows it in the list', async () => {
    renderNotes();
    await waitFor(() => screen.getByText('No notes yet'), SETTLE);

    await write('Junk spreads', 'Tightest premium in a year.');

    await waitFor(() => expect(within(list()).getByText('Junk spreads')).toBeInTheDocument(), SETTLE);
    expect(within(list()).getByText('Tightest premium in a year.')).toBeInTheDocument();
    expect(within(list()).getByText('1 note')).toBeInTheDocument();
  });

  /**
   * The gap this route exists to close. `list_notes` takes an asset id, so a note attached to
   * nothing could be written from the research panel and then never seen again.
   */
  it('keeps a note that belongs to no asset', async () => {
    renderNotes();
    await waitFor(() => screen.getByText('No notes yet'), SETTLE);

    await write('General thought', 'Not about any one asset.');

    await waitFor(() => expect(within(list()).getByText('General thought')).toBeInTheDocument(), SETTLE);
  });

  it('confirms the save rather than succeeding silently', async () => {
    renderNotes();
    await waitFor(() => screen.getByText('No notes yet'), SETTLE);

    await write('A title', 'A body.');

    // Regression guard: the confirmation was previously wiped by the effect that re-seeds the
    // editor when the save navigated to the new note's URL, so it never appeared at all.
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved'), SETTLE);
  });

  it('warns while there are unsaved changes', async () => {
    const user = userEvent.setup();
    renderNotes();
    await waitFor(() => screen.getByText('No notes yet'), SETTLE);

    await user.click(screen.getByRole('button', { name: 'Write your first note' }));
    await user.type(await screen.findByLabelText('Title'), 'Half written');

    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes');
  });

  it('will not save an empty note', async () => {
    const user = userEvent.setup();
    renderNotes();
    await waitFor(() => screen.getByText('No notes yet'), SETTLE);

    await user.click(screen.getByRole('button', { name: 'Write your first note' }));
    expect(await screen.findByRole('button', { name: 'Save note' })).toBeDisabled();

    await user.type(screen.getByLabelText('Title'), 'Now it has one');
    expect(screen.getByRole('button', { name: 'Save note' })).toBeEnabled();
  });

  it('labels both fields, rather than relying on placeholders', async () => {
    const user = userEvent.setup();
    renderNotes();
    await waitFor(() => screen.getByText('No notes yet'), SETTLE);
    await user.click(screen.getByRole('button', { name: 'Write your first note' }));

    expect(await screen.findByLabelText('Title')).toBeInTheDocument();
    expect(screen.getByLabelText('Note')).toBeInTheDocument();
  });

  it('says notes stay on this computer', async () => {
    const user = userEvent.setup();
    renderNotes();
    await waitFor(() => screen.getByText('No notes yet'), SETTLE);
    await user.click(screen.getByRole('button', { name: 'Write your first note' }));

    expect(
      await screen.findByText(/Stored on this computer only, never sent anywhere on its own/),
    ).toBeInTheDocument();
  });

  it('searches across notes and can be cleared', async () => {
    const user = userEvent.setup();
    renderNotes();
    await waitFor(() => screen.getByText('No notes yet'), SETTLE);

    await write('Bitcoin halving', 'supply schedule');
    await waitFor(() => expect(within(list()).getByText('Bitcoin halving')).toBeInTheDocument(), SETTLE);
    await write('Apple margins', 'services revenue');
    await waitFor(() => expect(within(list()).getByText('Apple margins')).toBeInTheDocument(), SETTLE);

    const search = screen.getByLabelText('Search your notes');
    await user.type(search, 'halving');

    await waitFor(() => expect(within(list()).getByText('1 match')).toBeInTheDocument(), SETTLE);
    expect(within(list()).queryByText('Apple margins')).not.toBeInTheDocument();

    await user.clear(search);
    await waitFor(() => expect(within(list()).getByText('2 notes')).toBeInTheDocument(), SETTLE);
  });

  /**
   * A single letter matches most of a corpus, so searching on it is a slower way of showing
   * the list that is already there.
   */
  it('does not search on a single character', async () => {
    const user = userEvent.setup();
    renderNotes();
    await waitFor(() => screen.getByText('No notes yet'), SETTLE);

    await write('Bitcoin halving', 'supply schedule');
    await waitFor(() => expect(within(list()).getByText('Bitcoin halving')).toBeInTheDocument(), SETTLE);

    await user.type(screen.getByLabelText('Search your notes'), 'b');
    expect(within(list()).getByText('1 note')).toBeInTheDocument();
  });

  it('explains a search that matched nothing', async () => {
    const user = userEvent.setup();
    renderNotes();
    await waitFor(() => screen.getByText('No notes yet'), SETTLE);

    await write('Bitcoin halving', 'supply schedule');
    await waitFor(() => expect(within(list()).getByText('Bitcoin halving')).toBeInTheDocument(), SETTLE);

    await user.type(screen.getByLabelText('Search your notes'), 'zebra');
    await waitFor(
      () => expect(within(list()).getByText('Nothing matches that')).toBeInTheDocument(),
      SETTLE,
    );
    expect(within(list()).getByRole('button', { name: 'Clear search' })).toBeInTheDocument();
  });

  it('asks before deleting', async () => {
    const user = userEvent.setup();
    renderNotes();
    await waitFor(() => screen.getByText('No notes yet'), SETTLE);

    await write('Delete me', 'temporary');
    await waitFor(() => expect(within(list()).getByText('Delete me')).toBeInTheDocument(), SETTLE);

    await user.click(within(editor()).getByRole('button', { name: /Delete/ }));
    expect(await screen.findByText('Delete this note?')).toBeInTheDocument();

    // Cancelling leaves the note alone.
    await user.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(within(list()).getByText('Delete me')).toBeInTheDocument();
  });

  it('removes the note once the deletion is confirmed', async () => {
    const user = userEvent.setup();
    renderNotes();
    await waitFor(() => screen.getByText('No notes yet'), SETTLE);

    await write('Delete me', 'temporary');
    await waitFor(() => expect(within(list()).getByText('Delete me')).toBeInTheDocument(), SETTLE);

    await user.click(within(editor()).getByRole('button', { name: /Delete/ }));

    // Scoped to the dialog: the editor's own Delete button matches the same name, and an
    // unscoped query would be ambiguous rather than wrong-but-passing.
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(within(list()).getByText('No notes yet')).toBeInTheDocument(), SETTLE);
    await waitFor(
      () => expect(within(editor()).getByText('Nothing open')).toBeInTheDocument(),
      SETTLE,
    );
  });

  it('marks the open note in the list', async () => {
    renderNotes();
    await waitFor(() => screen.getByText('No notes yet'), SETTLE);

    await write('Open one', 'body');
    await waitFor(() => expect(within(list()).getByText('Open one')).toBeInTheDocument(), SETTLE);

    // Selection is announced, not only tinted — the background difference is a few percent.
    await waitFor(
      () => expect(within(list()).getByRole('button', { current: true })).toHaveTextContent('Open one'),
      SETTLE,
    );
  });

  /**
   * The open note lives in the URL so it survives a reload and can be linked to. Rendered
   * straight at the note's own path, with nothing clicked.
   */
  it('opens a note directly from its own URL', async () => {
    const first = renderNotes();
    await waitFor(() => screen.getByText('No notes yet'), SETTLE);
    await write('Linkable', 'reachable by url');
    await waitFor(() => expect(within(list()).getByText('Linkable')).toBeInTheDocument(), SETTLE);

    const id = within(list()).getByRole('button', { current: true }).closest('li')?.dataset.noteId;
    expect(id).toBeTruthy();

    /*
     * Unmount before remounting. Leaving the first tree in the document put two live
     * `NotesRoute`s on the page at once, both answering the same global queries, and the
     * assertion then had to guess which editor it meant — it passed alone and failed under the
     * full suite. One tree at a time is also what the test claims to be exercising: a cold
     * mount straight at the note's URL.
     */
    first.unmount();

    renderWithProviders(
      <Routes>
        <Route path="/notes" element={<NotesRoute />} />
        <Route path="/notes/:noteId" element={<NotesRoute />} />
      </Routes>,
      { route: `/notes/${id}`, resetHarness: false },
    );

    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Linkable'), SETTLE);
    expect(screen.getByLabelText('Note')).toHaveValue('reachable by url');
  });

  it('has no accessibility violations', async () => {
    const { container } = renderNotes();
    await waitFor(() => screen.getByText('No notes yet'), SETTLE);

    const violations = await findAccessibilityViolations(container);
    expect(violations, describeViolations(violations)).toHaveLength(0);
  });
});

describe('note text helpers', () => {
  it('flattens whitespace so a note starting with a blank line still previews', () => {
    expect(snippetOf('\n\n  first line\n\nsecond')).toBe('first line second');
    expect(snippetOf('   \n  ')).toBe('');
  });

  it('truncates long bodies with an ellipsis', () => {
    const long = 'x'.repeat(400);
    const snippet = snippetOf(long);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet.length).toBeLessThan(long.length);
  });

  /**
   * `slice` counts UTF-16 code units, so cutting at a fixed index can split an emoji in half
   * and leave a lone surrogate that renders as a replacement glyph.
   */
  it('does not cut a multi-byte character in half', () => {
    const snippet = snippetOf('🙂'.repeat(200));
    expect(snippet).not.toMatch(/[\uD800-\uDFFF]$/);
    expect(snippet.endsWith('…')).toBe(true);
  });

  it('reads the display symbol out of a canonical asset id', () => {
    expect(noteSymbol('crypto:cg:bitcoin')).toBe('BITCOIN');
    expect(noteSymbol('stock:fh:AAPL')).toBe('AAPL');
  });

  it('falls back to the whole id rather than an empty tag', () => {
    expect(noteSymbol('weird')).toBe('WEIRD');
    expect(noteSymbol('')).toBe('');
  });
});

/**
 * The editor shows a live character counter and disables Save past the limit, using constants
 * copied from the Rust side. If they drift, the counter reassures the writer their note fits
 * while the save fails validation — the worst version of this bug, because it only shows up
 * once someone has written enough to hit it.
 */
describe('note limits match the Rust validator', () => {
  const rust = readFileSync(
    resolve(process.cwd(), 'src-tauri/src/db/repo_notes.rs'),
    'utf8',
  );

  function constant(name: string): number {
    const match = new RegExp(`pub const ${name}: usize = ([0-9_]+);`).exec(rust);
    if (!match?.[1]) throw new Error(`${name} not found in repo_notes.rs — was it renamed?`);
    return Number(match[1].replace(/_/g, ''));
  }

  it('agrees on the body limit', () => {
    expect(MAX_NOTE_BODY).toBe(constant('MAX_NOTE_BODY'));
  });

  it('agrees on the title limit', () => {
    expect(MAX_NOTE_TITLE).toBe(constant('MAX_NOTE_TITLE'));
  });
});
