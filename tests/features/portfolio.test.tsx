import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PortfolioRoute } from '@/features/portfolio/PortfolioRoute';
import { browserInvoke, __resetHarness } from '@/lib/ipc.browser';
import { renderWithProviders } from '../setup/renderWithProviders';
import { findAccessibilityViolations, describeViolations } from '../setup/axe';

/*
 * `renderWithProviders` resets the harness by default, which would wipe anything seeded before
 * the render. These tests seed first, so they opt out and rely on this hook for isolation.
 */
beforeEach(() => {
  __resetHarness();
});

const AT = 1_760_000_000;

async function record(
  overrides: Partial<{
    assetId: string;
    symbol: string;
    kind: 'buy' | 'sell';
    quantity: number;
    unitPrice: number;
    fee: number;
    currency: string;
    executedAt: number;
  }> = {},
): Promise<void> {
  await browserInvoke('add_transaction', {
    transaction: {
      id: '',
      assetId: 'crypto:cg:bitcoin',
      symbol: 'BTC',
      kind: 'buy',
      quantity: 1,
      unitPrice: 100,
      fee: 0,
      currency: 'USD',
      executedAt: AT,
      note: null,
      createdAt: 0,
      ...overrides,
    },
  });
}

describe('portfolio', () => {
  it('invites a first trade rather than showing an empty table', async () => {
    renderWithProviders(<PortfolioRoute />, { resetHarness: false });

    expect(await screen.findByText(/Nothing recorded yet/i)).toBeInTheDocument();
    // The privacy promise is the reason someone would type their holdings in at all.
    expect(screen.getByText(/stays on this machine/i)).toBeInTheDocument();
  });

  it('shows cost, value and unrealised gain for a held position', async () => {
    await record({ quantity: 2, unitPrice: 100 });
    renderWithProviders(<PortfolioRoute />, { resetHarness: false });

    const totals = await waitFor(() => screen.getByRole('region', { name: 'Portfolio totals' }));
    // Bought 2 at 100.
    expect(within(totals).getByText(/\$200\.00/)).toBeInTheDocument();
  });

  it('keeps realised gain after a position is closed', async () => {
    await record({ quantity: 1, unitPrice: 100, executedAt: AT });
    await record({ kind: 'sell', quantity: 1, unitPrice: 250, executedAt: AT + 1000 });

    renderWithProviders(<PortfolioRoute />, { resetHarness: false });

    expect(await screen.findByRole('region', { name: 'Closed positions' })).toBeInTheDocument();
    const totals = screen.getByRole('region', { name: 'Portfolio totals' });
    expect(within(totals).getByText(/\$150\.00/)).toBeInTheDocument();
  });

  /**
   * The honesty rule that matters most here: an unpriced holding is unknown, not worthless.
   * Showing it as zero would understate the total without saying so.
   */
  it('says which holdings it could not price instead of counting them as zero', async () => {
    await record({ assetId: 'crypto:cg:unlisted-thing', symbol: 'NOPE' });
    renderWithProviders(<PortfolioRoute />, { resetHarness: false });

    expect(await screen.findByText(/No current price for NOPE/i)).toBeInTheDocument();
  });

  it('lists foreign-currency holdings but refuses to sum them', async () => {
    await record({ assetId: 'stock:eu:SAP', symbol: 'SAP', currency: 'EUR' });
    renderWithProviders(<PortfolioRoute />, { resetHarness: false });

    expect(await screen.findByText(/does not convert currencies/i)).toBeInTheDocument();
  });

  it('flags a history that records more sold than bought', async () => {
    await record({ quantity: 1, unitPrice: 100, executedAt: AT });
    await record({ kind: 'sell', quantity: 5, unitPrice: 100, executedAt: AT + 1000 });

    renderWithProviders(<PortfolioRoute />, { resetHarness: false });
    expect(await screen.findByRole('alert')).toHaveTextContent(/more sold than bought/i);
  });

  it('records a trade through the dialog', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PortfolioRoute />, { resetHarness: false });

    await user.click(await screen.findByRole('button', { name: /record your first trade/i }));

    await user.type(screen.getByLabelText('Asset id'), 'crypto:cg:bitcoin');
    await user.type(screen.getByLabelText('Quantity'), '3');
    await user.type(screen.getByLabelText('Price per unit'), '50');
    await user.click(screen.getByRole('button', { name: /record trade/i }));

    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Portfolio totals' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('region', { name: 'Open positions' })).toBeInTheDocument();
  });

  it('refuses a trade with no quantity', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PortfolioRoute />, { resetHarness: false });

    await user.click(await screen.findByRole('button', { name: /record your first trade/i }));
    await user.type(screen.getByLabelText('Asset id'), 'crypto:cg:bitcoin');
    await user.type(screen.getByLabelText('Quantity'), '0');
    await user.type(screen.getByLabelText('Price per unit'), '50');
    await user.click(screen.getByRole('button', { name: /record trade/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/positive number/i);
  });

  it('deletes a transaction and the position goes with it', async () => {
    const user = userEvent.setup();
    await record({ quantity: 1, unitPrice: 100 });
    renderWithProviders(<PortfolioRoute />, { resetHarness: false });

    const list = await waitFor(() => screen.getByRole('region', { name: 'Transactions' }));
    await user.click(within(list).getByRole('button', { name: /delete buy of BTC/i }));

    await waitFor(() => expect(screen.getByText(/Nothing recorded yet/i)).toBeInTheDocument());
  });

  it('carries the standing disclaimer', async () => {
    renderWithProviders(<PortfolioRoute />, { resetHarness: false });
    const { DISCLAIMER_TEXT } = await import('@/components/status/DisclaimerNote');
    expect(await screen.findByText(DISCLAIMER_TEXT)).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    await record({ quantity: 2, unitPrice: 100 });
    const { container } = renderWithProviders(<PortfolioRoute />, { resetHarness: false });
    await waitFor(() => screen.getByRole('region', { name: 'Portfolio totals' }));

    const violations = await findAccessibilityViolations(container);
    expect(violations, describeViolations(violations)).toHaveLength(0);
  });
});
