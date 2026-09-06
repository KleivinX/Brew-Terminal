import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectorsRoute } from '@/features/connectors/ConnectorsRoute';
import { statusLabel } from '@/features/connectors/labels';
import { __resetHarness } from '@/lib/ipc.browser';
import type { ConnectorInfo } from '@/types/domain';
import { renderWithProviders } from '../setup/renderWithProviders';
import { describeViolations, findAccessibilityViolations } from '../setup/axe';

const SETTLE = { timeout: 4000 } as const;

beforeEach(() => {
  __resetHarness();
});

/*
 * Wrapped in a `<main>`, which is where `AppShell` actually puts a route.
 *
 * Rendered bare, `WorkspaceHeader`'s `<header>` is a top-level element and therefore a banner
 * landmark — and opening a dialog adds a second one, so a body-wide audit reports a duplicate
 * banner that no user could ever meet. One element restores the real structure, which is
 * better than excluding the rule: the audit still runs, against the nesting that ships.
 */
async function renderSettled() {
  const result = renderWithProviders(
    <main>
      <ConnectorsRoute />
    </main>,
  );
  await waitFor(() => expect(screen.getByText('CoinGecko')).toBeInTheDocument(), SETTLE);
  return result;
}

async function openDetail(name: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: `${name} — details` }));
  return waitFor(() => screen.getByRole('dialog'), SETTLE);
}

describe('the catalogue', () => {
  it('lists every source with the stage of its review', async () => {
    await renderSettled();

    // Scoped to the table: the stage filter has an <option> for each of these too, and an
    // unscoped query cannot tell a filter control from a row.
    const table = within(screen.getByRole('grid', { name: 'Data connectors' }));
    expect(table.getAllByText('Wired')).toHaveLength(6);
    expect(table.getAllByText('Declined')).toHaveLength(1);
    expect(table.getAllByText('Not reviewed')).toHaveLength(5);
  });

  it('says how many of each there are before the reader scrolls', async () => {
    await renderSettled();
    expect(screen.getByText('6 wired (4 on) · 1 declined · 5 not reviewed')).toBeInTheDocument();
  });
});

describe('what an unreviewed connector claims', () => {
  /*
   * The whole point of the feature. A table with a plausible rate limit beside every name would
   * assert a hundred terms reviews that never happened, in the format most likely to be
   * believed — inside an app whose premise is that a number arrives with its provenance.
   */
  it('claims nothing about terms, limits or authentication', async () => {
    await renderSettled();
    const dialog = await openDetail('CoinCap');

    expect(within(dialog).getByText('Not reviewed')).toBeInTheDocument();
    expect(within(dialog).queryByText(/Free tier/)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Attribution/)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Authentication/)).not.toBeInTheDocument();
  });

  it('explains that the gap is this project’s, not the provider’s', async () => {
    await renderSettled();
    const dialog = await openDetail('CoinCap');

    // Someone who has never read ADR-008 has no way to know "Not reviewed" is a statement
    // about our work queue rather than a judgement on the provider.
    expect(within(dialog).getByText(/Nobody has read this provider’s terms/)).toBeInTheDocument();
  });

  it('is never shown as enabled', async () => {
    await renderSettled();
    const dialog = await openDetail('DefiLlama');
    expect(within(dialog).getByText('—')).toBeInTheDocument();
  });
});

describe('what a reviewed connector carries', () => {
  it('shows the limits, licence and attribution the review produced', async () => {
    await renderSettled();
    const dialog = await openDetail('OpenSky Network');

    expect(within(dialog).getByText('Wired')).toBeInTheDocument();
    expect(within(dialog).getByText('Needs a written agreement')).toBeInTheDocument();
    expect(within(dialog).getByText(/Free tier/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Data from OpenSky Network/)).toBeInTheDocument();
    expect(within(dialog).getByText(/prior written agreement/)).toBeInTheDocument();
  });

  /*
   * The link that makes the catalogue answer the question the app is built around: a figure on
   * any screen carries a provider id, and that id has to resolve to a row here.
   */
  it('names the provider id that every number it served carries', async () => {
    await renderSettled();
    const dialog = await openDetail('CoinGecko');

    expect(within(dialog).getByText('Provider id')).toBeInTheDocument();
    expect(within(dialog).getByText('coingecko')).toBeInTheDocument();
    expect(within(dialog).getByText(/traced back to this page/)).toBeInTheDocument();
  });

  /*
   * FRED and Alternative.me have adapters but no provider_config row — the services that use
   * them construct them directly. A toggle for those would be a control that does nothing.
   */
  it('marks an always-on adapter as not switchable and says why', async () => {
    await renderSettled();
    const dialog = await openDetail('FRED (St. Louis Fed)');

    expect(within(dialog).getByText('Always on')).toBeInTheDocument();
    expect(within(dialog).getByText(/constructs it directly/)).toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: 'Configure in Settings' }),
    ).not.toBeInTheDocument();
  });

  it('offers Settings for one that can be configured', async () => {
    await renderSettled();
    const dialog = await openDetail('Finnhub');
    expect(
      within(dialog).getByRole('button', { name: 'Configure in Settings' }),
    ).toBeInTheDocument();
  });
});

