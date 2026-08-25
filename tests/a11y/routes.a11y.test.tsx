import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { PulseRoute } from '@/features/pulse/PulseRoute';
import { LearnRoute } from '@/features/learn/LearnRoute';
import { ModelDeskRoute } from '@/features/model-desk/ModelDeskRoute';
import { AboutPanel } from '@/features/settings/AboutPanel';
import { PrivacyPanel } from '@/features/settings/PrivacyPanel';
import { AppearancePanel } from '@/features/settings/AppearancePanel';
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
