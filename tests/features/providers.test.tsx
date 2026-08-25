import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProvidersPanel } from '@/features/settings/ProvidersPanel';
import { MarketsPanel } from '@/features/settings/MarketsPanel';
import { renderWithProviders } from '../setup/renderWithProviders';
import { findAccessibilityViolations, describeViolations } from '../setup/axe';

function panelFor(name: string): HTMLElement {
  return screen.getByRole('region', { name }) ?? screen.getByLabelText(name);
}

describe('Data providers', () => {
  it('lists every configured provider with its attribution', async () => {
    renderWithProviders(<ProvidersPanel />);

    await waitFor(() => expect(screen.getByText('CoinGecko')).toBeInTheDocument());

    // Attribution is a provider requirement, not decoration — it must always render.
    expect(screen.getByText('Data provided by CoinGecko')).toBeInTheDocument();
    expect(screen.getByText('Market data by Finnhub')).toBeInTheDocument();
  });

  it('will not let a credential-requiring provider be enabled without a key', async () => {
    renderWithProviders(<ProvidersPanel />);
    await waitFor(() => expect(screen.getByText('Finnhub')).toBeInTheDocument());

    const finnhub = panelFor('Finnhub');
    const toggle = within(finnhub).getByRole('switch', { name: /use this provider/i });

    expect(toggle).toBeDisabled();
    expect(
      within(finnhub).getByText(/needs an API key before it can be turned on/i),
    ).toBeInTheDocument();
  });

  it('never renders the key after it is saved', async () => {
    /*
     * The guarantee from THREAT_MODEL.md §4: a key travels inward once and is never sent
     * back. Asserting against the whole document catches it leaking into any attribute or
     * text node, not just the field it was typed into.
     */
    const user = userEvent.setup();
    const secret = 'super-secret-key-value-1234';
    renderWithProviders(<ProvidersPanel />);

    await waitFor(() => expect(screen.getByText('Finnhub')).toBeInTheDocument());
    const finnhub = panelFor('Finnhub');

    await user.type(within(finnhub).getByLabelText(/api key/i), secret);
    await user.click(within(finnhub).getByRole('button', { name: /save key/i }));

    await waitFor(() => {
      expect(
        within(panelFor('Finnhub')).getByRole('button', { name: /remove key/i }),
      ).toBeInTheDocument();
    });

    expect(document.body.innerHTML).not.toContain(secret);
    expect(document.body.textContent).not.toContain(secret);
  });

  it('says a stored key cannot be shown again', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProvidersPanel />);
    await waitFor(() => expect(screen.getByText('Finnhub')).toBeInTheDocument());

    const finnhub = panelFor('Finnhub');
    await user.type(within(finnhub).getByLabelText(/api key/i), 'abcdefgh12345678');
    await user.click(within(finnhub).getByRole('button', { name: /save key/i }));

    await waitFor(() => {
      expect(within(panelFor('Finnhub')).getByText(/cannot be shown again/i)).toBeInTheDocument();
    });
    expect(
      within(panelFor('Finnhub')).getByRole('button', { name: /remove key/i }),
    ).toBeInTheDocument();
  });

  it('uses a password field so the key is not shoulder-readable', async () => {
    renderWithProviders(<ProvidersPanel />);
    await waitFor(() => expect(screen.getByText('Finnhub')).toBeInTheDocument());

    const field = within(panelFor('Finnhub')).getByLabelText(/api key/i);
    expect(field).toHaveAttribute('type', 'password');
    expect(field).toHaveAttribute('autocomplete', 'off');
  });

  it('turns a provider off without deleting anything else', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProvidersPanel />);
    await waitFor(() => expect(screen.getByText('CoinGecko')).toBeInTheDocument());

    const coingecko = panelFor('CoinGecko');
    const toggle = within(coingecko).getByRole('switch', { name: /use this provider/i });
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    await user.click(toggle);

    await waitFor(() => {
      expect(
        within(panelFor('CoinGecko')).getByRole('switch', { name: /use this provider/i }),
      ).toHaveAttribute('aria-checked', 'false');
    });
  });

  it('reports the result of a connection test', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProvidersPanel />);
    await waitFor(() => expect(screen.getByText('CoinGecko')).toBeInTheDocument());

    await user.click(
      within(panelFor('CoinGecko')).getByRole('button', { name: /test connection/i }),
    );

    await waitFor(() => {
      expect(screen.getByText(/Connected\./i)).toBeInTheDocument();
    });
  });

  it('explains where keys are stored', async () => {
    renderWithProviders(<ProvidersPanel />);
    await waitFor(() => expect(screen.getByText(/How keys are stored/i)).toBeInTheDocument());

    expect(screen.getByText(/never written to the database/i)).toBeInTheDocument();
    expect(screen.getByText(/never included in an export/i)).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(<ProvidersPanel />);
    await waitFor(() => expect(screen.getByText('CoinGecko')).toBeInTheDocument());

    const violations = await findAccessibilityViolations(container);
    expect(violations, describeViolations(violations)).toHaveLength(0);
  });
});

describe('Markets settings', () => {
  it('offers only the regions a provider actually covers', async () => {
    renderWithProviders(<MarketsPanel />);

    await waitFor(() => expect(screen.getByRole('radio', { name: /Global/ })).toBeInTheDocument());
    expect(screen.getByRole('radio', { name: /United States/ })).toBeInTheDocument();

    // A region no configured provider serves must not be offered.
    expect(screen.queryByRole('radio', { name: /Japan/ })).not.toBeInTheDocument();
  });

  it('changes the region', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MarketsPanel />);

    const us = await screen.findByRole('radio', { name: /United States/ });
    await user.click(us);

    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /United States/ })).toHaveAttribute(
        'aria-checked',
        'true',
      );
    });
  });

  it('explains the cost of a shorter refresh interval', async () => {
    renderWithProviders(<MarketsPanel />);
    await waitFor(() =>
      expect(screen.getByLabelText(/how often visible data refreshes/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/request budget/i)).toBeInTheDocument();
  });

  it('is honest that currency conversion is not implemented', async () => {
    renderWithProviders(<MarketsPanel />);
    await waitFor(() => expect(screen.getByText(/not built yet/i)).toBeInTheDocument());
    expect(screen.getByText(/documented rate and timestamp/i)).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(<MarketsPanel />);
    await waitFor(() => expect(screen.getByRole('radio', { name: /Global/ })).toBeInTheDocument());

    const violations = await findAccessibilityViolations(container);
    expect(violations, describeViolations(violations)).toHaveLength(0);
  });
});
