import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { usePreferences, useSetPreference } from '@/lib/preferences';
import { useUiStore } from '@/stores/uiStore';
import { THEMES, THEME_DESCRIPTIONS, THEME_LABELS, useTheme } from '@/app/providers/ThemeProvider';
import styles from './OnboardingDialog.module.css';

/**
 * The first-run introduction.
 *
 * `onboardingCompleted` has been in the preferences schema, the Rust model and the browser
 * harness since the first migration, and until now nothing read it. This is the screen it was
 * always for.
 *
 * What it is not: a feature tour. Four steps, each answering a question a new reader actually
 * has — what is this, what does it look like, what works without signing up for anything, and
 * what leaves this computer. The last one is the reason the app exists and is the one thing
 * here that would be irresponsible to leave to discovery.
 */

interface Step {
  title: string;
  body: ReactNode;
}

/** Marks the flow finished. Shared by Finish, Skip, Escape and the backdrop. */
function useCompleteOnboarding(): () => void {
  const setPreference = useSetPreference();
  return () => setPreference.mutate({ key: 'onboardingCompleted', value: true });
}

function ThemeChoice() {
  const { theme, setTheme } = useTheme();

  return (
    <div className={styles.themes} role="radiogroup" aria-label="Theme">
      {THEMES.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={theme === option}
          className={styles.theme}
          onClick={() => setTheme(option)}
        >
          <span className={styles.themeName}>{THEME_LABELS[option]}</span>
          <span className={styles.themeHint}>{THEME_DESCRIPTIONS[option]}</span>
        </button>
      ))}
    </div>
  );
}

export function OnboardingDialog() {
  const { data: preferences, isSuccess } = usePreferences();
  const complete = useCompleteOnboarding();
  const navigate = useNavigate();

  const replays = useUiStore((state) => state.onboardingReplays);

  /*
   * Which step, and whether it has been closed — both tagged with the replay generation they
   * belong to.
   *
   * The tag is what makes a replay reset them by derivation instead of by an effect that
   * writes state during render. Progress recorded against an older generation simply stops
   * applying, so asking to see the introduction again reopens it at step one with no
   * synchronisation to get wrong.
   *
   * Closing is local rather than a read of the preference because the dialog has to go away on
   * the click that dismissed it, not after a round trip to SQLite — and it has to go away even
   * if that write fails. An introduction that will not close is worse than one that shows
   * twice.
   */
  const [progress, setProgress] = useState({ generation: 0, step: 0, dismissed: false });
  const live =
    progress.generation === replays ? progress : { generation: replays, step: 0, dismissed: false };
  const step = live.step;
  const dismissed = live.dismissed;

  const goTo = (next: number): void =>
    setProgress({ generation: replays, step: next, dismissed: false });

  const headingRef = useRef<HTMLHeadingElement>(null);

  const steps: Step[] = [
    {
      title: 'Welcome to Brew Terminal',
      body: (
        <>
          <p>
            A research terminal for crypto and stocks that runs entirely on this computer. No
            account, no sync, no telemetry.
          </p>
          <p>
            Every figure it shows carries the provider it came from and the moment it was fetched.
            When a number is stale or a provider is unreachable, the app says so rather than showing
            you the last thing it happened to have.
          </p>
          <p className={styles.emphasis}>
            It is a research tool, not an adviser. Your decisions, and their consequences, are your
            own.
          </p>
        </>
      ),
    },
    {
      title: 'Pick a look',
      body: (
        <>
          <p>Changes apply immediately. You can switch again in Settings at any time.</p>
          <ThemeChoice />
        </>
      ),
    },
    {
      title: 'What works right now',
      body: (
        <>
          <p>
            Crypto prices, macroeconomic series from the US Federal Reserve, the two Fear &amp;
            Greed indices and the news feeds all work as soon as you close this — none of them need
            a credential.
          </p>
          <p>
            US stock quotes are the exception. Those providers require a key for every endpoint, so
            they stay switched off until you add one. The keys are free and the Data providers panel
            links to where you get them.
          </p>
        </>
      ),
    },
    {
      title: 'What leaves this computer',
      body: (
        <>
          <p>
            Only provider requests for the market data you are looking at. Your notes, watchlists,
            portfolio and alerts are never part of one.
          </p>
          <p>
            The Model Desk — the optional AI — is off until you configure it yourself. When it is
            on, nothing is sent without a dialog showing you the exact text first, and what was sent
            is recorded locally.
          </p>
          <p>All of this is under Settings, in Privacy and data.</p>
        </>
      ),
    },
  ];

  const last = step === steps.length - 1;
  const current = steps[step];

  /*
   * Move focus to the heading on each step. Without it a screen reader hears nothing when the
   * dialog's whole contents are swapped, because the dialog itself never re-opened — the same
   * reason the step counter below is a live region.
   */
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const finish = (): void => {
    setProgress({ generation: replays, step, dismissed: true });
    complete();
  };

  /*
   * Held back until preferences have actually loaded. Reading `?? false` from an undefined
   * result would flash this dialog on every launch in the moment before the query resolves.
   *
   * A replay opens it whatever the stored flag says, so asking to see it again does not depend
   * on writing the preference back to false and leaving it there if the user never finishes.
   */
  const firstRun = isSuccess && preferences?.onboardingCompleted === false;
  const open = !dismissed && (replays > 0 || firstRun);
  if (!open || !current) return null;

  return (
    /*
     * hideHeader, because this dialog draws its own heading. Modal's header would render the
     * same title a second line above it, and the duplicate would also give the step two
     * headings with identical text in the accessibility tree.
     *
     * Nothing is lost by dropping Modal's close button: Escape still closes (Modal owns that),
     * and Skip in the footer says what dismissing actually means here rather than leaving it
     * to an X.
     */
    <Modal open onClose={finish} title={current.title} size="md" hideHeader>
      <div className={styles.body}>
        <h2 ref={headingRef} tabIndex={-1} className={styles.heading}>
          {current.title}
        </h2>

        <div className={styles.content}>{current.body}</div>

        <p className={styles.counter} aria-live="polite">
          Step {step + 1} of {steps.length}
        </p>

        <div className={styles.actions}>
          <Button variant="ghost" onClick={finish}>
            Skip
          </Button>

          <div className={styles.nav}>
            {step > 0 ? (
              <Button variant="secondary" onClick={() => goTo(step - 1)}>
                Back
              </Button>
            ) : null}

            {last ? (
              <Button
                variant="primary"
                onClick={() => {
                  finish();
                  void navigate('/pulse');
                }}
              >
                Start
              </Button>
            ) : (
              <Button variant="primary" onClick={() => goTo(step + 1)}>
                Next
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
