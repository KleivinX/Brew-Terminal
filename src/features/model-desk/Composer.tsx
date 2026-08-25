import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ipc } from '@/lib/ipc';
import type { AiContextItem, AiSendPreview } from '@/types/domain';
import { detectAdviceShapedPrompt } from './guardrails';
import { SendConsentDialog } from './SendConsentDialog';
import { isFirstCloudSendOfSession, markCloudSend } from './session';
import styles from './Composer.module.css';

interface ComposerProps {
  conversationId: string | null;
  context: AiContextItem[];
  onRemoveContext: (index: number) => void;
  onSend: (prompt: string) => Promise<void>;
  sending: boolean;
  /** From `AiStatus`. Drives whether a send needs the consent step. */
  leavesDevice: boolean;
  reachLabel: string | null;
  disabled: boolean;
  /** From `AiStatus`. A hosted provider gets the session warning that AI_POLICY.md §2.3 asks for. */
  isCloud: boolean;
}

/** Long enough that a preview does not fire per keystroke, short enough to feel live. */
const PREVIEW_DEBOUNCE_MS = 400;

function useDebounced<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/**
 * The composer, and the two guardrail layers that sit around a send.
 *
 * Before: an advice-shaped question gets an inline note offering a reframing. The note never
 * edits the box — "Ask this instead" is a button the user presses, and the original text stays
 * exactly as typed if they ignore it. A guardrail that silently rewrites the question leaves
 * someone unable to tell what they actually asked. See AI_POLICY.md §5.1.
 *
 * The running "what this sends" line comes from Rust, not from counting characters here, so
 * what is shown is what goes out.
 */
export function Composer({
  conversationId,
  context,
  onRemoveContext,
  onSend,
  sending,
  leavesDevice,
  reachLabel,
  disabled,
  isCloud,
}: ComposerProps) {
  const [prompt, setPrompt] = useState('');
  const [consentOpen, setConsentOpen] = useState(false);
  const [dismissedNudge, setDismissedNudge] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const debouncedPrompt = useDebounced(prompt, PREVIEW_DEBOUNCE_MS);
  const trimmed = prompt.trim();

  const nudge = useMemo(
    () => (dismissedNudge ? null : detectAdviceShapedPrompt(prompt)),
    [prompt, dismissedNudge],
  );

  const { data: preview } = useQuery<AiSendPreview>({
    queryKey: ['ai-preview', conversationId, debouncedPrompt, context.length],
    queryFn: () => ipc('preview_ai_send', { conversationId, prompt: debouncedPrompt, context }),
    enabled: !disabled && debouncedPrompt.trim().length > 0,
    staleTime: 5_000,
    retry: false,
  });

  // A send that needs the itemised panel: something is attached, or the bytes leave the
  // machine. Otherwise the standing summary below the box is the disclosure, and Send is the
  // direct action. See SendConsentDialog for the reasoning.
  const needsConsent = context.length > 0 || leavesDevice;

  const submit = async (): Promise<void> => {
    if (trimmed === '' || sending || disabled) return;
    if (needsConsent) {
      setConsentOpen(true);
      return;
    }
    await deliver();
  };

  const deliver = async (): Promise<void> => {
    const text = prompt;
    if (isCloud) markCloudSend();
    await onSend(text);
    setPrompt('');
    setDismissedNudge(false);
    setConsentOpen(false);
    textareaRef.current?.focus();
  };

  return (
    <div className={styles.composer}>
      {context.length > 0 ? (
        <ul className={styles.attachments} role="list" aria-label="Attached to this message">
          {context.map((item, index) => (
            <li key={`${item.kind}-${index}`} className={styles.attachment}>
              <span className={styles.attachmentLabel}>{item.label}</span>
              <span className={styles.attachmentMeta}>{item.text.length} chars</span>
              <button
                type="button"
                className={styles.remove}
                onClick={() => onRemoveContext(index)}
                aria-label={`Remove ${item.label} from this message`}
              >
                <Icon name="close" size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {nudge ? (
        <div className={styles.nudge} role="note">
          <Icon name="info" size={14} />
          <div className={styles.nudgeBody}>
            <p>
              That reads as a question about what to do. The Model Desk will decline that part and
              answer the rest — you can send it exactly as written.
            </p>
            <p className={styles.reframing}>{nudge.reframing}</p>
            <div className={styles.nudgeActions}>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setPrompt(nudge.reframing);
                  setDismissedNudge(true);
                  textareaRef.current?.focus();
                }}
              >
                Ask this instead
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDismissedNudge(true)}>
                Keep mine
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className={styles.srOnly} htmlFor="model-desk-prompt">
          Your question
        </label>
        <textarea
          id="model-desk-prompt"
          ref={textareaRef}
          className={styles.input}
          rows={3}
          value={prompt}
          disabled={disabled || sending}
          placeholder="What does this term mean? How does this work?"
          onChange={(event) => {
            setPrompt(event.target.value);
            if (event.target.value.trim() === '') setDismissedNudge(false);
          }}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter is a newline — the convention people already have.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />

        <div className={styles.footer}>
          <p className={styles.summary}>
            {trimmed === '' ? (
              <>Each send includes the guardrail instructions and this conversation so far.</>
            ) : (
              <>
                Sends {preview ? `${preview.charCount} characters` : 'your question'} to{' '}
                {reachLabel ?? 'the configured model'} — the guardrail instructions, this
                conversation so far, and what you typed
                {context.length > 0 ? `, plus ${context.length} attached item(s)` : ''}.
              </>
            )}
          </p>

          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={trimmed === '' || sending || disabled}
          >
            {sending ? 'Sending…' : needsConsent ? 'Review and send' : 'Send'}
          </Button>
        </div>
      </form>

      <SendConsentDialog
        open={consentOpen}
        onClose={() => setConsentOpen(false)}
        onConfirm={() => void deliver()}
        prompt={prompt}
        context={context}
        preview={preview ?? null}
        sending={sending}
        leavesDevice={leavesDevice}
        reachLabel={reachLabel}
        firstCloudSend={isCloud && isFirstCloudSendOfSession()}
      />
    </div>
  );
}
