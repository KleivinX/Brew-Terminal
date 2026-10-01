import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KronosPanel } from '@/features/research/KronosPanel';
import { __resetHarness, browserInvoke } from '@/lib/ipc.browser';
import { renderWithProviders } from '../setup/renderWithProviders';
import { findAccessibilityViolations, describeViolations } from '../setup/axe';

beforeEach(() => {
  __resetHarness();
});

function renderPanel(options = {}) {
  return renderWithProviders(
    <KronosPanel assetId="crypto:cg:bitcoin" symbol="BTC" currency="USD" />,
    options,
  );
}

async function switchOn(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(await screen.findByRole('button', { name: 'Switch on Kronos' }));
  await user.click(screen.getByRole('button', { name: 'I understand and agree' }));
}

describe('Kronos projection', () => {
  it('offers nothing but the explanation until the reader has agreed to what it is', async () => {
    renderPanel();

    expect(await screen.findByRole('button', { name: 'Switch on Kronos' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Download the model/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Run Kronos/ })).not.toBeInTheDocument();
    // Who made it is said before anything is switched on, not after.
    expect(await screen.findByText(/made by NeoQuasar, not by Brew Terminal/)).toBeInTheDocument();
  });

  it('says in the dialog that it errs, is not ours, and is the reader’s responsibility', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole('button', { name: 'Switch on Kronos' }));

    const dialog = screen.getByRole('dialog', { name: 'Before you use Kronos' });
    expect(within(dialog).getByText(/it makes mistakes/)).toBeInTheDocument();
    expect(within(dialog).getByText(/It is not ours/)).toBeInTheDocument();
    expect(within(dialog).getByText(/accept no responsibility for any loss/)).toBeInTheDocument();
  });

  it('declining leaves it off and records nothing', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(await screen.findByRole('button', { name: 'Switch on Kronos' }));
    await user.click(screen.getByRole('button', { name: 'Not now' }));

    expect(screen.getByRole('button', { name: 'Switch on Kronos' })).toBeInTheDocument();
    const prefs = (await browserInvoke('get_preferences')) as { kronosAcknowledged: boolean };
    expect(prefs.kronosAcknowledged).toBe(false);
  });

  it('asks once: after agreeing, a fresh mount goes straight to the download', async () => {
    const user = userEvent.setup();
    const first = renderPanel();
    await switchOn(user);
    expect(
      await screen.findByRole('button', { name: /Download the model \(115 MB\)/ }),
    ).toBeInTheDocument();

    first.unmount();
    renderPanel({ resetHarness: false });

    expect(await screen.findByRole('button', { name: /Download the model/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Switch on Kronos' })).not.toBeInTheDocument();
  });

  it('runs, and states the result in words and in a table as well as a picture', async () => {
    const user = userEvent.setup();
    renderPanel();
    await switchOn(user);
    await user.click(await screen.findByRole('button', { name: /Download the model/ }));
    await user.click(await screen.findByRole('button', { name: 'Run Kronos on BTC' }));

    expect(await screen.findByText(/not what will happen/)).toBeInTheDocument();
    expect(screen.getByText(/Average of 20 model runs/)).toBeInTheDocument();
    // The provider and age of the candles it ran on, like every other figure in the app.
    expect(screen.getByText('fixtures')).toBeInTheDocument();

    const table = screen.getByRole('table', { hidden: true });
    // A header row and one row per projected candle.
    expect(within(table).getAllByRole('row', { hidden: true })).toHaveLength(11);
  });

  it('removing the model takes the result off screen with it', async () => {
    const user = userEvent.setup();
    renderPanel();
    await switchOn(user);
    await user.click(await screen.findByRole('button', { name: /Download the model/ }));
    await user.click(await screen.findByRole('button', { name: 'Run Kronos on BTC' }));
    await screen.findByText(/not what will happen/);

    await user.click(screen.getByRole('button', { name: 'Remove the model from this computer' }));

    await waitFor(() => expect(screen.queryByText(/not what will happen/)).not.toBeInTheDocument());
    expect(await screen.findByRole('button', { name: /Download the model/ })).toBeInTheDocument();
  });

  it('says so, rather than drawing nothing, when an asset has too little history', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <KronosPanel assetId="crypto:cg:nothing-here" symbol="NOPE" currency="USD" />,
    );
    await switchOn(user);
    await user.click(await screen.findByRole('button', { name: /Download the model/ }));
    await user.click(await screen.findByRole('button', { name: 'Run Kronos on NOPE' }));

    expect(await screen.findByText(/not enough candle history/)).toBeInTheDocument();
  });

  it('the harness refuses to run before agreement, as the Rust service does', async () => {
    await expect(
      browserInvoke('run_kronos_projection', { assetId: 'crypto:cg:bitcoin' }),
    ).rejects.toMatchObject({
      message: 'Kronos has not been switched on.',
    });
  });

  it('has no accessibility violations with a result on screen', async () => {
    const user = userEvent.setup();
    const { container } = renderPanel();
    await switchOn(user);
    await user.click(await screen.findByRole('button', { name: /Download the model/ }));
    await user.click(await screen.findByRole('button', { name: 'Run Kronos on BTC' }));
    await screen.findByText(/not what will happen/);

    const violations = await findAccessibilityViolations(container);
    expect(violations, describeViolations(violations)).toEqual([]);
  });
});
