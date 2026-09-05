import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NavRail } from '@/components/layout/NavRail';
import { __resetHarness, browserInvoke } from '@/lib/ipc.browser';
import { renderWithProviders } from '../setup/renderWithProviders';
import { findAccessibilityViolations, describeViolations } from '../setup/axe';

describe('NavRail', () => {
  it('exposes every primary destination as a link', () => {
    renderWithProviders(<NavRail />);

    for (const label of ['Pulse', 'Research Lab', 'Learn', 'Model Desk', 'Settings']) {
      expect(screen.getByRole('link', { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it('keeps labels available to screen readers while collapsed', () => {
    // Collapsing is a visual affordance, not an accessibility trade.
    __resetHarness();
    renderWithProviders(<NavRail />);

    expect(screen.getByRole('link', { name: /Pulse/ })).toBeInTheDocument();
  });

  it('toggles expansion and reports its state', async () => {
    __resetHarness();
    const user = userEvent.setup();
    renderWithProviders(<NavRail />);

    const toggle = screen.getByRole('button', { name: /expand navigation/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    // Optimistic, so this lands on the next render rather than after a round trip — but it is
    // still a mutation, so the assertion waits rather than reading synchronously.
    await waitFor(
      () =>
        expect(screen.getByRole('button', { name: /collapse navigation/i })).toHaveAttribute(
          'aria-expanded',
          'true',
        ),
      { timeout: 4000 },
    );
  });

  it('marks the active route', () => {
    renderWithProviders(<NavRail />, { route: '/learn' });
    expect(screen.getByRole('link', { name: /Learn/ })).toHaveAttribute('aria-current', 'page');
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(<NavRail />);
    const violations = await findAccessibilityViolations(container);
    expect(violations, describeViolations(violations)).toHaveLength(0);
  });
});

describe('the rail remembers how it was left', () => {
  /**
   * The bug this closes: `navRailExpanded` existed twice — once in the preferences the Settings
   * toggle wrote to, once in `uiStore` that the rail rendered from — and nothing connected
   * them. Setting the switch persisted `true` and changed nothing on screen, and the command
   * palette's toggle worked until the next launch.
   */
  it('renders expanded when the stored preference says so', async () => {
    __resetHarness();
    await browserInvoke('set_preference', { key: 'navRailExpanded', value: 'true' });

    renderWithProviders(<NavRail />, { resetHarness: false });

    await waitFor(
      () =>
        expect(screen.getByRole('button', { name: /collapse navigation/i })).toHaveAttribute(
          'aria-expanded',
          'true',
        ),
      { timeout: 4000 },
    );
  });

  it('writes the flip back, so it survives a restart', async () => {
    __resetHarness();
    const user = userEvent.setup();
    renderWithProviders(<NavRail />, { resetHarness: false });

    await user.click(await screen.findByRole('button', { name: /expand navigation/i }));

    await waitFor(
      async () => {
        const prefs = (await browserInvoke('get_preferences')) as { navRailExpanded: boolean };
        expect(prefs.navRailExpanded).toBe(true);
      },
      { timeout: 4000 },
    );
  });
});
