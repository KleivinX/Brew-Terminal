import { render, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { __resetHarness } from '@/lib/ipc.browser';

/**
 * Renders a component inside the real provider stack, backed by the browser harness.
 *
 * There is no macOS WebDriver for Tauri (ARCHITECTURE.md §12), so these component tests
 * carry a meaningful share of the UI coverage on the primary development platform. They run
 * against the same fixtures the Rust mock provider reads.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Tests assert on outcomes, not on retry behaviour; a retry only adds latency
        // and makes failures harder to read.
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
      mutations: { retry: false },
    },
  });
}

interface Options extends Omit<RenderOptions, 'wrapper'> {
  route?: string;
  queryClient?: QueryClient;
  /**
   * Set false to keep harness state across a remount — needed to test that something
   * actually persists rather than merely surviving one render.
   */
  resetHarness?: boolean;
}

export function renderWithProviders(ui: ReactElement, options: Options = {}) {
  const {
    route = '/',
    queryClient = createTestQueryClient(),
    resetHarness = true,
    ...renderOptions
  } = options;

  if (resetHarness) {
    __resetHarness();
  }

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          <ThemeProvider>{children}</ThemeProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  return {
    queryClient,
    ...render(ui, { wrapper: Wrapper, ...renderOptions }),
  };
}
