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

describe("finding a site's feed", () => {
  const SETTLE = { timeout: 4000 } as const;

  async function findFor(site: string): Promise<void> {
    const user = userEvent.setup();
    renderWithProviders(<NewsFeedsPanel />);
    await user.type(await screen.findByLabelText('Site address'), site);
    await user.click(screen.getByRole('button', { name: 'Find feeds' }));
  }

  it('lists what a site declares, with enough evidence to pick between them', async () => {
    await findFor('coindesk.com');

    expect(await screen.findByText('coindesk.com — Everything')).toBeInTheDocument();
    expect(screen.getByText('coindesk.com — Markets')).toBeInTheDocument();
    // The newest headline is the part that settles which feed you meant.
    expect(screen.getAllByText(/newest:/).length).toBeGreaterThan(0);
  });

  it('takes a bare host, because that is what people type', async () => {
    await findFor('coindesk.com');
    expect(await screen.findByText('https://coindesk.com/feed.xml')).toBeInTheDocument();
  });

  /**
   * Plenty of sites publish nothing. Saying so is more use than an error implying something
   * went wrong, and it points at the manual form underneath.
   */
  it('says a site has no feed rather than reporting a failure', async () => {
    await findFor('nofeed.example');

    expect(await screen.findByText(/does not advertise a feed/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('refuses a plain-http address, the same rule as everywhere else', async () => {
    await findFor('http://example.org');
    expect(await screen.findByRole('alert')).toHaveTextContent(/https:\/\//);
  });

  /**
   * Discovery hands a candidate to the add form; it does not save it. The address the user is
   * about to store stays on screen, and they still choose the category.
   */
  it('fills the add form rather than saving straight away', async () => {
    const user = userEvent.setup();
    renderWithProviders(<NewsFeedsPanel />);
    await user.type(await screen.findByLabelText('Site address'), 'coindesk.com');
    await user.click(screen.getByRole('button', { name: 'Find feeds' }));

    await screen.findByText('coindesk.com — Everything');
    await user.click(screen.getAllByRole('button', { name: 'Use this' })[0]!);

    await waitFor(
      () =>
        expect(screen.getByLabelText('Feed address')).toHaveValue('https://coindesk.com/feed.xml'),
      SETTLE,
    );
    expect(screen.getByLabelText('Name (optional)')).toHaveValue('coindesk.com — Everything');

    // Nothing has been stored yet.
    const list = await feedList();
    expect(within(list).queryByText('coindesk.com — Everything')).not.toBeInTheDocument();
  });

  /** A single-field form: Enter is how anyone would expect to run it. */
  it('runs on Enter as well as on the button', async () => {
    const user = userEvent.setup();
    renderWithProviders(<NewsFeedsPanel />);

    await user.type(await screen.findByLabelText('Site address'), 'coindesk.com{Enter}');

    expect(await screen.findByText('coindesk.com — Everything')).toBeInTheDocument();
  });

  it('has no accessibility violations with candidates on screen', async () => {
    await findFor('coindesk.com');
    await screen.findByText('coindesk.com — Everything');

    const violations = await findAccessibilityViolations(document.body);
    expect(violations, describeViolations(violations)).toHaveLength(0);
  });
});