describe('a declined connector', () => {
  /* Without the reason, the next person re-does the research and reaches the same answer. */
  it('carries the reason it was turned down', async () => {
    await renderSettled();
    const dialog = await openDetail('Binance');

    expect(within(dialog).getByText('Declined')).toBeInTheDocument();
    expect(within(dialog).getByText(/has not been through the terms review/)).toBeInTheDocument();
  });
});

describe('filters', () => {
  it('searches names, categories and what a source serves', async () => {
    const user = userEvent.setup();
    await renderSettled();

    await user.type(screen.getByLabelText('Search connectors'), 'filings');
    await waitFor(() => expect(screen.getByText('1 of 12')).toBeInTheDocument(), SETTLE);
    expect(screen.getByText('SEC EDGAR')).toBeInTheDocument();
    expect(screen.queryByText('CoinGecko')).not.toBeInTheDocument();
  });

  it('narrows to a single review stage', async () => {
    const user = userEvent.setup();
    await renderSettled();

    await user.selectOptions(screen.getByLabelText('Filter by review stage'), 'candidate');
    await waitFor(() => expect(screen.getByText('5 of 12')).toBeInTheDocument(), SETTLE);
    expect(screen.queryByText('CoinGecko')).not.toBeInTheDocument();
  });

  it('narrows to a single category', async () => {
    const user = userEvent.setup();
    await renderSettled();

    await user.selectOptions(screen.getByLabelText('Filter by category'), 'macro');
    await waitFor(() => expect(screen.getByText('2 of 12')).toBeInTheDocument(), SETTLE);
    expect(screen.getByText('World Bank Open Data')).toBeInTheDocument();
  });

  it('says so rather than showing an empty table', async () => {
    const user = userEvent.setup();
    await renderSettled();

    await user.type(screen.getByLabelText('Search connectors'), 'zzzzz');
    await waitFor(() => expect(screen.getByText('0 of 12')).toBeInTheDocument(), SETTLE);
    expect(screen.getByText('Nothing matches those filters.')).toBeInTheDocument();
  });
});

describe('the standing disclaimer', () => {
  /*
   * A page listing exchange and broker APIs by name invites exactly the assumption this app
   * does not support, so it is refused once, here, rather than left to the reader.
   */
  it('says the list is data sources and nothing else', async () => {
    await renderSettled();
    expect(screen.getByText(/never places an order/)).toBeInTheDocument();
    expect(screen.getByText(/market-data endpoints only/)).toBeInTheDocument();
  });
});

describe('accessibility', () => {
  it('has no violations', async () => {
    const { container } = await renderSettled();
    const violations = await findAccessibilityViolations(container);
    expect(violations, describeViolations(violations)).toHaveLength(0);
  });

  it('has none with the detail panel open', async () => {
    await renderSettled();
    await openDetail('OpenSky Network');

    // Body-wide, because the dialog is portalled to the document root and would otherwise be
    // outside the audited subtree entirely.
    const violations = await findAccessibilityViolations(document.body);
    expect(violations, describeViolations(violations)).toHaveLength(0);
  });
});

describe('status wording', () => {
  const base: ConnectorInfo = {
    id: 'x',
    displayName: 'X',
    category: 'macro',
    categoryLabel: 'Macro',
    stage: 'wired',
    summary: 'A source.',
    auth: 'keyless',
    termsRisk: 'core-ok',
    termsLabel: 'Free, documented, fine to ship',
    freeTier: null,
    attribution: null,
    docsUrl: null,
    note: null,
    providerId: 'x',
    enabled: true,
    userControllable: true,
    requiresCredential: false,
    hasCredential: false,
    lastCheckedAt: null,
  };

  it('separates on, off, always on and needing a key', () => {
    expect(statusLabel(base)).toBe('On');
    expect(statusLabel({ ...base, enabled: false })).toBe('Off');
    expect(statusLabel({ ...base, userControllable: false })).toBe('Always on');
    expect(statusLabel({ ...base, requiresCredential: true })).toBe('Needs a key');
  });

  it('never reports an unreviewed or declined source as running', () => {
    expect(statusLabel({ ...base, stage: 'candidate', enabled: true })).toBe('—');
    expect(statusLabel({ ...base, stage: 'declined', enabled: true })).toBe('Not used');
  });

  /* A credential that exists means the key is no longer the thing standing in the way. */
  it('stops asking for a key once one is stored', () => {
    expect(statusLabel({ ...base, requiresCredential: true, hasCredential: true })).toBe('On');
  });
});
