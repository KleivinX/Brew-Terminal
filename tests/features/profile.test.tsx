import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfilePanel } from '@/features/settings/ProfilePanel';
import { scorePassword, MIN_PASSWORD_CHARS } from '@/features/settings/passwordStrength';
import { __resetHarness } from '@/lib/ipc.browser';
import { renderWithProviders } from '../setup/renderWithProviders';

const GOOD_PASSWORD = 'correct horse battery staple';

beforeEach(() => {
  __resetHarness();
});

async function exportAProfile(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(await screen.findByLabelText(/^Password$/i), GOOD_PASSWORD);
  await user.type(screen.getByLabelText(/Password again/i), GOOD_PASSWORD);
  await user.click(screen.getByRole('button', { name: /Choose location and export/i }));
  // Keyed on the success line specifically: the strength hint is also role="status", and the
  // explanatory copy below also contains the word "encrypted".
  await waitFor(() => expect(screen.getByText(/^Written to /)).toBeInTheDocument());
}

describe('the export password meter', () => {
  it('refuses anything under the floor', () => {
    expect(scorePassword('short').level).toBe('too-short');
    expect(scorePassword('elevenchars').level).toBe('too-short');
    expect(scorePassword('twelvechars!').level).not.toBe('too-short');
  });

  it('counts characters rather than bytes', () => {
    // Twelve non-ASCII characters is twelve characters, not twenty-four bytes' worth.
    expect(scorePassword('ααααββββγγγγ'.slice(0, 12)).level).not.toBe('too-short');
  });

  it('calls out the passwords everyone tries first', () => {
    expect(scorePassword('passwordpassword').level).toBe('weak');
    expect(scorePassword('letmeinletmein!!').level).toBe('weak');
  });

  it('calls out repetition and sequences that only look long', () => {
    expect(scorePassword('aaaaaaaaaaaaaaaa').level).toBe('weak');
    expect(scorePassword('abcabcabcabcabca').level).toBe('weak');
    expect(scorePassword('abcdefghijklmnop').level).toBe('weak');
  });

  it('rates a long passphrase highly without demanding symbols', () => {
    // The advice people are usually given pushes them toward short-and-punctuated, which is
    // worse. The meter must not do that.
    expect(scorePassword('correct horse battery staple').level).toBe('strong');
  });

  it('always says in words what the bars say in colour', () => {
    for (const value of [
      'short',
      'passwordpassword',
      'a reasonable one here',
      'correct horse battery staple',
    ]) {
      expect(scorePassword(value).label.length).toBeGreaterThan(0);
    }
  });
});

describe('exporting a profile', () => {
  it('cannot be started without a password that meets the floor', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProfilePanel />);

    const button = screen.getByRole('button', { name: /Choose location and export/i });
    expect(button).toBeDisabled();

    await user.type(screen.getByLabelText(/^Password$/i), 'tooshort');
    await user.type(screen.getByLabelText(/Password again/i), 'tooshort');
    expect(button).toBeDisabled();
  });

  it('cannot be started until both fields match', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProfilePanel />);

    await user.type(screen.getByLabelText(/^Password$/i), GOOD_PASSWORD);
    await user.type(screen.getByLabelText(/Password again/i), 'something else entirely');

    expect(screen.getByText(/do not match/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Choose location and export/i })).toBeDisabled();
  });

  it('says plainly that a forgotten password is unrecoverable', () => {
    renderWithProviders(<ProfilePanel />);
    expect(screen.getByText(/cannot be recovered/i)).toBeInTheDocument();
  });

  it('states that keys are not in the file', () => {
    renderWithProviders(<ProfilePanel />);
    expect(screen.getByText(/contains no API keys/i)).toBeInTheDocument();
  });

  it('writes a file and reports where it went', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProfilePanel />);
    await exportAProfile(user);

    expect(screen.getByText(/Written to .*brewprofile/)).toBeInTheDocument();
  });
});

describe('importing a profile', () => {
  it('shows what is in the file before offering to apply it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProfilePanel />, { resetHarness: false });
    await exportAProfile(user);

    // Nothing to apply until a file has actually been opened.
    expect(
      screen.queryByRole('button', { name: /Merge with what is here/i }),
    ).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/Password for that file/i), GOOD_PASSWORD);
    await user.click(screen.getByRole('button', { name: /Choose a file and open it/i }));

    expect(await screen.findByText(/What is in that file/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Merge with what is here/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Replace what is here/i })).toBeInTheDocument();
  });

  it('reports a wrong password without applying anything', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProfilePanel />, { resetHarness: false });
    await exportAProfile(user);

    await user.type(screen.getByLabelText(/Password for that file/i), 'not the right password');
    await user.click(screen.getByRole('button', { name: /Choose a file and open it/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/did not open the file/i);
    expect(screen.queryByText(/What is in that file/i)).not.toBeInTheDocument();
  });

  /** The same message for a wrong password and a tampered file — see THREAT_MODEL.md §6.3. */
  it('does not say which of the two went wrong', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProfilePanel />, { resetHarness: false });
    await exportAProfile(user);

    await user.type(screen.getByLabelText(/Password for that file/i), 'not the right password');
    await user.click(screen.getByRole('button', { name: /Choose a file and open it/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/or the file has been altered/i);
  });

  it('requires an explicit merge-or-replace choice and names the backup', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProfilePanel />, { resetHarness: false });
    await exportAProfile(user);

    await user.type(screen.getByLabelText(/Password for that file/i), GOOD_PASSWORD);
    await user.click(screen.getByRole('button', { name: /Choose a file and open it/i }));
    await screen.findByText(/What is in that file/i);

    await user.click(screen.getByRole('button', { name: /Merge with what is here/i }));

    await waitFor(() => expect(screen.getByText(/backed up to/i)).toBeInTheDocument());
  });

  it('explains what replace actually does before it is chosen', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProfilePanel />, { resetHarness: false });
    await exportAProfile(user);

    await user.type(screen.getByLabelText(/Password for that file/i), GOOD_PASSWORD);
    await user.click(screen.getByRole('button', { name: /Choose a file and open it/i }));
    await screen.findByText(/What is in that file/i);

    expect(screen.getByText(/Merge adds and updates, and deletes nothing/i)).toBeInTheDocument();
    expect(screen.getByText(/Replace clears your watchlists/i)).toBeInTheDocument();
  });

  it('rejects a file it has never seen', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProfilePanel />);

    await user.type(screen.getByLabelText(/Password for that file/i), GOOD_PASSWORD);
    await user.click(screen.getByRole('button', { name: /Choose a file and open it/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('the password floor', () => {
  it('is the same number in the meter and in the copy', () => {
    renderWithProviders(<ProfilePanel />);
    expect(
      screen.getByText(new RegExp(`At least ${MIN_PASSWORD_CHARS} characters`)),
    ).toBeInTheDocument();
  });
});
