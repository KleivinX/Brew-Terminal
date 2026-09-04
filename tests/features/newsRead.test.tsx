import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewsPanel } from '@/features/pulse/NewsPanel';
import { __resetHarness, browserInvoke } from '@/lib/ipc.browser';
import { renderWithProviders } from '../setup/renderWithProviders';
import { findAccessibilityViolations, describeViolations } from '../setup/axe';

const SETTLE = { timeout: 4000 } as const;

beforeEach(() => {
  __resetHarness();
});

async function newsList(): Promise<HTMLElement> {
  return waitFor(() => {
    const panel = screen.getByRole('region', { name: 'Market news' });
    return within(panel).getByRole('list');
  }, SETTLE);
}

async function firstHeadline(): Promise<HTMLElement> {
  const list = await newsList();
  return within(list).getAllByRole('link')[0]!;
}

describe('read state', () => {
  it('starts with everything unread', async () => {
    renderWithProviders(<NewsPanel />);
    const list = await newsList();

    const marks = within(list).getAllByRole('button', { name: /Mark .* read$/ });
    expect(marks.length).toBeGreaterThan(0);
    expect(within(list).queryByRole('button', { name: /unread$/ })).not.toBeInTheDocument();
  });

  it('marks a story read and offers to put it back', async () => {
    const user = userEvent.setup();
    renderWithProviders(<NewsPanel />);
    const list = await newsList();

    const mark = within(list).getAllByRole('button', { name: /Mark .* read$/ })[0]!;
    await user.click(mark);

    const unmark = await within(list).findByRole('button', { name: /unread$/ }, SETTLE);
    await user.click(unmark);

    await waitFor(
      () => expect(within(list).queryByRole('button', { name: /unread$/ })).not.toBeInTheDocument(),
      SETTLE,
    );
  });

  /**
   * Opening a story is the ordinary way of reading it. If only the toggle counted, the list
   * would never thin out on its own — which is the whole point of tracking this.
   */
  it('counts opening a headline as reading it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<NewsPanel />);
    const link = await firstHeadline();

    await user.click(link);

    await waitFor(async () => {
      const read = (await browserInvoke('list_read_news')) as string[];
      expect(read).toContain(link.getAttribute('href'));
    }, SETTLE);
  });

  it('clears the whole panel in one press', async () => {
    const user = userEvent.setup();
    renderWithProviders(<NewsPanel />);
    await newsList();

    const markAll = await screen.findByRole('button', { name: /^Mark \d+ read$/ }, SETTLE);
    await user.click(markAll);

    await waitFor(
      () =>
        expect(screen.queryByRole('button', { name: /^Mark \d+ read$/ })).not.toBeInTheDocument(),
      SETTLE,
    );
  });

  it('says how many are unread, not how many there are', async () => {
    const user = userEvent.setup();
    renderWithProviders(<NewsPanel />);
    const list = await newsList();

    const before = Number(
      /^Mark (\d+) read$/.exec(
        (await screen.findByRole('button', { name: /^Mark \d+ read$/ })).textContent ?? '',
      )?.[1],
    );

    await user.click(within(list).getAllByRole('button', { name: /Mark .* read$/ })[0]!);

    await waitFor(async () => {
      const after = Number(
        /^Mark (\d+) read$/.exec(
          (await screen.findByRole('button', { name: /^Mark \d+ read$/ })).textContent ?? '',
        )?.[1],
      );
      expect(after).toBe(before - 1);
    }, SETTLE);
  });

  /** A read story is dimmed, not removed: the panel must not jump under the pointer. */
  it('keeps a read story on screen', async () => {
    const user = userEvent.setup();
    renderWithProviders(<NewsPanel />);
    const list = await newsList();

    const before = within(list).getAllByRole('link').length;
    await user.click(within(list).getAllByRole('button', { name: /Mark .* read$/ })[0]!);

    await within(list).findByRole('button', { name: /unread$/ }, SETTLE);
    expect(within(list).getAllByRole('link')).toHaveLength(before);
  });

  it('remembers across a remount', async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(<NewsPanel />);
    const list = await newsList();

    const href = within(list).getAllByRole('link')[0]!.getAttribute('href');
    await user.click(within(list).getAllByRole('button', { name: /Mark .* read$/ })[0]!);
    await within(list).findByRole('button', { name: /unread$/ }, SETTLE);

    unmount();
    renderWithProviders(<NewsPanel />, { resetHarness: false });

    await waitFor(async () => {
      const read = (await browserInvoke('list_read_news')) as string[];
      expect(read).toContain(href);
    }, SETTLE);
  });

  it('has no accessibility violations with read and unread rows', async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<NewsPanel />);
    const list = await newsList();

    await user.click(within(list).getAllByRole('button', { name: /Mark .* read$/ })[0]!);
    await within(list).findByRole('button', { name: /unread$/ }, SETTLE);

    const violations = await findAccessibilityViolations(container);
    expect(violations, describeViolations(violations)).toHaveLength(0);
  });
});
