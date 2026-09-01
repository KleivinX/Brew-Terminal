import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { ErrorBoundary } from './ErrorBoundary';
import { RouteFallback } from './RouteFallback';
import { PulseRoute } from '@/features/pulse/PulseRoute';

/**
 * Pulse ships in the initial chunk because it is the landing route. Everything else is lazy —
 * this is the main lever for the 200 KB initial-bundle budget in ARCHITECTURE.md §5.
 */
const PortfolioRoute = lazy(() =>
  import('@/features/portfolio/PortfolioRoute').then((m) => ({ default: m.PortfolioRoute })),
);
const ResearchRoute = lazy(() =>
  import('@/features/research/ResearchRoute').then((m) => ({ default: m.ResearchRoute })),
);
const LearnRoute = lazy(() =>
  import('@/features/learn/LearnRoute').then((m) => ({ default: m.LearnRoute })),
);
const ModelDeskRoute = lazy(() =>
  import('@/features/model-desk/ModelDeskRoute').then((m) => ({ default: m.ModelDeskRoute })),
);
const SettingsRoute = lazy(() =>
  import('@/features/settings/SettingsRoute').then((m) => ({ default: m.SettingsRoute })),
);

export function AppRoutes() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/pulse" replace />} />

        <Route
          path="/portfolio"
          element={
            <ErrorBoundary area="Portfolio">
              <Suspense fallback={<RouteFallback label="Portfolio" />}>
                <PortfolioRoute />
              </Suspense>
            </ErrorBoundary>
          }
        />

        <Route
          path="/pulse"
          element={
            <ErrorBoundary area="Pulse">
              <PulseRoute />
            </ErrorBoundary>
          }
        />

        <Route
          path="/research/:assetId?"
          element={
            <ErrorBoundary area="Research Lab">
              <Suspense fallback={<RouteFallback label="Loading Research Lab" />}>
                <ResearchRoute />
              </Suspense>
            </ErrorBoundary>
          }
        />

        <Route
          path="/learn/*"
          element={
            <ErrorBoundary area="Learn">
              <Suspense fallback={<RouteFallback label="Loading Learn" />}>
                <LearnRoute />
              </Suspense>
            </ErrorBoundary>
          }
        />

        <Route
          path="/desk/*"
          element={
            <ErrorBoundary area="Model Desk">
              <Suspense fallback={<RouteFallback label="Loading Model Desk" />}>
                <ModelDeskRoute />
              </Suspense>
            </ErrorBoundary>
          }
        />

        <Route
          path="/settings/*"
          element={
            <ErrorBoundary area="Settings">
              <Suspense fallback={<RouteFallback label="Loading Settings" />}>
                <SettingsRoute />
              </Suspense>
            </ErrorBoundary>
          }
        />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </AppShell>
  );
}

function NotFound() {
  return (
    <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
      <h1 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-4)' }}>
        That page does not exist
      </h1>
      <p style={{ color: 'var(--text-secondary)' }}>
        <a href="#/pulse" style={{ color: 'var(--accent)' }}>
          Go back to Pulse
        </a>
      </p>
    </div>
  );
}
