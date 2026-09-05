import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SentryRoute } from '@/features/sentry/SentryRoute';
import { formatRate } from '@/features/sentry/RatesTicker';
import { formatPosition } from '@/features/sentry/InspectorHud';
import { MAP_HEIGHT, MAP_WIDTH, project, unproject } from '@/features/sentry/worldPath';
import { __resetHarness, browserInvoke } from '@/lib/ipc.browser';
import type { ProviderInfo } from '@/types/domain';
import { renderWithProviders } from '../setup/renderWithProviders';
import { describeViolations, findAccessibilityViolations } from '../setup/axe';

const SETTLE = { timeout: 4000 } as const;

beforeEach(() => {
  __resetHarness();
});

function markerList(): HTMLElement {
  return screen.getByRole('region', { name: 'Everything on the map' });
}

async function renderSettled() {
  const result = renderWithProviders(<SentryRoute />);
  await waitFor(
    () => expect(screen.getByRole('img', { name: /World map/ })).toBeInTheDocument(),
    SETTLE,
  );
  return result;
}

describe('the map', () => {
  it('draws what it has and says how much that is', async () => {
    await renderSettled();
    const map = screen.getByRole('img', { name: /World map/ });
    expect(map).toHaveAccessibleName(/showing \d+ markers/);
  });

  /*
   * The map is role="img" with unfocusable shapes inside it, so the list is not a nicety — it
   * is the only keyboard and screen reader path onto the map. If it ever stops mirroring the
   * markers, the feature becomes pointer-only without anything else failing.
   */
  it('lists every marker it draws as a real button', async () => {
    await renderSettled();

    const drawn = document.querySelectorAll('svg [data-layer]').length;
    const listed = within(markerList()).getAllByRole('button').length;

    expect(drawn).toBeGreaterThan(0);
    expect(listed).toBe(drawn);
  });

  it('selects a marker from the list and shows what is behind it', async () => {
    const user = userEvent.setup();
    await renderSettled();

    await user.click(within(markerList()).getByRole('button', { name: /Strait of Hormuz/ }));

    const detail = await waitFor(
      () => screen.getByRole('region', { name: 'Selected marker' }),
      SETTLE,
    );
    expect(within(detail).getByRole('heading', { name: 'Strait of Hormuz' })).toBeInTheDocument();
    // The readout a reader would check against another map.
    expect(within(detail).getByText(/26\.570° N, 56\.250° E/)).toBeInTheDocument();
  });

  it('selects the same marker when it is clicked on the map', async () => {
    await renderSettled();

    const marker = document.querySelector('svg [data-layer="seismic"]');
    expect(marker).not.toBeNull();
    fireEvent.click(marker as Element);

    const detail = await waitFor(
      () => screen.getByRole('region', { name: 'Selected marker' }),
      SETTLE,
    );
    expect(within(detail).getByText('Earthquake')).toBeInTheDocument();
  });

  it('clears the selection', async () => {
    const user = userEvent.setup();
    await renderSettled();

    await user.click(within(markerList()).getByRole('button', { name: /Panama Canal/ }));
    const detail = await waitFor(
      () => screen.getByRole('region', { name: 'Selected marker' }),
      SETTLE,
    );

    await user.click(within(detail).getByRole('button', { name: 'Clear' }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Selected marker' })).not.toBeInTheDocument(),
    );
  });

  it('starts at the whole world, so zooming out is not offered', async () => {
    await renderSettled();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
  });
});

describe('the layer manager', () => {
  it('hides a layer and switches its source off, not just its pixels', async () => {
    const user = userEvent.setup();
    await renderSettled();

    expect(document.querySelectorAll('svg [data-layer="seismic"]').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('switch', { name: 'Earthquakes' }));

    await waitFor(
      () => expect(document.querySelectorAll('svg [data-layer="seismic"]')).toHaveLength(0),
      SETTLE,
    );

    // The half that matters and would be easy to miss: an unwanted layer should stop costing
    // requests, not merely stop being drawn.
    const providers = (await browserInvoke('list_providers')) as ProviderInfo[];
    expect(providers.find((entry) => entry.id === 'usgs')?.enabled).toBe(false);
  });

  /*
   * The shipped geography has no source to switch, so its toggle must change visibility
   * without trying to disable a provider that does not exist.
   */
  it('hides the shipped geography without reaching for a provider', async () => {
    const user = userEvent.setup();
    await renderSettled();

    await user.click(screen.getByRole('switch', { name: 'Chokepoints and ports' }));

    await waitFor(
      () => expect(document.querySelectorAll('svg [data-layer="chokepoints"]')).toHaveLength(0),
      SETTLE,
    );
    // Still exactly the five real sources, none of them touched.
    const providers = (await browserInvoke('list_providers')) as ProviderInfo[];
    expect(providers.filter((entry) => entry.kind === 'sentry')).toHaveLength(5);
  });

  it('states where a layer stops covering the map', async () => {
    await renderSettled();
    // Otherwise an empty Europe means "quiet", "broken" or "American" and the map cannot say
    // which.
    expect(screen.getByText(/United States only/)).toBeInTheDocument();
  });

  it('says a credentialed layer needs a key rather than failing quietly', async () => {
    await renderSettled();

    expect(screen.getByText(/Needs your own key/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add one' })).toBeInTheDocument();
    // And the licence restriction, which is the actual reason it ships off.
    expect(screen.getByText(/your own OpenSky credentials/i)).toBeInTheDocument();
  });

  it('names the provider and the age behind every layer that answered', async () => {
    await renderSettled();
    const badges = await screen.findAllByText(
      /USGS Earthquake Hazards|World Bank Open Data/,
      undefined,
      SETTLE,
    );
    expect(badges.length).toBeGreaterThan(0);
  });
});

describe('what is near a chokepoint', () => {
  it('reports a distance and refuses to draw a conclusion from it', async () => {
    await renderSettled();
    const panel = screen.getByRole('region', { name: 'Near a chokepoint' });

    expect(within(panel).getByText(/48 km from Strait of Hormuz/)).toBeInTheDocument();
    // The caveat is load-bearing: the layout invites an inference the app cannot support.
    expect(within(panel).getByText(/not something this app can tell you/i)).toBeInTheDocument();
  });

  it('selects the hazard it names', async () => {
    const user = userEvent.setup();
    await renderSettled();

    const panel = screen.getByRole('region', { name: 'Near a chokepoint' });
    await user.click(within(panel).getByRole('button', { name: /Strait of Hormuz/ }));

    const detail = await waitFor(
      () => screen.getByRole('region', { name: 'Selected marker' }),
      SETTLE,
    );
    expect(within(detail).getByRole('heading', { name: 'M4.8' })).toBeInTheDocument();
  });
});

describe('the economy board', () => {
  /*
   * The World Bank returns a different most-recent year per country in one response, so a
   * single "as of" heading would be wrong for most of the table.
   */
  it('shows each value with the year it belongs to', async () => {
    await renderSettled();
    const panel = screen.getByRole('region', { name: 'Economies' });

    const card = within(panel).getByRole('button', { name: /United States/ });
    expect(within(card).getByText('Inflation')).toBeInTheDocument();
    expect(within(card).getAllByText('2025').length).toBeGreaterThan(0);
  });

  it('does not reduce a country to one number', async () => {
    await renderSettled();
    const panel = screen.getByRole('region', { name: 'Economies' });
    // A composite "instability score" would be this app inventing a figure and presenting it
    // beside published ones. ADR-022.
    expect(within(panel).queryByText(/risk score|instability index/i)).not.toBeInTheDocument();
  });
});

describe('the rates ticker', () => {
  it('shows the publication date rather than implying a live cross', async () => {
    await renderSettled();
    expect(screen.getByText(/rates published 2026-09-05/)).toBeInTheDocument();
  });

  it('says which sources answered', async () => {
    await renderSettled();
    expect(screen.getByText(/sources answering/)).toBeInTheDocument();
  });
});

describe('accessibility', () => {
  it('has no violations', async () => {
    const { container } = await renderSettled();
    const violations = await findAccessibilityViolations(container);
    expect(violations, describeViolations(violations)).toHaveLength(0);
  });

  it('has none with a marker selected', async () => {
    const user = userEvent.setup();
    const { container } = await renderSettled();

    await user.click(within(markerList()).getByRole('button', { name: /M6\.4/ }));
    await waitFor(() => screen.getByRole('region', { name: 'Selected marker' }), SETTLE);

    const violations = await findAccessibilityViolations(container);
    expect(violations, describeViolations(violations)).toHaveLength(0);
  });
});

describe('the projection', () => {
  it('puts the corners of the world where they belong', () => {
    expect(project(90, -180)).toEqual({ x: 0, y: 0 });
    expect(project(-90, 180)).toEqual({ x: MAP_WIDTH, y: MAP_HEIGHT });
    expect(project(0, 0)).toEqual({ x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 });
  });

  /* Latitude increases northward and y increases downward — the inversion is easy to lose. */
  it('draws north above south', () => {
    expect(project(60, 0).y).toBeLessThan(project(-60, 0).y);
    expect(project(0, -120).x).toBeLessThan(project(0, 120).x);
  });

  it('round-trips', () => {
    for (const [lat, lon] of [
      [51.95, 4.14],
      [-34.36, 18.47],
      [26.57, 56.25],
      [0, 0],
    ] as const) {
      const { x, y } = project(lat, lon);
      const back = unproject(x, y);
      expect(back.lat).toBeCloseTo(lat, 9);
      expect(back.lon).toBeCloseTo(lon, 9);
    }
  });
});

describe('formatting', () => {
  /*
   * One decimal rule cannot serve USD/JPY at 156.61 and a sub-1 rate at once: two places
   * rounds the second into uselessness, four makes the first unreadable.
   */
  it('scales rate precision to the size of the number', () => {
    expect(formatRate(156.61)).toBe('156.61');
    expect(formatRate(1.0842)).toBe('1.084');
    expect(formatRate(0.86006)).toBe('0.8601');
  });

  it('does not print a rate it does not have', () => {
    expect(formatRate(Number.NaN)).toBe('—');
    expect(formatRate(Number.POSITIVE_INFINITY)).toBe('—');
  });

  it('reads out a position with hemispheres rather than signs', () => {
    expect(formatPosition(-19.914, 170.104)).toBe('19.914° S, 170.104° E');
    expect(formatPosition(52.4, -169.3)).toBe('52.400° N, 169.300° W');
    expect(formatPosition(0, 0)).toBe('0.000° N, 0.000° E');
  });
});
