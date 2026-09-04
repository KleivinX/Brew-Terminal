import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OnboardingDialog } from '@/features/onboarding/OnboardingDialog';
import { __resetHarness, browserInvoke } from '@/lib/ipc.browser';
import { useUiStore } from '@/stores/uiStore';
import { renderWithProviders } from '../setup/renderWithProviders';
import { findAccessibilityViolations, describeViolations } from '../setup/axe';

const SETTLE = { timeout: 4000 } as const;

beforeEach(() => {
  __resetHarness();
  useUiStore.setState({ onboardingReplays: 0 });
});

async function markComplete(): Promise<void> {
  await browserInvoke('set_preference', { key: 'onboardingCompleted', value: 'true' });
}

function welcome(): Promise<HTMLElement> {
  return screen.findByRole('heading', { name: 'Welcome to Brew Terminal' });
}

describe('first run', () => {
  it('introduces the app when the flag has never been set', async () => {
    renderWithProviders(<OnboardingDialog />);
    expect(await welcome()).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument();
  });

  it('stays away once it has been completed', async () => {
    await markComplete();
    renderWithProviders(<OnboardingDialog />);

    // Give the preferences query time to resolve; the assertion is that nothing appears even
    // after it has.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), SETTLE);
  });

  /**
   * The flash this prevents: reading `preferences?.onboardingCompleted ?? false` while the
   * query is still in flight is `false`, so a completed user would see the introduction open
   * and snap shut on every single launch.
   */
  it('does not appear in the moment before preferences load', async () => {
    await markComplete();
    renderWithProviders(<OnboardingDialog />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('walks forward and back through the steps', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OnboardingDialog />);
    await welcome();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('heading', { name: 'Pick a look' })).toBeInTheDocument();
    expect(screen.getByText('Step 2 of 4')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await welcome()).toBeInTheDocument();
  });

  it('has no Back button to press on the first step', async () => {
    renderWithProviders(<OnboardingDialog />);
    await welcome();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
  });

  it('ends on the privacy step, which is the one worth reading', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OnboardingDialog />);
    await welcome();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(
      await screen.findByRole('heading', { name: 'What leaves this computer' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
  });
});

describe('leaving the introduction', () => {
  it('remembers a skip, so it does not ask again', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OnboardingDialog />);
    await welcome();

    await user.click(screen.getByRole('button', { name: 'Skip' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), SETTLE);
    await waitFor(async () => {
      const prefs = (await browserInvoke('get_preferences')) as { onboardingCompleted: boolean };
      expect(prefs.onboardingCompleted).toBe(true);
    }, SETTLE);
  });

  it('remembers finishing it too', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OnboardingDialog />);
    await welcome();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), SETTLE);
    await waitFor(async () => {
      const prefs = (await browserInvoke('get_preferences')) as { onboardingCompleted: boolean };
      expect(prefs.onboardingCompleted).toBe(true);
    }, SETTLE);
  });

  it('closes on the click, without waiting for the write to land', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OnboardingDialog />);
    await welcome();

    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('showing it again', () => {
  /**
   * Settings offers this, which is what makes dismissing it safe. It has to work even though
   * the preference by then says the introduction is finished.
   */
  it('reopens on request even after it has been completed', async () => {
    await markComplete();
    renderWithProviders(<OnboardingDialog />);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), SETTLE);

    useUiStore.getState().replayOnboarding();
    expect(await welcome()).toBeInTheDocument();
  });

  it('starts a replay from the beginning rather than where it was left', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OnboardingDialog />);
    await welcome();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: 'Pick a look' });
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), SETTLE);

    useUiStore.getState().replayOnboarding();

    expect(await welcome()).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument();
  });
});

describe('the theme step', () => {
  it('applies a theme as it is chosen', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OnboardingDialog />);
    await welcome();
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await user.click(await screen.findByRole('radio', { name: /Light/ }));

    await waitFor(
      () => expect(document.documentElement.getAttribute('data-theme')).toBe('light'),
      SETTLE,
    );
  });

  it('says which theme is selected rather than only tinting it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OnboardingDialog />);
    await welcome();
    await user.click(screen.getByRole('button', { name: 'Next' }));

    const soft = await screen.findByRole('radio', { name: /Soft/ });
    await user.click(soft);
    await waitFor(() => expect(soft).toHaveAttribute('aria-checked', 'true'), SETTLE);
  });
});

describe('onboarding accessibility', () => {
  it('has no violations on any step', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OnboardingDialog />);
    await welcome();

    for (let step = 0; step < 4; step += 1) {
      const violations = await findAccessibilityViolations(document.body);
      expect(violations, `step ${step + 1}: ${describeViolations(violations)}`).toHaveLength(0);
      if (step < 3) await user.click(screen.getByRole('button', { name: 'Next' }));
    }
  });
});
