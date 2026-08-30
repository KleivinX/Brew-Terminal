import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewsFeedsPanel } from '@/features/settings/NewsFeedsPanel';
import { __resetHarness } from '@/lib/ipc.browser';
import { renderWithProviders } from '../setup/renderWithProviders';
import { findAccessibilityViolations, describeViolations } from '../setup/axe';

beforeEach(() => {
  __resetHarness();
});

/** The panel header renders before the query resolves, so wait for the list, not the region. */
async function feedList(): Promise<HTMLElement> {
  return waitFor(
    () => {
      const panel = screen.getByRole('region', { name: 'News feeds' });
      return within(panel).getByRole('list');
    },
    { timeout: 4000 },
  );
}

describe('news feeds', () => {
  it('shows the shipped feeds, marked as defaults', async () => {
    renderWithProviders(<NewsFeedsPanel />);
    const list = await feedList();

    expect(within(list).getByText('CoinDesk')).toBeInTheDocument();
    expect(within(list).getByText('SEC press releases')).toBeInTheDocument();
    // Marked so the user can tell why a feed is there without having added it.
    expect(within(list).getAllByText('Default').length).toBeGreaterThan(0);
  });

  it('refuses a feed address that is not https', async () => {
    const user = userEvent.setup();
    renderWithProviders(<NewsFeedsPanel />);
    await feedList();

    await user.type(screen.getByLabelText('Feed address'), 'http://example.org/feed.xml');
    await user.click(screen.getByRole('button', { name: /add feed/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/must start with https/i);
  });

  it('checks a feed before it is saved, and offers the publisher name', async () => {
    const user = userEvent.setup();
    renderWithProviders(<NewsFeedsPanel />);
    await feedList();

    await user.type(screen.getByLabelText('Feed address'), 'https://example.org/feed.xml');
    await user.click(screen.getByRole('button', { name: /check feed/i }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/A Publisher/);
    expect(status).toHaveTextContent(/12 items/);
  });

  it('adds a feed and shows it in the list', async () => {
    const user = userEvent.setup();
    renderWithProviders(<NewsFeedsPanel />);
    await feedList();

    await user.type(screen.getByLabelText('Feed address'), 'https://example.org/new.xml');
    await user.type(screen.getByLabelText('Name (optional)'), 'My Feed');
    await user.click(screen.getByRole('button', { name: /add feed/i }));

    await waitFor(async () => {
      expect(within(await feedList()).getByText('My Feed')).toBeInTheDocument();
    });
  });

  it('removes a feed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<NewsFeedsPanel />);
    let list = await feedList();

    expect(within(list).getByText('CoinDesk')).toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: /remove CoinDesk/i }));

    await waitFor(async () => {
      list = await feedList();
      expect(within(list).queryByText('CoinDesk')).not.toBeInTheDocument();
    });
  });

  /**
   * The panel promises the news panel will stay empty rather than fall back to samples. That
   * wording is the fix for the v0.1.0 bug where a release served fixture headlines, so it is
   * worth asserting rather than trusting.
   */
  it('says an empty list means no news, not sample data', async () => {
    const user = userEvent.setup();
    renderWithProviders(<NewsFeedsPanel />);
    await feedList();

    const names = [
      'CoinDesk',
      'Cointelegraph',
      'SEC press releases',
      'Federal Reserve press releases',
    ];
    for (const name of names) {
      const panel = screen.getByRole('region', { name: 'News feeds' });
      const button = within(panel).queryByRole('button', {
        name: new RegExp(`remove ${name}`, 'i'),
      });
      if (button) await user.click(button);
      // Let the list settle before looking for the next one.
      await waitFor(() =>
        expect(
          within(screen.getByRole('region', { name: 'News feeds' })).queryByText(name),
        ).not.toBeInTheDocument(),
      );
    }

    expect(
      await screen.findByText(/will stay empty until you add one/i, undefined, { timeout: 4000 }),
    ).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(<NewsFeedsPanel />);
    await feedList();

    const violations = await findAccessibilityViolations(container);
    expect(violations, describeViolations(violations)).toHaveLength(0);
  });
});
