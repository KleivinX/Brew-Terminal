import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Toggle } from '@/components/ui/Toggle';
import { MaskedSecretInput } from '@/components/ui/MaskedSecretInput';
import { StatusPill } from '@/components/status/StatusPill';
import { DisclaimerNote } from '@/components/status/DisclaimerNote';
import { ipc, IpcError, type AiTestResult } from '@/lib/ipc';
import { usePreferences, useSetPreference } from '@/lib/preferences';
import type { AiMode } from '@/types/domain';
import styles from './AiPanel.module.css';

export const aiStatusKey = ['ai-status'] as const;

/** Matches `providers::ai::CLOUD_PROVIDER_ID` — the id the key is stored under. */
const CLOUD_PROVIDER_ID = 'cloud-openai';

/**
 * Where the Model Desk gets configured.
 *
 * Three things here are deliberate rather than incidental.
 *
 * The reach label is rendered from whatever Rust resolved — the UI never decides for itself
 * whether an endpoint is "offline", because that claim is only true if the host actually
 * resolves to loopback.
 *
 * The enable switch is separate from the endpoint: saving an address does not start using it.
 *
 * And both providers are kept, so choosing cloud does not discard a local endpoint. What
 * changes is which one is active. See AI_POLICY.md §1.
 */
export function AiPanel() {
  const queryClient = useQueryClient();
  const { data: preferences } = usePreferences();
  const setPreference = useSetPreference();

  const { data: status } = useQuery({
    queryKey: aiStatusKey,
    queryFn: () => ipc('get_ai_status'),
    staleTime: 10_000,
  });

  /*
   * The fields are derived, not synchronised. `null` means "untouched, show what is stored";
   * anything else is what the user has typed. That avoids an effect copying the query result
   * into state — which would flash the wrong value on load and overwrite typing on a refetch —
   * and makes "reset the form" a matter of going back to null.
   */
  const [localEdit, setLocalEdit] = useState<{ endpoint?: string; model?: string }>({});
  const [cloudEdit, setCloudEdit] = useState<{ endpoint?: string; model?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<AiTestResult | null>(null);

  const localEndpoint = localEdit.endpoint ?? status?.local.endpoint ?? '';
  const localModel = localEdit.model ?? status?.local.model ?? '';
  const cloudEndpoint = cloudEdit.endpoint ?? status?.cloud.endpoint ?? '';
  const cloudModel = cloudEdit.model ?? status?.cloud.model ?? '';

  const mode: AiMode = preferences?.aiMode ?? 'local';
  const aiEnabled = preferences?.aiEnabled ?? false;
  const configured = status?.configured ?? false;

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: aiStatusKey });
    void queryClient.invalidateQueries({ queryKey: ['providers'] });
  };

  const resetForms = (): void => {
    setLocalEdit({});
    setCloudEdit({});
    setFormError(null);
    setTestResult(null);
  };

  const onSaveError = (error: unknown): void =>
    setFormError(error instanceof IpcError ? error.message : 'That address could not be saved.');

  const saveLocal = useMutation({
    mutationFn: () => ipc('save_ai_endpoint', { endpoint: localEndpoint, model: localModel }),
    onSuccess: () => {
      resetForms();
      refresh();
    },
    onError: onSaveError,
  });

  const saveCloud = useMutation({
    mutationFn: () => ipc('save_ai_cloud_endpoint', { endpoint: cloudEndpoint, model: cloudModel }),
    onSuccess: () => {
      resetForms();
      refresh();
    },
    onError: onSaveError,
  });

  const clear = useMutation({
    mutationFn: (which: AiMode) => ipc('clear_ai_endpoint', { mode: which }),
    onSuccess: () => {
      resetForms();
      refresh();
    },
  });

  const saveKey = useMutation({
    mutationFn: (apiKey: string) =>
      ipc('save_provider_credential', { providerId: CLOUD_PROVIDER_ID, apiKey }),
    onSuccess: refresh,
  });

  const removeKey = useMutation({
    mutationFn: () => ipc('delete_provider_credential', { providerId: CLOUD_PROVIDER_ID }),
    onSuccess: refresh,
  });

  const test = useMutation({
    mutationFn: () => ipc('test_ai_endpoint'),
    onSuccess: (result) => setTestResult(result),
    onError: (error: unknown) => {
      setTestResult({
        ok: false,
        message: error instanceof IpcError ? error.message : 'The endpoint could not be reached.',
        modelAvailable: null,
        reachLabel: status?.reachLabel ?? '',
      });
    },
  });

  return (
    <div className={styles.stack}>
      <Panel
        title="Which model the desk uses"
        actions={
          <StatusPill
            state={configured ? (status?.leavesDevice ? 'stale' : 'ready') : 'not-configured'}
            label={configured ? (status?.reachLabel ?? 'Configured') : 'Not configured'}
          />
        }
      >
        <div className={styles.body}>
          <div className={styles.modes} role="radiogroup" aria-label="Model provider">
            {(
              [
                {
                  value: 'local' as const,
                  name: 'A model on this computer',
                  detail: 'Nothing leaves the machine. No key, no account, no request off-device.',
                },
                {
                  value: 'cloud' as const,
                  name: 'A hosted model, with your key',
                  detail: 'Everything you send reaches that service under their terms, not ours.',
                },
              ] satisfies Array<{ value: AiMode; name: string; detail: string }>
            ).map((option) => {
              const selected = mode === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={[styles.mode, selected ? styles.modeSelected : null]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => setPreference.mutate({ key: 'aiMode', value: option.value })}
                >
                  <span className={styles.modeName}>{option.name}</span>
                  <span className={styles.modeDetail}>{option.detail}</span>
                </button>
              );
            })}
          </div>

          <p className={styles.help}>
            Both can be set up. Switching between them does not discard the other one.
          </p>
        </div>
      </Panel>

      {mode === 'local' ? (
        <Panel title="Local model">
          <div className={styles.body}>
            <p className={styles.intro}>
              Point Brew Terminal at an OpenAI-compatible server you run yourself — Ollama,
              llama.cpp&rsquo;s server, LM Studio, or anything else that speaks the same protocol.
              No model is bundled; this is an adapter, not an engine.
            </p>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="ai-endpoint">
                Endpoint address
              </label>
              <Input
                id="ai-endpoint"
                value={localEndpoint}
                placeholder="http://127.0.0.1:11434/v1"
                spellCheck={false}
                autoComplete="off"
                invalid={formError !== null}
                onChange={(event) => {
                  setLocalEdit((current) => ({ ...current, endpoint: event.target.value }));
                  setFormError(null);
                }}
              />
              <p className={styles.help}>
                The base address of the server. Brew Terminal appends the chat path itself, so both{' '}
                <span className="tabular">http://127.0.0.1:11434</span> and the same address with{' '}
                <span className="tabular">/v1</span> work.
              </p>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="ai-model">
                Model name
              </label>
              <Input
                id="ai-model"
                value={localModel}
                placeholder="llama3.1"
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => {
                  setLocalEdit((current) => ({ ...current, model: event.target.value }));
                  setFormError(null);
                }}
              />
              <p className={styles.help}>
                Exactly as the server names it. Test connection will tell you whether it has one by
                that name.
              </p>
            </div>

            {formError ? (
              <p className={styles.error} role="alert">
                {formError}
              </p>
            ) : null}

            <div className={styles.actions}>
              <Button
                variant="primary"
                size="sm"
                disabled={
                  saveLocal.isPending || localEndpoint.trim() === '' || localModel.trim() === ''
                }
                onClick={() => saveLocal.mutate()}
              >
                {saveLocal.isPending ? 'Saving…' : 'Save endpoint'}
              </Button>

              <Button
                variant="secondary"
                size="sm"
                disabled={!configured || !aiEnabled || test.isPending}
                onClick={() => test.mutate()}
              >
                {test.isPending ? 'Testing…' : 'Test connection'}
              </Button>

              {status?.local.configured ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={clear.isPending}
                  onClick={() => clear.mutate('local')}
                >
                  Remove
                </Button>
              ) : null}
            </div>

            {!aiEnabled && configured ? (
              <p className={styles.help}>
                Testing makes a real request, so it needs the Model Desk switched on below.
              </p>
            ) : null}

            {testResult ? (
              <p className={testResult.ok ? styles.testOk : styles.error} role="status">
                {testResult.message}
              </p>
            ) : null}
          </div>
        </Panel>
      ) : (
        <Panel title="Hosted model">
          <div className={styles.body}>
            <p className={styles.intro}>
              Any OpenAI-compatible service you already have an account with. Brew Terminal does not
              name a provider or recommend one — it has no way to verify how any of them handle what
              you send, so it does not imply that it can.
            </p>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="ai-cloud-endpoint">
                Endpoint address
              </label>
              <Input
                id="ai-cloud-endpoint"
                value={cloudEndpoint}
                placeholder="https://api.example.com/v1"
                spellCheck={false}
                autoComplete="off"
                invalid={formError !== null}
                onChange={(event) => {
                  setCloudEdit((current) => ({ ...current, endpoint: event.target.value }));
                  setFormError(null);
                }}
              />
              <p className={styles.help}>
                Must be <span className="tabular">https://</span>. A hosted endpoint carries your
                key, so there is no plaintext exception here.
              </p>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="ai-cloud-model">
                Model name
              </label>
              <Input
                id="ai-cloud-model"
                value={cloudModel}
                placeholder="the model id your provider uses"
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => {
                  setCloudEdit((current) => ({ ...current, model: event.target.value }));
                  setFormError(null);
                }}
              />
            </div>

            {formError ? (
              <p className={styles.error} role="alert">
                {formError}
              </p>
            ) : null}

            <div className={styles.actions}>
              <Button
                variant="primary"
                size="sm"
                disabled={
                  saveCloud.isPending || cloudEndpoint.trim() === '' || cloudModel.trim() === ''
                }
                onClick={() => saveCloud.mutate()}
              >
                {saveCloud.isPending ? 'Saving…' : 'Save endpoint'}
              </Button>

              <Button
                variant="secondary"
                size="sm"
                disabled={!configured || !aiEnabled || test.isPending}
                onClick={() => test.mutate()}
              >
                {test.isPending ? 'Testing…' : 'Test connection'}
              </Button>

              {status?.cloud.configured ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={clear.isPending}
                  onClick={() => clear.mutate('cloud')}
                >
                  Remove
                </Button>
              ) : null}
            </div>

            <MaskedSecretInput
              label="API key"
              storedHint={status?.cloud.hasCredential ? '••••  stored' : null}
              saving={saveKey.isPending}
              helpText="Stored in your operating system's credential store, never in the database and never in an export. Once saved it cannot be shown again — to change it, remove it and enter a new one."
              onSave={(apiKey) => saveKey.mutate(apiKey)}
              onRemove={() => removeKey.mutate()}
            />

            {status?.cloud.configured && !status.cloud.hasCredential ? (
              <p className={styles.help}>
                A hosted endpoint needs a key before it can be used. Without one, nothing is sent —
                the request would only transmit your question and come back rejected.
              </p>
            ) : null}

            {testResult ? (
              <p className={testResult.ok ? styles.testOk : styles.error} role="status">
                {testResult.message}
              </p>
            ) : null}
          </div>
        </Panel>
      )}

      <Panel title="Model Desk">
        <div className={styles.body}>
          <Toggle
            label="Use the Model Desk"
            description={
              configured
                ? 'Off by default. Nothing is sent to the model until you ask for it, even while this is on.'
                : mode === 'cloud'
                  ? 'Save an endpoint and a key above first.'
                  : 'Save an endpoint above first. With no endpoint there is nothing to talk to.'
            }
            checked={aiEnabled}
            disabled={!configured}
            onChange={(value) => setPreference.mutate({ key: 'aiEnabled', value })}
          />
        </div>
      </Panel>

      <Panel title="What this address means">
        <div className={styles.note}>
          <p>
            An address on <span className="tabular">127.0.0.1</span> or{' '}
            <span className="tabular">localhost</span> reaches a server on this computer, and
            nothing you send it leaves the machine. Brew Terminal shows{' '}
            <strong>Local &middot; offline</strong> only when the address actually resolves to this
            machine — not because it looks like it should.
          </p>
          <p>
            Any other address is a network request, labelled{' '}
            <strong>Local endpoint &middot; network</strong> or <strong>Cloud &middot; API</strong>,
            and must use <span className="tabular">https://</span>. Everything you send would leave
            this computer and reach whatever is at the other end.
          </p>
          <p>
            Whichever you use, nothing is sent without a direct action from you, you see exactly
            what would be transmitted first, and every send is recorded in the log on the Privacy
            page.
          </p>
          <DisclaimerNote variant="block" />
        </div>
      </Panel>
    </div>
  );
}
