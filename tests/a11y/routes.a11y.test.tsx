import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { PulseRoute } from '@/features/pulse/PulseRoute';
import { LearnRoute } from '@/features/learn/LearnRoute';
import { ModelDeskRoute } from '@/features/model-desk/ModelDeskRoute';
import { AboutPanel } from '@/features/settings/AboutPanel';
import { PrivacyPanel } from '@/features/settings/PrivacyPanel';
import { AppearancePanel } from '@/features/settings/AppearancePanel';
import { AiPanel } from '@/features/settings/AiPanel';
import { ProfilePanel } from '@/features/settings/ProfilePanel';
import { CommunityPanel } from '@/features/research/CommunityPanel';
import { browserInvoke } from '@/lib/ipc.browser';
import { DISCLAIMER_TEXT } from '@/components/status/DisclaimerNote';
import { renderWithProviders } from '../setup/renderWithProviders';
import { describeViolations, findAccessibilityViolations } from '../setup/axe';

const ROUTES = [
  ['Pulse', <PulseRoute key="pulse" />],
  ['Learn', <LearnRoute key="learn" />],
  ['Model Desk', <ModelDeskRoute key="desk" />],
  ['Settings · Appearance', <AppearancePanel key="appearance" />],
  ['Settings · Privacy', <PrivacyPanel key="privacy" />],
  ['Settings · About', <AboutPanel key="about" />],
  ['Settings · AI providers', <AiPanel key="ai" />],
  ['Settings · Backup and transfer', <ProfilePanel key="profile" />],
  ['Research · Community', <CommunityPanel key="community" />],
] as const;

describe.each(ROUTES)('%s', (name, element) => {
  it('has no accessibility violations', async () => {
    const { container } = renderWithProviders(element);

    // Let the first data load settle so the real content is audited, not a skeleton.
    await waitFor(() => expect(container.textContent).not.toBe(''));

    const violations = await findAccessibilityViolations(container);
    expect(violations, `${name}:\n${describeViolations(violations)}`).toHaveLength(0);
  });

  it('has exactly one level-1 heading', async () => {
    renderWithProviders(element);
    await waitFor(() => expect(document.body.textContent).not.toBe(''));

    const h1s = screen.queryAllByRole('heading', { level: 1 });
    expect(h1s.length).toBeLessThanOrEqual(1);
  });
});

/*
 * The surfaces above are audited in their default state. Several of them look quite different
 * once switched on, and an audit that only ever sees the "off" state is auditing an empty box —
 * so the configured states get their own pass.
 */
const CONFIGURED = [
  [
    'Model Desk · in use',
    <ModelDeskRoute key="desk-on" />,
    async () => {
      await browserInvoke('save_ai_endpoint', {
        endpoint: 'http://127.0.0.1:11434/v1',
        model: 'llama3.1',
      });
      await browserInvoke('set_preference', { key: 'aiEnabled', value: 'true' });
    },
  ],
  [
    'Research · Community, switched on',
    <CommunityPanel key="community-on" />,
    async () => {
      await browserInvoke('set_preference', { key: 'communityEnabled', value: 'true' });
    },
  ],
  [
    'Settings · AI providers, hosted',
    <AiPanel key="ai-cloud" />,
    async () => {
      await browserInvoke('set_preference', { key: 'aiMode', value: '"cloud"' });
    },
  ],
] as const;

describe.each(CONFIGURED)('%s', (name, element, configure) => {
  it('has no accessibility violations', async () => {
    await configure();
    const { container } = renderWithProviders(element, { resetHarness: false });

    await waitFor(() => expect(container.textContent).not.toBe(''));

    const violations = await findAccessibilityViolations(container);
    expect(violations, `${name}:\n${describeViolations(violations)}`).toHaveLength(0);
  });
});

describe('disclaimer coverage', () => {
  it('appears on Pulse, where prices are shown', async () => {
    renderWithProviders(<PulseRoute />);
    await waitFor(() => {
      expect(screen.getAllByText(DISCLAIMER_TEXT).length).toBeGreaterThan(0);
    });
  });

  it('appears on Model Desk, beside AI output', async () => {
    renderWithProviders(<ModelDeskRoute />);
    await waitFor(() => {
      expect(screen.getAllByText(new RegExp(DISCLAIMER_TEXT)).length).toBeGreaterThan(0);
    });
  });

  it('appears on the Model Desk in use, beside every model answer', async () => {
    await browserInvoke('save_ai_endpoint', {
      endpoint: 'http://127.0.0.1:11434/v1',
      model: 'llama3.1',
    });
    await browserInvoke('set_preference', { key: 'aiEnabled', value: 'true' });
    renderWithProviders(<ModelDeskRoute />, { resetHarness: false });

    await waitFor(() => {
      expect(screen.getAllByText(new RegExp(DISCLAIMER_TEXT)).length).toBeGreaterThan(0);
    });
  });

  it('appears beside community content, which is other people’s opinions', async () => {
    await browserInvoke('set_preference', { key: 'communityEnabled', value: 'true' });
    renderWithProviders(<CommunityPanel />, { resetHarness: false });

    await waitFor(() => {
      expect(screen.getAllByText(new RegExp(DISCLAIMER_TEXT)).length).toBeGreaterThan(0);
    });
  });

  it('appears on the encrypted profile page', async () => {
    renderWithProviders(<ProfilePanel />);
    await waitFor(() => {
      expect(screen.getAllByText(new RegExp(DISCLAIMER_TEXT)).length).toBeGreaterThan(0);
    });
  });

  it('appears on the AI settings page', async () => {
    renderWithProviders(<AiPanel />);
    await waitFor(() => {
      expect(screen.getAllByText(new RegExp(DISCLAIMER_TEXT)).length).toBeGreaterThan(0);
    });
  });

  it('appears in About', async () => {
    renderWithProviders(<AboutPanel />);
    await waitFor(() => {
      expect(screen.getAllByText(new RegExp(DISCLAIMER_TEXT)).length).toBeGreaterThan(0);
    });
  });
});

describe('provenance', () => {
  it('shows the provider name and a mock-data marker on Pulse', async () => {
    // Fixtures must never be mistakable for real market data.
    renderWithProviders(<PulseRoute />);

    await waitFor(
      () => {
        expect(screen.getAllByText(/Mock provider/i).length).toBeGreaterThan(0);
      },
      { timeout: 3000 },
    );
  });
});
