import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScreenerRoute } from '@/features/screener/ScreenerRoute';
import { ToastHost } from '@/components/status/ToastHost';
import { SavedViews } from '@/components/views/SavedViews';
import { __resetHarness, browserInvoke } from '@/lib/ipc.browser';
import { useToastStore } from '@/stores/toastStore';
import { renderWithProviders } from '../setup/renderWithProviders';

const SETTLE = { timeout: 4000 } as const;

beforeEach(() => {
  __resetHarness();
  useToastStore.setState({ toasts: [] });
});

async function saveCurrent(name: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Save this view' }));
  await user.type(await screen.findByLabelText('Name for this view'), name);
  await user.click(screen.getByRole('button', { name: 'Save' }));
}

describe('saving a screen', () => {
  it('keeps the filters under a name and brings them back', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <ScreenerRoute />
        <ToastHost />
      </>,
    );

    await user.type(await screen.findByLabelText(/Min market cap/i), '5000000000');
    await saveCurrent('Large caps');
    await waitFor(() => expect(screen.getByText('Saved “Large caps”')).toBeInTheDocument(), SETTLE);

    // Change the screen, then bring the view back.
    await user.clear(screen.getByLabelText(/Min market cap/i));
    await user.type(screen.getByLabelText(/Min market cap/i), '1');
    await user.click(screen.getByRole('button', { name: 'Apply Large caps' }));

    await waitFor(
      () => expect(screen.getByLabelText(/Min market cap/i)).toHaveValue('5000000000'),
      SETTLE,
    );
  });

  /**
   * The inputs are strings and the boxes have to show what was typed again. Round-tripping
   * through numbers would rewrite "1e9" as "1000000000" under someone who typed the first.
   */
  it('restores exactly what was typed', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <ScreenerRoute />
        <ToastHost />
      </>,
    );

    await user.type(await screen.findByLabelText(/Min market cap/i), '1e9');
    await saveCurrent('Scientific');
    await waitFor(() => screen.getByText('Saved “Scientific”'), SETTLE);

    await user.clear(screen.getByLabelText(/Min market cap/i));
    await user.click(screen.getByRole('button', { name: 'Apply Scientific' }));

    await waitFor(
      () => expect(screen.getByLabelText(/Min market cap/i)).toHaveValue('1e9'),
      SETTLE,
    );
  });

  it('removes a view when asked', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <ScreenerRoute />
        <ToastHost />
      </>,
    );

    await saveCurrent('Temporary');
    await waitFor(() => screen.getByRole('button', { name: 'Apply Temporary' }), SETTLE);

    await user.click(screen.getByRole('button', { name: 'Remove Temporary' }));
    await waitFor(
      () =>
        expect(screen.queryByRole('button', { name: 'Apply Temporary' })).not.toBeInTheDocument(),
      SETTLE,
    );
  });
});

describe('the saved views control', () => {
  function renderViews(onApply: (payload: unknown) => boolean) {
    return renderWithProviders(
      <>
        <SavedViews kind="screener" current={() => ({ a: 1 })} onApply={onApply} />
        <ToastHost />
      </>,
      { resetHarness: false },
    );
  }

  it('says there is nothing saved yet', async () => {
    renderViews(() => true);
    expect(await screen.findByText(/No saved views yet/)).toBeInTheDocument();
  });

  it('warns before replacing a view of the same name', async () => {
    const user = userEvent.setup();
    await browserInvoke('save_view', { kind: 'screener', name: 'Mine', payload: '{}' });
    renderViews(() => true);

    await user.click(await screen.findByRole('button', { name: 'Save this view' }));
    await user.type(screen.getByLabelText('Name for this view'), 'Mine');

    expect(await screen.findByText(/replaces the view already called/)).toBeInTheDocument();
  });

  /**
   * A view written by an older build may describe fields the screen no longer has. The screen
   * is the only thing that can tell, so it reports back and the user is told why nothing moved.
   */
  it('says so when a stored view no longer fits the screen', async () => {
    const user = userEvent.setup();
    await browserInvoke('save_view', { kind: 'screener', name: 'Ancient', payload: '{"gone":1}' });
    renderViews(() => false);

    await user.click(await screen.findByRole('button', { name: 'Apply Ancient' }));

    expect(await screen.findByText(/saved by an older version/)).toBeInTheDocument();
  });

  it('cancels naming without saving anything', async () => {
    const user = userEvent.setup();
    renderViews(() => true);

    await user.click(await screen.findByRole('button', { name: 'Save this view' }));
    await user.type(screen.getByLabelText('Name for this view'), 'Never');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(
      () => expect(screen.queryByRole('button', { name: 'Apply Never' })).not.toBeInTheDocument(),
      SETTLE,
    );
    expect(screen.getByRole('button', { name: 'Save this view' })).toBeInTheDocument();
  });

  it('will not save a view with no name', async () => {
    const user = userEvent.setup();
    renderViews(() => true);

    await user.click(await screen.findByRole('button', { name: 'Save this view' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('keeps the two screens apart', async () => {
    await browserInvoke('save_view', { kind: 'compare', name: 'Only compare', payload: '{}' });
    renderViews(() => true);

    expect(await screen.findByText(/No saved views yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply Only compare' })).not.toBeInTheDocument();
  });
});
