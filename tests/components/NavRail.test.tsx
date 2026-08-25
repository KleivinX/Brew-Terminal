import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NavRail } from '@/components/layout/NavRail';
import { useUiStore } from '@/stores/uiStore';
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
    useUiStore.setState({ navRailExpanded: false });
    renderWithProviders(<NavRail />);

    expect(screen.getByRole('link', { name: /Pulse/ })).toBeInTheDocument();
  });

  it('toggles expansion and reports its state', async () => {
    useUiStore.setState({ navRailExpanded: false });
    const user = userEvent.setup();
    renderWithProviders(<NavRail />);

    const toggle = screen.getByRole('button', { name: /expand navigation/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    expect(screen.getByRole('button', { name: /collapse navigation/i })).toHaveAttribute(
      'aria-expanded',
      'true',
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
