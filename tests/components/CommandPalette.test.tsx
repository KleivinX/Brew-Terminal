import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette } from '@/components/palette/CommandPalette';
import { usePaletteStore } from '@/stores/paletteStore';
import { renderWithProviders } from '../setup/renderWithProviders';
import { findAccessibilityViolations, describeViolations } from '../setup/axe';

function openPalette(initialQuery = '') {
  usePaletteStore.setState({ open: true, initialQuery });
}

describe('CommandPalette', () => {
  it('renders nothing while closed', () => {
    usePaletteStore.setState({ open: false, initialQuery: '' });
    renderWithProviders(<CommandPalette />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('lists commands when opened', async () => {
    openPalette();
    renderWithProviders(<CommandPalette />);

    expect(await screen.findByRole('combobox')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Go to Pulse/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Theme: Soft/ })).toBeInTheDocument();
  });

  it('filters commands as the user types', async () => {
    const user = userEvent.setup();
    openPalette();
    renderWithProviders(<CommandPalette />);

    await user.type(await screen.findByRole('combobox'), 'glossary');

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /glossary/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole('option', { name: /Theme: Soft/ })).not.toBeInTheDocument();
  });

  it('matches commands by keyword, not only by title', async () => {
    // "sidebar" appears nowhere in "Toggle the navigation rail".
    const user = userEvent.setup();
    openPalette();
    renderWithProviders(<CommandPalette />);

    await user.type(await screen.findByRole('combobox'), 'sidebar');
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /navigation rail/i })).toBeInTheDocument();
    });
  });

  it('searches assets through the provider', async () => {
    const user = userEvent.setup();
    openPalette();
    renderWithProviders(<CommandPalette />);

    await user.type(await screen.findByRole('combobox'), 'btc');

    await waitFor(
      () => {
        expect(screen.getByRole('option', { name: /BTC · Bitcoin/ })).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it('keeps focus in the input and tracks the active option with aria-activedescendant', async () => {
    const user = userEvent.setup();
    openPalette();
    renderWithProviders(<CommandPalette />);

    const input = await screen.findByRole('combobox');
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('aria-activedescendant', 'palette-row-0');

    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', 'palette-row-1');
    expect(input).toHaveFocus();
  });

  it('wraps selection around the ends of the list', async () => {
    const user = userEvent.setup();
    openPalette();
    renderWithProviders(<CommandPalette />);

    const input = await screen.findByRole('combobox');
    await user.keyboard('{ArrowUp}');
    // Wrapping to the last item beats getting stuck at the top.
    expect(input.getAttribute('aria-activedescendant')).not.toBe('palette-row-0');
  });

  it('runs the active command on Enter and closes', async () => {
    const user = userEvent.setup();
    openPalette();
    renderWithProviders(<CommandPalette />);

    await screen.findByRole('combobox');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(usePaletteStore.getState().open).toBe(false));
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    openPalette();
    renderWithProviders(<CommandPalette />);

    await screen.findByRole('combobox');
    await user.keyboard('{Escape}');

    await waitFor(() => expect(usePaletteStore.getState().open).toBe(false));
  });

  it('reports when nothing matches instead of showing an empty list', async () => {
    const user = userEvent.setup();
    openPalette();
    renderWithProviders(<CommandPalette />);

    await user.type(await screen.findByRole('combobox'), 'zzzzqqqqxxxx');
    await waitFor(() => {
      expect(screen.getByText(/No matching commands or assets/)).toBeInTheDocument();
    });
  });

  it('ranks a direct command match above a weaker asset match', async () => {
    /*
     * Regression: typing "soft" used to navigate to Microsoft, because every asset result was
     * placed ahead of every command. "Microsoft" only contains "soft"; "Theme: Soft" matches
     * it more directly, so the command must come first.
     */
    const user = userEvent.setup();
    openPalette();
    renderWithProviders(<CommandPalette />);

    await user.type(await screen.findByRole('combobox'), 'soft');

    await waitFor(
      () => {
        expect(screen.getByRole('option', { name: /Theme: Soft/ })).toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    const options = screen.getAllByRole('option');
    expect(options[0]?.textContent).toContain('Theme: Soft');
  });

  it('still leads with a strong asset match', async () => {
    // An exact ticker must outrank any command.
    const user = userEvent.setup();
    openPalette();
    renderWithProviders(<CommandPalette />);

    await user.type(await screen.findByRole('combobox'), 'btc');

    await waitFor(
      () => {
        expect(screen.getByRole('option', { name: /BTC · Bitcoin/ })).toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    expect(screen.getAllByRole('option')[0]?.textContent).toContain('BTC');
  });

  it('has no accessibility violations', async () => {
    openPalette();
    const { container } = renderWithProviders(<CommandPalette />);
    await screen.findByRole('combobox');

    const violations = await findAccessibilityViolations(container.ownerDocument.body);
    expect(violations, describeViolations(violations)).toHaveLength(0);
  });
});
