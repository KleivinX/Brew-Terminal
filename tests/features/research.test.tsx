import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { ResearchRoute } from '@/features/research/ResearchRoute';
import { RiskChecklist } from '@/features/research/RiskChecklist';
import { ContextPanel } from '@/features/research/ContextPanel';
import { renderWithProviders } from '../setup/renderWithProviders';
import { findAccessibilityViolations, describeViolations } from '../setup/axe';

/**
 * lightweight-charts needs a real canvas, which jsdom does not provide. The chart's visual
 * layer is `aria-hidden` anyway — everything it conveys is also in the summary and data table,
 * and those are what these tests assert on.
 */
vi.mock('lightweight-charts', () => ({
  createChart: () => ({
    addSeries: () => ({ setData: vi.fn() }),
    timeScale: () => ({ fitContent: vi.fn() }),
    applyOptions: vi.fn(),
    remove: vi.fn(),
  }),
  AreaSeries: 'AreaSeries',
}));

function renderAsset(assetId = 'crypto:cg:bitcoin') {
  return renderWithProviders(
    <Routes>
      <Route path="/research/:assetId" element={<ResearchRoute />} />
    </Routes>,
    { route: `/research/${encodeURIComponent(assetId)}` },
  );
}

describe('Research Lab', () => {
  it('shows the asset header and key metrics', async () => {
    renderAsset();

    await waitFor(() => expect(screen.getByText(/BTC · Bitcoin/)).toBeInTheDocument());
    expect(screen.getByText('Price')).toBeInTheDocument();
    expect(screen.getByText('Market cap')).toBeInTheDocument();
  });

  it('renders the chart with a text alternative, not just a canvas', async () => {
    /*
     * A canvas is unreadable to assistive technology, so the summary is the accessible
     * content. If this assertion ever fails, the chart has become inaccessible.
     */
    renderAsset();

    await waitFor(() => expect(screen.getByText(/points from/i)).toBeInTheDocument(), {
      timeout: 4000,
    });

    expect(screen.getByText(/Opened/)).toBeInTheDocument();
    expect(screen.getByText(/High/)).toBeInTheDocument();
  });

  it('exposes the underlying numbers as a real table', async () => {
    const user = userEvent.setup();
    renderAsset();

    const toggle = await screen.findByRole('button', {
      name: /show the underlying numbers/i,
    });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);

    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: /time/i })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: /price/i })).toBeInTheDocument();
    expect(within(table).getAllByRole('row').length).toBeGreaterThan(1);
  });

  it('offers only the ranges the provider supports', async () => {
    renderAsset();

    const group = await screen.findByRole('group', { name: /chart range/i });
    // The mock provider advertises every range, including Max.
    expect(within(group).getByRole('button', { name: /one day/i })).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: /one year/i })).toBeInTheDocument();
  });

  it('changes the range', async () => {
    const user = userEvent.setup();
    renderAsset();

    const group = await screen.findByRole('group', { name: /chart range/i });
    const oneWeek = within(group).getByRole('button', { name: /one week/i });

    await user.click(oneWeek);
    await waitFor(() => expect(oneWeek).toHaveAttribute('aria-pressed', 'true'));
  });

  it('names ranges for screen readers rather than leaving two letters', async () => {
    renderAsset();
    const group = await screen.findByRole('group', { name: /chart range/i });
    expect(within(group).getByRole('button', { name: 'Three months' })).toBeInTheDocument();
  });

  it('shows the provider and age for every data panel', async () => {
    renderAsset();
    await waitFor(() => expect(screen.getAllByText(/Mock provider/i).length).toBeGreaterThan(1));
  });

  it('teaches the next action when no asset is selected', async () => {
    renderWithProviders(
      <Routes>
        <Route path="/research" element={<ResearchRoute />} />
      </Routes>,
      { route: '/research' },
    );

    await waitFor(() => expect(screen.getByText(/Pick an asset to research/i)).toBeInTheDocument());
  });

  it('explains an unknown asset instead of showing a blank page', async () => {
    renderAsset('crypto:cg:does-not-exist');
    await waitFor(() =>
      expect(screen.getByText(/not in the current data set/i)).toBeInTheDocument(),
    );
  });
});

describe('Research Lab — notes', () => {
  it('creates, edits and deletes a note', async () => {
    const user = userEvent.setup();
    renderAsset();

    await waitFor(() => expect(screen.getByText('Research notes')).toBeInTheDocument());
    await user.click(await screen.findByRole('button', { name: /write the first one/i }));

    await user.type(screen.getByLabelText('Title'), 'Supply thesis');
    await user.type(screen.getByLabelText('Note'), 'Check the issuance schedule.');
    await user.click(screen.getByRole('button', { name: /save note/i }));

    await waitFor(() => expect(screen.getByText('Supply thesis')).toBeInTheDocument());
    expect(screen.getByText('Check the issuance schedule.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /edit note: Supply thesis/i }));
    const title = screen.getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Revised thesis');
    await user.click(screen.getByRole('button', { name: /save note/i }));

    await waitFor(() => expect(screen.getByText('Revised thesis')).toBeInTheDocument());
    expect(screen.queryByText('Supply thesis')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /delete note: Revised thesis/i }));
    await user.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() =>
      expect(screen.getByText(/No notes on this asset yet/i)).toBeInTheDocument(),
    );
  });

  it('says notes stay on this computer', async () => {
    renderAsset();
    await waitFor(() =>
      expect(screen.getByText(/Stored on this computer only/i)).toBeInTheDocument(),
    );
  });
});

