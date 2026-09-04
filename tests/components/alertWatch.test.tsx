import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { announceFiredAlerts } from '@/components/status/AlertWatch';
import { ToastHost } from '@/components/status/ToastHost';
import { useToastStore } from '@/stores/toastStore';
import type { Alert, TriggeredAlert } from '@/types/domain';
import { renderWithProviders } from '../setup/renderWithProviders';

function alert(symbol: string, id = symbol.toLowerCase()): Alert {
  return {
    id,
    assetId: `crypto:cg:${id}`,
    symbol,
    kind: 'price-above',
    threshold: 100,
    enabled: true,
    note: null,
    createdAt: 1,
    triggeredAt: null,
    triggeredValue: null,
  };
}

function fired(symbol: string, id?: string): TriggeredAlert {
  return { alert: alert(symbol, id), message: `${symbol} rose to 61240.00` };
}

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
});

describe('announcing a fired alert', () => {
  it('says nothing when nothing fired', () => {
    act(() => announceFiredAlerts([], () => {}));
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('uses the alert’s own wording', () => {
    renderWithProviders(<ToastHost />);
    act(() => announceFiredAlerts([fired('BTC')], () => {}));

    expect(screen.getByText('BTC rose to 61240.00')).toBeInTheDocument();
  });

  it('offers a way through to the alerts panel', async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    renderWithProviders(<ToastHost />);
    act(() => announceFiredAlerts([fired('BTC')], open));

    await user.click(screen.getByRole('button', { name: 'View' }));
    expect(open).toHaveBeenCalledOnce();
  });

  it('shows a few individually', () => {
    renderWithProviders(<ToastHost />);
    act(() => announceFiredAlerts([fired('BTC'), fired('ETH'), fired('SOL')], () => {}));

    expect(screen.getByText('BTC rose to 61240.00')).toBeInTheDocument();
    expect(screen.getByText('SOL rose to 61240.00')).toBeInTheDocument();
  });

  /**
   * Several thresholds crossing in one poll is normal in a fast market. Six toasts is a wall,
   * not a notification.
   */
  it('collapses a burst into one summary', () => {
    renderWithProviders(<ToastHost />);
    act(() =>
      announceFiredAlerts(
        ['BTC', 'ETH', 'SOL', 'ADA', 'XRP'].map((s) => fired(s)),
        () => {},
      ),
    );

    expect(screen.getByText('5 alerts fired')).toBeInTheDocument();
    expect(screen.getByText('BTC, ETH, SOL, ADA, XRP')).toBeInTheDocument();
    expect(screen.queryByText('BTC rose to 61240.00')).not.toBeInTheDocument();
  });

  /** The same alert arriving twice replaces its own message rather than stacking. */
  it('does not stack a repeat of the same alert', () => {
    act(() => announceFiredAlerts([fired('BTC')], () => {}));
    act(() => announceFiredAlerts([fired('BTC')], () => {}));

    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it('keeps separate alerts separate', () => {
    act(() => announceFiredAlerts([fired('BTC'), fired('ETH')], () => {}));
    expect(useToastStore.getState().toasts).toHaveLength(2);
  });

  /**
   * A fired alert is a state change the user asked to be told about, not a routine
   * confirmation. It waits to be acknowledged.
   */
  it('does not let a fired alert time out unseen', () => {
    act(() => announceFiredAlerts([fired('BTC')], () => {}));

    const [toast] = useToastStore.getState().toasts;
    expect(toast?.tone).toBe('warning');
    expect(toast?.action).toBeDefined();
  });
});
