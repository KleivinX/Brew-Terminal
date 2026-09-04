import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastHost } from '@/components/status/ToastHost';
import { MAX_TOASTS, toast, useToastStore } from '@/stores/toastStore';
import { renderWithProviders } from '../setup/renderWithProviders';
import { findAccessibilityViolations, describeViolations } from '../setup/axe';

function alerts(): HTMLElement {
  return screen.getByRole('alert');
}

function notifications(): HTMLElement {
  return screen.getByRole('status');
}

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
});

describe('ToastHost', () => {
  it('mounts both live regions before there is anything to announce', () => {
    // The whole point. A live region created at the same moment as its first message is not
    // announced at all, so an empty host that renders nothing would be silent for exactly the
    // users who cannot see the toast.
    renderWithProviders(<ToastHost />);

    expect(alerts()).toBeInTheDocument();
    expect(notifications()).toBeInTheDocument();
  });

  it('routes errors to the assertive region and everything else to the polite one', () => {
    renderWithProviders(<ToastHost />);

    act(() => {
      toast.error('Could not reach FRED');
      toast.success('Note saved');
    });

    expect(within(alerts()).getByText('Could not reach FRED')).toBeInTheDocument();
    expect(within(notifications()).getByText('Note saved')).toBeInTheDocument();
    expect(within(alerts()).queryByText('Note saved')).not.toBeInTheDocument();
  });

  it('shows the detail line when there is one', () => {
    renderWithProviders(<ToastHost />);
    act(() => {
      toast.warning('Two feeds failed', { detail: 'CoinDesk and Cointelegraph' });
    });

    expect(screen.getByText('CoinDesk and Cointelegraph')).toBeInTheDocument();
  });

  it('can be dismissed by hand', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ToastHost />);
    act(() => {
      toast.error('Could not reach FRED');
    });

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Could not reach FRED')).not.toBeInTheDocument();
  });

  it('has no accessibility violations with a toast on screen', async () => {
    const { container } = renderWithProviders(<ToastHost />);
    act(() => {
      toast.success('Note saved', { action: { label: 'Undo', onAction: () => {} } });
    });

    const violations = await findAccessibilityViolations(document.body);
    expect(violations, describeViolations(violations)).toHaveLength(0);
    expect(container).toBeTruthy();
  });
});

describe('ToastHost lifetimes', () => {
  beforeEach(() => {
    // shouldAdvanceTime keeps userEvent's own internal waits from deadlocking against the
    // frozen clock. Real elapsed time is milliseconds, so it cannot expire a multi-second toast.
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('removes a routine toast once its time is up', () => {
    renderWithProviders(<ToastHost />);
    act(() => {
      toast.success('Note saved');
    });
    expect(screen.getByText('Note saved')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(screen.queryByText('Note saved')).not.toBeInTheDocument();
  });

  /**
   * A failure nobody happened to be looking at is a failure nobody knows about. Errors stay
   * until they are acknowledged — the same reason a degraded envelope keeps saying so rather
   * than quietly resolving.
   */
  it('never removes an error on a timer', () => {
    renderWithProviders(<ToastHost />);
    act(() => {
      toast.error('Could not reach FRED');
    });

    act(() => {
      vi.advanceTimersByTime(10 * 60 * 1_000);
    });
    expect(screen.getByText('Could not reach FRED')).toBeInTheDocument();
  });

  it('gives a toast with an action longer than a bare one', () => {
    renderWithProviders(<ToastHost />);
    act(() => {
      toast.success('Note deleted', { action: { label: 'Undo', onAction: () => {} } });
    });

    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(
      screen.getByText('Note deleted'),
      'the plain success lifetime must not apply',
    ).toBeInTheDocument();
  });

  /**
   * The failure this prevents is specific: the pointer is already travelling toward Undo when
   * the toast removes itself, and the user has committed to a recovery that is no longer there.
   */
  it('stops the clock while the pointer is over it', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithProviders(<ToastHost />);
    act(() => {
      toast.success('Note deleted', { action: { label: 'Undo', onAction: () => {} } });
    });

    await user.hover(screen.getByText('Note deleted'));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByText('Note deleted')).toBeInTheDocument();
  });

  it('runs the action and takes the toast away with it', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onAction = vi.fn();
    renderWithProviders(<ToastHost />);
    act(() => {
      toast.success('Note deleted', { action: { label: 'Undo', onAction } });
    });

    await user.click(screen.getByRole('button', { name: 'Undo' }));

    expect(onAction).toHaveBeenCalledOnce();
    expect(screen.queryByText('Note deleted')).not.toBeInTheDocument();
  });
});

describe('toast store', () => {
  it('collapses repeats that share a key instead of stacking them', () => {
    act(() => {
      toast.error('Feed failed', { key: 'feed:coindesk' });
      toast.error('Feed failed again', { key: 'feed:coindesk' });
    });

    const { toasts } = useToastStore.getState();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.message).toBe('Feed failed again');
  });

  it('keeps unkeyed toasts separate even when they read the same', () => {
    act(() => {
      toast.info('Refreshed');
      toast.info('Refreshed');
    });
    expect(useToastStore.getState().toasts).toHaveLength(2);
  });

  it('never holds more than the cap', () => {
    act(() => {
      for (let i = 0; i < MAX_TOASTS + 3; i += 1) toast.info(`Message ${i}`);
    });
    expect(useToastStore.getState().toasts).toHaveLength(MAX_TOASTS);
  });

  /**
   * A run of routine confirmations must not push out the one message that has no other way of
   * being seen. The cap evicts something that would have expired on its own first.
   */
  it('evicts a self-dismissing toast before a sticky error', () => {
    act(() => {
      toast.error('Could not reach FRED');
      for (let i = 0; i < MAX_TOASTS + 2; i += 1) toast.success(`Saved ${i}`);
    });

    const messages = useToastStore.getState().toasts.map((t) => t.message);
    expect(messages).toContain('Could not reach FRED');
  });

  it('hands back an id the caller can dismiss with', () => {
    let id = '';
    act(() => {
      id = toast.info('Working…', { duration: null });
    });
    expect(useToastStore.getState().toasts).toHaveLength(1);

    act(() => {
      toast.dismiss(id);
    });
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
