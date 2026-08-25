import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/status/EmptyState';
import { StatusPill } from '@/components/status/StatusPill';
import { DisclaimerNote } from '@/components/status/DisclaimerNote';
import { ipc, IpcError } from '@/lib/ipc';
import type { AiContextItem } from '@/types/domain';
import { Composer } from './Composer';
import { ConversationList } from './ConversationList';
import { MessageList } from './MessageList';
import styles from './ModelDeskRoute.module.css';

/** What another route may hand over when it sends the user here with something to ask about. */
interface DeskLocationState {
  context?: AiContextItem[];
}

/**
 * The Model Desk.
 *
 * Off until configured, and the not-configured state is the correct state rather than a
 * placeholder — Brew Terminal talks to no model until someone sets one up. See AI_POLICY.md §1.
 */
export function ModelDeskRoute() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  /*
   * Context handed over by another route — "Explain this" in Learn. Read once, in the state
   * initialiser, rather than copied in by an effect: the only producer lives on a different
   * route, so this component always mounts fresh when something is handed to it.
   */
  const [context, setContext] = useState<AiContextItem[]>(
    () => (location.state as DeskLocationState | null)?.context ?? [],
  );

  // Clears the history entry so going back and forward does not silently re-attach it. This
  // effect only navigates; the attachment above is already held in state.
  useEffect(() => {
    if ((location.state as DeskLocationState | null)?.context) {
      void navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.state, location.pathname, navigate]);

  const { data: status } = useQuery({
    queryKey: ['ai-status'],
    queryFn: () => ipc('get_ai_status'),
    staleTime: 10_000,
  });

  const { data: conversations } = useQuery({
    queryKey: ['ai-conversations'],
    queryFn: () => ipc('list_ai_conversations'),
    enabled: status?.configured === true,
    staleTime: 5_000,
  });

  const { data: messages } = useQuery({
    queryKey: ['ai-messages', conversationId],
    queryFn: () => ipc('get_ai_messages', { conversationId: conversationId as string }),
    enabled: conversationId !== null,
    staleTime: 5_000,
  });

  const send = useMutation({
    mutationFn: (prompt: string) => ipc('send_ai_message', { conversationId, prompt, context }),
    onSuccess: (result) => {
      setSendError(null);
      setContext([]);
      setConversationId(result.conversationId);
      void queryClient.invalidateQueries({ queryKey: ['ai-messages', result.conversationId] });
      void queryClient.invalidateQueries({ queryKey: ['ai-conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['ai-outbound-log'] });
    },
    onError: (error: unknown) => {
      setSendError(error instanceof IpcError ? error.message : 'The message could not be sent.');
    },
  });

  const removeConversation = useMutation({
    mutationFn: (id: string) => ipc('delete_ai_conversation', { conversationId: id }),
    onSuccess: (_result, id) => {
      if (id === conversationId) setConversationId(null);
      void queryClient.invalidateQueries({ queryKey: ['ai-conversations'] });
    },
  });

  const clearAll = useMutation({
    mutationFn: () => ipc('clear_ai_conversations'),
    onSuccess: () => {
      setConversationId(null);
      setConfirmClearAll(false);
      void queryClient.invalidateQueries({ queryKey: ['ai-conversations'] });
    },
  });

  const ready = (status?.configured ?? false) && (status?.enabled ?? false);

  return (
    <>
      <WorkspaceHeader
        title="Model Desk"
        subtitle="Optional. Off until you set it up."
        actions={
          <StatusPill
            state={ready ? (status?.leavesDevice ? 'stale' : 'ready') : 'not-configured'}
            label={ready ? (status?.reachLabel ?? 'Configured') : 'Not configured'}
          />
        }
      />

      {!ready ? <NotConfigured configured={status?.configured ?? false} /> : null}

      {ready ? (
        <div className={styles.workspace}>
          <aside className={styles.sidebar} aria-label="Conversations">
            <ConversationList
              conversations={conversations ?? []}
              selectedId={conversationId}
              onSelect={setConversationId}
              onDelete={(id) => removeConversation.mutate(id)}
              onClearAll={() => setConfirmClearAll(true)}
            />
          </aside>

          <section className={styles.main}>
            <div className={styles.transcript}>
              <MessageList messages={messages ?? []} pending={send.isPending} />
            </div>

            {sendError ? (
              <p className={styles.error} role="alert">
                {sendError}
              </p>
            ) : null}

            <Composer
              conversationId={conversationId}
              context={context}
              onRemoveContext={(index) =>
                setContext((current) => current.filter((_, i) => i !== index))
              }
              onSend={async (prompt) => {
                await send.mutateAsync(prompt).catch(() => undefined);
              }}
              sending={send.isPending}
              leavesDevice={status?.leavesDevice ?? false}
              reachLabel={status?.reachLabel ?? null}
              disabled={!ready}
              isCloud={status?.mode === 'cloud'}
            />

            <div className={styles.standingNote}>
              <DisclaimerNote variant="block" />
            </div>
          </section>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmClearAll}
        title="Delete all conversations?"
        message="Every transcript stored on this computer is removed. The record of what was sent stays on the Privacy page — deleting a conversation is not the same as erasing that."
        confirmLabel="Delete all"
        destructive
        onConfirm={() => clearAll.mutate()}
        onCancel={() => setConfirmClearAll(false)}
      />
    </>
  );
}

/**
 * Two distinct off states, because the fix differs: no endpoint at all, or an endpoint saved
 * with the desk still switched off.
 */
function NotConfigured({ configured }: { configured: boolean }) {
  const navigate = useNavigate();

  return (
    <div className={styles.body}>
      <Panel title={configured ? 'Model Desk is switched off' : 'No model configured'}>
        <EmptyState
          icon="desk"
          title={
            configured ? 'An endpoint is saved, but the desk is off' : 'Model Desk is switched off'
          }
          description={
            configured
              ? 'Your endpoint is stored and ready. Turn the Model Desk on in Settings when you want to use it — nothing is sent until you do.'
              : 'Brew Terminal does not talk to any model until you choose one. You can point it at a local model running on your own machine, or use a cloud provider with your own API key.'
          }
          action={
            <Button variant="primary" size="sm" onClick={() => void navigate('/settings/ai')}>
              {configured ? 'Open settings' : 'Set up a model'}
            </Button>
          }
        />
      </Panel>

      <Panel title="What this will and will not do">
        <div className={styles.policy}>
          <div>
            <h3 className={styles.policyHeading}>It can</h3>
            <ul className={styles.policyList}>
              <li>Define terms and explain how instruments work</li>
              <li>Describe historical and contextual information, with its limits</li>
              <li>Offer frameworks and questions you can research yourself</li>
              <li>Explain what a metric measures, and what it does not</li>
            </ul>
          </div>
          <div>
            <h3 className={styles.policyHeading}>It will not</h3>
            <ul className={styles.policyList}>
              <li>Tell you to buy, sell, hold or trade anything</li>
              <li>Suggest allocations, position sizes or timing</li>
              <li>Predict prices or claim certainty about outcomes</li>
              <li>Judge whether an asset is a good investment for you</li>
            </ul>
          </div>
        </div>
        <div className={styles.disclaimer}>
          <DisclaimerNote variant="block" />
        </div>
      </Panel>

      <Panel title="How far these limits go">
        <div className={styles.note}>
          <p>
            Those limits are applied as instructions to the model, plus checks on both sides of a
            send. They make advice-shaped answers less likely. They do not make any model safe.
          </p>
          <p>
            You choose the model, and your model may ignore its instructions. Brew Terminal shows
            you its answers unedited and flags language that looks like advice, so you can see when
            that happens rather than being told it cannot.
          </p>
        </div>
      </Panel>
    </div>
  );
}
