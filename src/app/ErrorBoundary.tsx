import { Component, type ErrorInfo, type ReactNode } from 'react';
import styles from './ErrorBoundary.module.css';

interface Props {
  children: ReactNode;
  /** Named so the message can say which part failed rather than "something broke". */
  area: string;
  onReset?: (() => void) | undefined;
}

interface State {
  error: Error | null;
}

/**
 * Route- and panel-level boundary. A broken panel must never take down the navigation shell —
 * the user should always be able to get somewhere else.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Last-resort surface: there is no telemetry by design, so a dev console is all we have.
    console.error(`[brew-terminal] ${this.props.area} failed:`, error, info.componentStack);
  }

  private handleReset = (): void => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className={styles.boundary} role="alert">
        <h2 className={styles.title}>{this.props.area} ran into a problem</h2>
        <p className={styles.detail}>
          The rest of the app is still working. You can retry this section, or move to another part
          of Brew Terminal.
        </p>
        <pre className={styles.message}>{error.message}</pre>
        <button type="button" className={styles.retry} onClick={this.handleReset}>
          Retry this section
        </button>
      </div>
    );
  }
}
