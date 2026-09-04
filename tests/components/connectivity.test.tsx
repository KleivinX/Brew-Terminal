import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { screen, waitFor } from '@testing-library/react';
import { ConnectivityWatch } from '@/components/status/ConnectivityWatch';
import { ToastHost } from '@/components/status/ToastHost';
import { StatusBar } from '@/components/layout/StatusBar';
import { useToastStore } from '@/stores/toastStore';
import { renderWithProviders } from '../setup/renderWithProviders';

const SETTLE = { timeout: 4000 } as const;

/** jsdom's navigator.onLine is a getter; this is the only way to move it. */
function setOnline(value: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value);
}

function fire(event: 'online' | 'offline'): void {
  act(() => {
    window.dispatchEvent(new Event(event));
  });
}

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
  setOnline(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('going offline', () => {
  /**
   * Nothing is said on the first render. Opening the app with no network is a standing state
   * the status bar already shows; a toast for it would be an alert about something the user
   * has not just done.
   */
  it('says nothing on mount, whatever the connection is doing', async () => {
    setOnline(false);
    renderWithProviders(
      <>
        <ConnectivityWatch />
        <ToastHost />
      </>,
    );

    await waitFor(() => expect(screen.queryByRole('listitem')).not.toBeInTheDocument(), SETTLE);
  });

  it('interrupts when the connection actually drops', async () => {
    renderWithProviders(
      <>
        <ConnectivityWatch />
        <ToastHost />
      </>,
    );

    setOnline(false);
    fire('offline');

    expect(await screen.findByText('No network connection')).toBeInTheDocument();
    expect(screen.getByText(/last data they cached/)).toBeInTheDocument();
  });

  /** It stays until it is dismissed or resolved: the condition has not gone away on a timer. */
  it('does not remove the offline message on a timer', async () => {
    renderWithProviders(
      <>
        <ConnectivityWatch />
        <ToastHost />
      </>,
    );
    setOnline(false);
    fire('offline');
    await screen.findByText('No network connection');

    const stored = useToastStore.getState().toasts.find((t) => t.key === 'connectivity');
    expect(stored?.duration).toBeNull();
  });

  it('says so again when the connection returns', async () => {
    renderWithProviders(
      <>
        <ConnectivityWatch />
        <ToastHost />
      </>,
    );

    setOnline(false);
    fire('offline');
    await screen.findByText('No network connection');

    setOnline(true);
    fire('online');

    expect(await screen.findByText('Back online')).toBeInTheDocument();
    expect(screen.queryByText('No network connection')).not.toBeInTheDocument();
  });

  /** A flapping connection replaces its own message rather than stacking a column of them. */
  it('never stacks connectivity messages', async () => {
    renderWithProviders(
      <>
        <ConnectivityWatch />
        <ToastHost />
      </>,
    );

    for (let i = 0; i < 4; i += 1) {
      setOnline(false);
      fire('offline');
      setOnline(true);
      fire('online');
    }

    await waitFor(() => {
      const connectivity = useToastStore.getState().toasts.filter((t) => t.key === 'connectivity');
      expect(connectivity).toHaveLength(1);
    }, SETTLE);
  });
});

describe('the status bar', () => {
  it('says nothing about the network while there is one', async () => {
    renderWithProviders(<StatusBar />);
    await waitFor(() => expect(screen.queryByText(/Offline/)).not.toBeInTheDocument(), SETTLE);
  });

  /**
   * Only ever claims the negative. `navigator.onLine` being true is also true behind a captive
   * portal, so the bar never says the providers are reachable.
   */
  it('shows a standing indicator while the machine is offline', async () => {
    setOnline(false);
    renderWithProviders(<StatusBar />);

    expect(await screen.findByText('Offline — showing cached data')).toBeInTheDocument();
  });

  it('clears the indicator when the connection returns', async () => {
    setOnline(false);
    renderWithProviders(<StatusBar />);
    await screen.findByText('Offline — showing cached data');

    setOnline(true);
    fire('online');

    await waitFor(
      () => expect(screen.queryByText('Offline — showing cached data')).not.toBeInTheDocument(),
      SETTLE,
    );
  });
});
