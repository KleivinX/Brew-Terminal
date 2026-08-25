import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { DisclaimerNote } from '@/components/status/DisclaimerNote';
import { usePreferences } from '@/lib/preferences';
import type { AiContextItem } from '@/types/domain';
import styles from './ExplainWithModel.module.css';

interface ExplainWithModelProps {
  term: string;
  short: string;
}

/**
 * The "Explain this" entry point into Model Desk.
 *
 * Two rules govern it, both from AI_POLICY.md §2. Nothing is sent without a direct action, and
 * the exact text that would leave the device is shown before it does — itemised, not
 * summarised. So this is a consent dialog rather than a button that fires a request.
 *
 * With a model configured, confirming hands the term to the Model Desk as an attached context
 * item — which puts it in the desk's own pre-send panel, itemised again, before anything moves.
 * Two confirmations for one send is deliberate: this dialog confirms *what* is attached, the
 * desk's confirms *that it is being sent*, and the user types their actual question in between.
 *
 * Without one configured this still routes there, and that route explains it is switched off —
 * the honest behaviour rather than a button that silently does nothing.
 */
export function ExplainWithModel({ term, short }: ExplainWithModelProps) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { data: preferences } = usePreferences();

  const aiEnabled = preferences?.aiEnabled ?? false;
  const contextText = `${term}: ${short}`;

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Explain this
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title="Explain this with a model" size="md">
        <div className={styles.body}>
          {aiEnabled ? (
            <>
              <p className={styles.intro}>
                This is everything that would be sent. Nothing else from Brew Terminal — no
                watchlist, no notes, no browsing — goes with it.
              </p>
              <pre className={styles.payload}>{contextText}</pre>
              <p className={styles.count}>{contextText.length} characters</p>
            </>
          ) : (
            <>
              <p className={styles.intro}>
                Model Desk is switched off, so nothing can be sent yet. You can point it at a model
                running on your own machine, or at a cloud provider using your own API key.
              </p>
              <p className={styles.intro}>
                If you choose a cloud provider, the text below would leave your computer and reach
                that provider under their terms. A model running locally sends nothing at all.
              </p>
              <pre className={styles.payload}>{contextText}</pre>
            </>
          )}

          <DisclaimerNote variant="block" />

          <div className={styles.actions}>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setOpen(false);
                // Handed over as router state rather than a shared store: feature slices may not
                // import each other, and the shape is a domain type both already know.
                void navigate('/desk', {
                  state: aiEnabled
                    ? {
                        context: [
                          { kind: 'glossary-term', label: term, text: contextText },
                        ] satisfies AiContextItem[],
                      }
                    : null,
                });
              }}
            >
              {aiEnabled ? 'Open Model Desk' : 'Set up a model'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
