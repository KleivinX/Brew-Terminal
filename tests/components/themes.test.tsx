import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppearancePanel } from '@/features/settings/AppearancePanel';
import { renderWithProviders } from '../setup/renderWithProviders';

describe('theme switching', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-motion');
    localStorage.clear();
  });

  it('offers all three themes as radio options', async () => {
    renderWithProviders(<AppearancePanel />);

    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /Dark/ })).toBeInTheDocument();
    });
    expect(screen.getByRole('radio', { name: /Light/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Soft/ })).toBeInTheDocument();
  });

  it('applies the chosen theme to the document root', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppearancePanel />);

    await waitFor(() => screen.getByRole('radio', { name: /Soft/ }));
    await user.click(screen.getByRole('radio', { name: /Soft/ }));

    expect(document.documentElement).toHaveAttribute('data-theme', 'soft');
  });

  it('mirrors the theme to localStorage so the first frame paints correctly', async () => {
    // index.html reads this before any IPC completes; without it the app flashes the
    // wrong background on every launch.
    const user = userEvent.setup();
    renderWithProviders(<AppearancePanel />);

    await waitFor(() => screen.getByRole('radio', { name: /Light/ }));
    await user.click(screen.getByRole('radio', { name: /Light/ }));

    expect(localStorage.getItem('brew.theme')).toBe('light');
  });

  it('persists the choice through the preferences store', async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(<AppearancePanel />);

    await waitFor(() => screen.getByRole('radio', { name: /Soft/ }));
    await user.click(screen.getByRole('radio', { name: /Soft/ }));
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /Soft/ })).toHaveAttribute('aria-checked', 'true'),
    );

    unmount();

    // Remounting reads persisted state back rather than reverting to the default.
    // The harness is deliberately not reset here — that is the whole point of the test.
    renderWithProviders(<AppearancePanel />, { resetHarness: false });
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /Soft/ })).toHaveAttribute('aria-checked', 'true'),
    );
  });

  it('lets the user force reduced motion independently of the OS setting', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppearancePanel />);

    const toggle = await screen.findByRole('switch', { name: /reduce motion/i });
    await user.click(toggle);

    expect(document.documentElement).toHaveAttribute('data-motion', 'none');
  });
});
