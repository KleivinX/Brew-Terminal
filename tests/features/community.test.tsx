import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommunityPanel } from '@/features/research/CommunityPanel';
import { browserInvoke, __resetHarness } from '@/lib/ipc.browser';
import { renderWithProviders } from '../setup/renderWithProviders';

beforeEach(() => {
  __resetHarness();
});

async function optIn(): Promise<void> {
  await browserInvoke('set_preference', { key: 'communityEnabled', value: 'true' });
}

async function postList(): Promise<HTMLElement> {
  return waitFor(() => screen.getByRole('list'), { timeout: 4000 });
}

describe('community temperature — the opt-in', () => {
  it('is off before the user asks for it', async () => {
    renderWithProviders(<CommunityPanel />);

    expect(await screen.findByText(/switched off/i)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('explains what turning it on actually does', async () => {
    renderWithProviders(<CommunityPanel />);

    expect(await screen.findByText(/other people's opinions/i)).toBeInTheDocument();
    expect(screen.getByText(/none of it has been checked/i)).toBeInTheDocument();
  });

  it('fetches nothing until it is switched on', async () => {
    renderWithProviders(<CommunityPanel />);
    await screen.findByText(/switched off/i);

    // The query is disabled, so no post ever reaches the DOM.
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows posts once the user opts in', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CommunityPanel />);

    await user.click(await screen.findByRole('switch', { name: /Show community discussion/i }));

    const list = await postList();
    expect(within(list).getAllByRole('listitem').length).toBeGreaterThan(0);
  });

  it('can be switched off again from the panel', async () => {
    const user = userEvent.setup();
    await optIn();
    renderWithProviders(<CommunityPanel />, { resetHarness: false });
    await postList();

    await user.click(screen.getByRole('button', { name: /Switch community discussion off/i }));

    expect(await screen.findByText(/switched off/i)).toBeInTheDocument();
  });
});

describe('community temperature — how posts are shown', () => {
  it('labels every post unverified', async () => {
    await optIn();
    renderWithProviders(<CommunityPanel />, { resetHarness: false });

    const list = await postList();
    const items = within(list).getAllByRole('listitem');
    for (const item of items) {
      expect(within(item).getByText('Unverified')).toBeInTheDocument();
    }
  });

  it('gives every post its source and a timestamp', async () => {
    await optIn();
    renderWithProviders(<CommunityPanel />, { resetHarness: false });

    const list = await postList();
    for (const item of within(list).getAllByRole('listitem')) {
      expect(within(item).getByText(/fixture/i)).toBeInTheDocument();

      // Asserted on the machine-readable value rather than the rendered words: the label is
      // locale-dependent and says "yesterday" as readily as "1d ago".
      const time = item.querySelector('time');
      expect(time).not.toBeNull();
      expect(time?.getAttribute('dateTime')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it('opens every link externally over https', async () => {
    await optIn();
    renderWithProviders(<CommunityPanel />, { resetHarness: false });

    const list = await postList();
    for (const link of within(list).getAllByRole('link')) {
      expect(link.getAttribute('href')).toMatch(/^https:\/\//);
      expect(link).toHaveAttribute('target', '_blank');
      // Without this, the opened page can reach back through window.opener.
      expect(link.getAttribute('rel')).toContain('noopener');
    }
  });

  it('shows the platform’s numbers as reported rather than as a judgement', async () => {
    await optIn();
    renderWithProviders(<CommunityPanel />, { resetHarness: false });

    const list = await postList();
    expect(within(list).getAllByText(/as reported/i).length).toBeGreaterThan(0);
  });

  it('states that it does not rank or score the discussion', async () => {
    await optIn();
    renderWithProviders(<CommunityPanel />, { resetHarness: false });
    await postList();

    expect(screen.getByText(/does not rank, score or summarise/i)).toBeInTheDocument();
  });

  /**
   * The load-bearing safety property. "Trending", "hot" or a sentiment reading would all be the
   * app deciding which opinions matter — see PRODUCT_SCOPE_V0_1.md §6 and UI_MAP.md.
   */
  it('never characterises the mood of the discussion', async () => {
    await optIn();
    const { container } = renderWithProviders(<CommunityPanel />, { resetHarness: false });
    await postList();

    const text = (container.textContent ?? '').toLowerCase();
    for (const banned of [
      'trending',
      'sentiment',
      'bullish',
      'bearish',
      'hype',
      'consensus',
      'buzz',
    ]) {
      expect(text, `community copy contains "${banned}"`).not.toContain(banned);
    }
  });

  it('shows newest first, not most-upvoted first', async () => {
    await optIn();
    renderWithProviders(<CommunityPanel />, { resetHarness: false });

    const list = await postList();
    const titles = within(list)
      .getAllByRole('link')
      .map((link) => link.textContent);

    // The fixture's highest-scoring post is deliberately not the newest one.
    expect(titles[0]).toMatch(/index fund/i);
  });
});

describe('community temperature — when nothing is wired', () => {
  it('says so rather than showing an empty list', async () => {
    await optIn();
    await browserInvoke('set_provider_enabled', { providerId: 'mock-community', enabled: false });
    renderWithProviders(<CommunityPanel />, { resetHarness: false });

    expect(await screen.findByText(/No community source is set up/i)).toBeInTheDocument();
  });

  it('is honest that only a fixture source ships', async () => {
    await optIn();
    await browserInvoke('set_provider_enabled', { providerId: 'mock-community', enabled: false });
    renderWithProviders(<CommunityPanel />, { resetHarness: false });

    expect(
      await screen.findByText(/no live discussion platform has been wired in/i),
    ).toBeInTheDocument();
  });
});
