import { HashRouter } from 'react-router-dom';
import { QueryProvider } from './providers/QueryProvider';
import { ThemeProvider } from './providers/ThemeProvider';
import { KeyboardProvider } from './KeyboardProvider';
import { ErrorBoundary } from './ErrorBoundary';
import { AppRoutes } from './router';
import { CommandPalette } from '@/components/palette/CommandPalette';

/**
 * Hash history: avoids custom-protocol path-resolution differences across WKWebView,
 * WebView2 and WebKitGTK. See ADR-009.
 */
export function App() {
  return (
    <ErrorBoundary area="Brew Terminal">
      <QueryProvider>
        <HashRouter>
          <ThemeProvider>
            <KeyboardProvider>
              <AppRoutes />
              <CommandPalette />
            </KeyboardProvider>
          </ThemeProvider>
        </HashRouter>
      </QueryProvider>
    </ErrorBoundary>
  );
}
