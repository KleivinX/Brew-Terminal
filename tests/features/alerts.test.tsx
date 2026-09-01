import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AlertsPanel } from '@/features/settings/AlertsPanel';
import { browserInvoke, __resetHarness } from '@/lib/ipc.browser';
import { renderWithProviders } from '../setup/renderWithProviders';
import { findAccessibilityViolations, describeViolations } from '../setup/axe';

beforeEach(() => {
  __resetHarness();
});

async function addAlert(threshold: number, kind = 'price-above'): Promise<void> {
  await browserInvoke('create_alert', {
    alert: {
      id: '',
      assetId: 'crypto:cg:bitcoin',
      symbol: 'BTC',
      kind,
      threshold,
      enabled: true,
      note: null,
      createdAt: 0,
      triggeredAt: null,
      triggeredValue: null,
    },
  });
}

const render = () => renderWithProviders(<AlertsPanel />, { resetHarness: false });

describe('alerts', () => {
  /**
   * The copy on this switch is the feature as much as the alerts are: it is the one place the
   * app asks to make a request nobody caused, and it has to say so rather than calling itself
   * "background updates".
   */
  it('states plainly that this is the exception to the no-unprompted-requests rule', async () => {
    render();
    const notice = await screen.findByText(/only makes a request because you did something/i);
    expect(notice).toHaveTextContent(/Alerts cannot work that way/i);
    expect(notice).toHaveTextContent(/on its own, about every two minutes/i);
  });

  it('is off by default', async () => {
    render();
    const toggle = await screen.findByRole('switch', {
      name: /check prices in the background/i,
    });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('says nothing is being checked until an alert exists', async () => {
    const user = userEvent.setup();
    render();

    await user.click(
      await screen.findByRole('switch', { name: /check prices in the background/i }),
    );
    expect(await screen.findByText(/Nothing is being checked yet/i)).toBeInTheDocument();
  });

  it('adds an alert and lists it as watching', async () => {
    const user = userEvent.setup();
    render();

    await user.type(await screen.findByLabelText('Asset id'), 'crypto:cg:bitcoin');
    await user.type(screen.getByLabelText('Label (optional)'), 'BTC');
    await user.type(screen.getByLabelText(/Threshold/), '70000');
    await user.click(screen.getByRole('button', { name: /add alert/i }));

    await waitFor(() =>
      expect(screen.getByRole('region', { name: /^Watching \(1\)/ })).toBeInTheDocument(),
    );
  });

  it('refuses a negative price threshold', async () => {
    const user = userEvent.setup();
    render();

    await user.type(await screen.findByLabelText('Asset id'), 'crypto:cg:bitcoin');
    await user.type(screen.getByLabelText(/Threshold/), '-100');
    await user.click(screen.getByRole('button', { name: /add alert/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot be negative/i);
  });

  it('does not fire anything while background checking is off', async () => {
    // The threshold is trivially met, so only the preference can be keeping it quiet.
    await addAlert(0.01);
    render();

    await waitFor(() =>
      expect(screen.getByRole('region', { name: /^Watching \(1\)/ })).toBeInTheDocument(),
    );

    // There is nothing to press: the check control only exists once checking is switched on.
    expect(screen.queryByRole('button', { name: /check now/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /^Triggered/ })).not.toBeInTheDocument();
  });

  it('fires once when checked, then stays quiet until re-armed', async () => {
    const user = userEvent.setup();
    await addAlert(0.01);
    await browserInvoke('set_preference', { key: 'alertsEnabled', value: 'true' });
    render();

    await user.click(await screen.findByRole('button', { name: /check now/i }));
    await waitFor(() =>
      expect(screen.getByRole('region', { name: /^Triggered \(1\)/ })).toBeInTheDocument(),
    );

    // With nothing armed there is nothing left to check, which is itself the guarantee: a
    // crossed threshold is one notification, not one every couple of minutes.
    expect(screen.queryByRole('button', { name: /check now/i })).not.toBeInTheDocument();

    const triggered = screen.getByRole('region', { name: /^Triggered/ });
    await user.click(within(triggered).getByRole('button', { name: /re-arm/i }));

    await waitFor(() =>
      expect(screen.getByRole('region', { name: /^Watching \(1\)/ })).toBeInTheDocument(),
    );
  });

  it('deletes an alert', async () => {
    const user = userEvent.setup();
    await addAlert(70000);
    render();

    await user.click(await screen.findByRole('button', { name: /delete alert on BTC/i }));
    await waitFor(() => expect(screen.getByText(/No alerts yet/i)).toBeInTheDocument());
  });

  it('has no accessibility violations', async () => {
    await addAlert(70000);
    const { container } = render();
    await screen.findByRole('region', { name: /^Watching/ });

    const violations = await findAccessibilityViolations(container);
    expect(violations, describeViolations(violations)).toHaveLength(0);
  });
});
