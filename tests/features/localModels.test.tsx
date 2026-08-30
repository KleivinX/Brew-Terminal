import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocalModelsPanel } from '@/features/settings/LocalModelsPanel';
import { __resetHarness } from '@/lib/ipc.browser';
import { renderWithProviders } from '../setup/renderWithProviders';
import { findAccessibilityViolations, describeViolations } from '../setup/axe';

beforeEach(() => {
  __resetHarness();
});

async function modelList(): Promise<HTMLElement> {
  return waitFor(() => within(screen.getByRole('region', { name: 'Models' })).getByRole('list'), {
    timeout: 4000,
  });
}

describe('local models', () => {
  it('lists what can be downloaded, with size, licence and memory needed', async () => {
    renderWithProviders(<LocalModelsPanel />);
    const list = await modelList();

    expect(within(list).getByText('Llama 3.2 1B Instruct')).toBeInTheDocument();
    // The facts someone needs before committing to a large download.
    expect(within(list).getByText(/808 MB on disk/)).toBeInTheDocument();
    expect(within(list).getByText(/Llama 3.2 Community License/)).toBeInTheDocument();
  });

  /**
   * The claim the whole feature rests on. If this address were ever not loopback, the model
   * server would be reachable from the network without authentication.
   */
  it('advertises a loopback address and nothing else', async () => {
    renderWithProviders(<LocalModelsPanel />);
    await modelList();

    const address = await screen.findByText(/^http:\/\/127\.0\.0\.1:\d+\/v1$/);
    expect(address).toBeInTheDocument();
  });

  it('says plainly that downloads are third-party and only checksum-verified', async () => {
    renderWithProviders(<LocalModelsPanel />);
    await modelList();

    const notice = screen.getByText(/third-party software and model weights/i);
    expect(notice).toHaveTextContent(/checked against a checksum/i);
    // The limit of that check is stated, not implied.
    expect(notice).toHaveTextContent(/not that anyone here has reviewed it/i);
  });

  it('will not start a model before the engine is installed', async () => {
    renderWithProviders(<LocalModelsPanel />);
    await modelList();

    expect(screen.getByRole('button', { name: /download the engine/i })).toBeInTheDocument();
    // Nothing is installed, so there is nothing to start yet.
    expect(screen.queryByRole('button', { name: /^start$/i })).not.toBeInTheDocument();
  });

  it('installs the engine, downloads a model, then starts and stops it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LocalModelsPanel />);
    await modelList();

    await user.click(screen.getByRole('button', { name: /download the engine/i }));
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: /download the engine/i }),
      ).not.toBeInTheDocument(),
    );

    const list = await modelList();
    const row = within(list).getByText('Llama 3.2 1B Instruct').closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /^download$/i }));

    await waitFor(() =>
      expect(within(row).getByRole('button', { name: /^start$/i })).toBeInTheDocument(),
    );

    await user.click(within(row).getByRole('button', { name: /^start$/i }));
    await waitFor(() => expect(within(row).getByText('Running')).toBeInTheDocument());

    // Once running, the panel explains where it is answering.
    expect(screen.getByRole('region', { name: 'Using it' })).toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: /^stop$/i }));
    await waitFor(() => expect(within(row).queryByText('Running')).not.toBeInTheDocument());
  });

  it('frees the disk usage it reported when a model is deleted', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LocalModelsPanel />);
    const list = await modelList();

    const row = within(list).getByText('Qwen2.5 0.5B Instruct').closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /^download$/i }));
    // 491,400,032 bytes reads as MB, not a rounded "0.5 GB" — the panel does not inflate sizes.
    await waitFor(() => expect(screen.getByText('491 MB')).toBeInTheDocument());

    await user.click(within(row).getByRole('button', { name: /delete Qwen2.5 0.5B Instruct/i }));
    await waitFor(() => expect(screen.getByText('0 MB')).toBeInTheDocument());
  });

  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(<LocalModelsPanel />);
    await modelList();

    const violations = await findAccessibilityViolations(container);
    expect(violations, describeViolations(violations)).toHaveLength(0);
  });
});
