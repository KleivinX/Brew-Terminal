import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { DisclaimerNote } from '@/components/status/DisclaimerNote';
import type { AiContextItem, AiSendPreview } from '@/types/domain';
import styles from './SendConsentDialog.module.css';

interface SendConsentDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  prompt: string;
  context: AiContextItem[];
  preview: AiSendPreview | null;
  sending: boolean;
  /**
   * Whether this send leaves the machine, taken from `AiStatus` rather than from `preview`.
   *
   * The preview arrives asynchronously, and reading egress from it meant that for the moment
   * before it landed this panel told the user their text stayed on the computer — while the
   * configured endpoint was a remote one. A disclosure that is briefly wrong in the reassuring
   * direction is worse than no disclosure, so it comes from state that is already known.
   */
  leavesDevice: boolean;
  reachLabel: string | null;
  /** Whether this is the first send of the session that reaches a hosted provider. */
  firstCloudSend: boolean;
}

/**
 * The pre-send panel required by AI_POLICY.md §2.2.
 *
 * Two rules shape it. Every attached item is listed **individually** with its own character
 * count — a single total would let something the user forgot they attached travel unnoticed.
 * And the counts come from `preview_ai_send`, which Rust computes from the same assembly the
 * send itself uses, so the number here is the number of characters that actually go out rather
 * than a frontend estimate that can drift.
 *
 * It opens when there is attached context, or when the endpoint is one that leaves the machine.
 * A loopback endpoint with nothing attached does not get a modal on every message — the
 * composer states permanently what each send contains, and pressing Send is the direct action
 * §2.1 asks for. A dialog on every keystroke-length question would train people to dismiss it.
 */
export function SendConsentDialog({
  open,
  onClose,
  onConfirm,
  prompt,
  context,
  preview,
  sending,
  leavesDevice,
  reachLabel,
  firstCloudSend,
}: SendConsentDialogProps) {
  const leaves = leavesDevice;

  return (
    <Modal open={open} onClose={onClose} title="Before this is sent" size="md">
      <div className={styles.body}>
        {firstCloudSend ? (
          <div className={styles.firstSend} role="note">
            <p className={styles.firstSendTitle}>First send to a hosted model this session</p>
            <p>
              What goes out is listed below in full: your question, anything you attached, the
              guardrail instructions, and this conversation so far. Your API key authenticates the
              request. Nothing else from Brew Terminal is included, and this warning appears again
              the next time you open the app.
            </p>
          </div>
        ) : null}

        <p className={styles.lede}>
          {leaves ? (
            <>
              This leaves your computer and reaches{' '}
              <strong>{reachLabel ?? 'the configured endpoint'}</strong>, under whatever terms apply
              there. Brew Terminal cannot recall it.
            </>
          ) : (
            <>This goes to the model running on this computer. It does not leave the machine.</>
          )}
        </p>

        <section className={styles.section}>
          <h3 className={styles.heading}>Your question</h3>
          <pre className={styles.payload}>{prompt}</pre>
          <p className={styles.count}>{preview?.promptChars ?? prompt.length} characters</p>
        </section>

        {context.length > 0 ? (
          <section className={styles.section}>
            <h3 className={styles.heading}>Attached, and going with it</h3>
            <ul className={styles.items} role="list">
              {context.map((item, index) => (
                <li key={`${item.kind}-${index}`} className={styles.item}>
                  <div className={styles.itemHead}>
                    <span className={styles.itemLabel}>{item.label}</span>
                    <span className={styles.itemMeta}>
                      {item.kind} · {item.text.length} characters
                    </span>
                  </div>
                  <pre className={styles.payload}>{item.text}</pre>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p className={styles.none}>
            Nothing else from Brew Terminal is attached — no watchlist, no notes, no browsing.
          </p>
        )}

        <section className={styles.section}>
          <h3 className={styles.heading}>Also included</h3>
          <ul className={styles.plain} role="list">
            <li>
              The guardrail instructions, {preview?.systemPromptChars ?? 0} characters — the same
              text on every request.
            </li>
            {(preview?.historyChars ?? 0) > 0 ? (
              <li>
                Earlier turns in this conversation, {preview?.historyChars ?? 0} characters, so the
                model can follow on.
              </li>
            ) : null}
          </ul>
          <p className={styles.total}>
            {preview ? `${preview.charCount} characters in total` : 'Working out the total…'}
          </p>
        </section>

        <DisclaimerNote variant="block" />

        <div className={styles.actions}>
          <Button variant="ghost" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onConfirm} disabled={sending || preview === null}>
            {sending ? 'Sending…' : leaves ? 'Send off this computer' : 'Send'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