describe('Safety copy', () => {
  it('refuses to attribute a price move to a story', async () => {
    /*
     * The most load-bearing copy in the app. The brief calls this section "What moved this?";
     * answering that question is exactly what the app has no basis to do, so the panel must
     * say so rather than implying causation by juxtaposition.
     */
    renderWithProviders(<ContextPanel assetType="crypto" symbol="BTC" />);

    await waitFor(() =>
      expect(screen.getByText(/Published around this time/i)).toBeInTheDocument(),
    );

    // The emphasised "not" splits the sentence across text nodes, so match the clause after it.
    expect(screen.getByText(/an explanation of why BTC moved/i)).toBeInTheDocument();
    expect(screen.getByText(/is not one causing the other/i)).toBeInTheDocument();
    expect(screen.getByText('not')).toBeInTheDocument();
  });

  it('never uses causal phrasing as a heading', async () => {
    renderWithProviders(<ContextPanel assetType="crypto" symbol="BTC" />);
    await waitFor(() =>
      expect(screen.getByText(/Published around this time/i)).toBeInTheDocument(),
    );

    for (const heading of screen.queryAllByRole('heading')) {
      expect(heading.textContent ?? '').not.toMatch(/why .* (rose|fell|dropped|surged|crashed)/i);
    }
  });

  it('renders the risk checklist with no score and no verdict', () => {
    renderWithProviders(<RiskChecklist />);

    expect(screen.getByText(/Things worth checking/i)).toBeInTheDocument();
    expect(screen.getByText(/does not score them/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing honest to score/i)).toBeInTheDocument();

    // No checkboxes: a tally would be a legitimacy verdict by another name.
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('keeps verdict language out of the checklist entirely', () => {
    renderWithProviders(<RiskChecklist />);
    const text = document.body.textContent ?? '';

    /*
     * These mirror the project's banned list (PRODUCT_SCOPE_V0_1.md §6) rather than a cruder
     * keyword sweep. The checklist legitimately *describes* "guaranteed-sounding returns" as
     * a warning sign — naming a red flag is the educational content; promising one is what
     * is forbidden.
     */
    for (const banned of [
      /scam score/i,
      /safe investment/i,
      /\bguaranteed?\s+(returns?|profit|gains?)\b/i,
      /risk[- ]free/i,
      /\bstrong buy\b/i,
    ]) {
      expect(text).not.toMatch(banned);
    }
  });

  it('shows the risk checklist for a crypto asset', async () => {
    renderAsset('crypto:cg:bitcoin');
    await waitFor(() => expect(screen.getByText(/Things worth checking/i)).toBeInTheDocument());
  });

  it('does not show the crypto risk checklist for an equity', async () => {
    // The checklist is about token-specific failure modes; showing it beside a listed company
    // would be padding rather than guidance.
    renderAsset('stock:us:AAPL');

    await waitFor(() => expect(screen.getByText(/Apple Inc/)).toBeInTheDocument());
    expect(screen.queryByText(/Things worth checking/i)).not.toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = renderAsset();
    await waitFor(() => expect(screen.getByText(/BTC · Bitcoin/)).toBeInTheDocument());

    const violations = await findAccessibilityViolations(container);
    expect(violations, describeViolations(violations)).toHaveLength(0);
  });
});

describe('backtest panel', () => {
  /**
   * The framing is the feature. This is arithmetic on history, and the panel has to say so —
   * the shape of the output is the shape of a forecast, and it would be easy to read as one.
   */
  it('says it is arithmetic on the past, not a projection', async () => {
    renderAsset();

    const panel = await screen.findByRole(
      'region',
      { name: /If you had been buying/i },
      { timeout: 5000 },
    );
    expect(within(panel).getByText(/not a projection/i)).toBeInTheDocument();
    expect(within(panel).getByText(/not a claim about what happens next/i)).toBeInTheDocument();
  });

  it('shows what a regular contribution would have produced', async () => {
    renderAsset();

    const panel = await screen.findByRole(
      'region',
      { name: /If you had been buying/i },
      { timeout: 5000 },
    );
    expect(within(panel).getByText('Put in')).toBeInTheDocument();
    expect(within(panel).getByText('Worth now')).toBeInTheDocument();
    expect(within(panel).getByText('Average paid')).toBeInTheDocument();
    // The comparison that makes averaging legible rather than merely favourable.
    expect(within(panel).getByText(/All at once instead/i)).toBeInTheDocument();
  });

  it('states the period the figures cover', async () => {
    renderAsset();

    const panel = await screen.findByRole(
      'region',
      { name: /If you had been buying/i },
      { timeout: 5000 },
    );
    expect(within(panel).getByText(/contributions between/i)).toBeInTheDocument();
  });
});
