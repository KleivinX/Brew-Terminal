import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Toggle } from '@/components/ui/Toggle';
import { MaskedSecretInput } from '@/components/ui/MaskedSecretInput';
import { StatusPill } from '@/components/status/StatusPill';
import { ipc, type ProviderTestResult } from '@/lib/ipc';
import type { ProviderHealth, ProviderInfo, ProviderKind } from '@/types/domain';
import type { PanelState } from '@/types/envelope';
import styles from './ProvidersPanel.module.css';

const HEALTH_STATE: Record<ProviderHealth, PanelState> = {
  ok: 'ready',
  'not-configured': 'not-configured',
  'rate-limited': 'rate-limited',
  error: 'error',
  disabled: 'empty',
};

const HEALTH_LABEL: Record<ProviderHealth, string> = {
  ok: 'Connected',
  'not-configured': 'Needs a key',
  'rate-limited': 'Rate limited',
  error: 'Error',
  disabled: 'Off',
};

/** What a key is for, and where to get one. Keyed by provider id. */
const KEY_HELP: Record<string, string> = {
  coingecko:
    'Optional. Without a key CoinGecko still works, at a lower and less predictable request limit. A free Demo key raises it to 100 requests a minute.',
  finnhub:
    'Required. Finnhub needs a key for every request, including prices. The free plan allows 60 requests a minute.',
};

interface ProvidersPanelProps {
  kind?: ProviderKind;
}

export function ProvidersPanel({ kind = 'market' }: ProvidersPanelProps) {
  const queryClient = useQueryClient();
  const [testResults, setTestResults] = useState<Record<string, ProviderTestResult>>({});

  const { data: providers } = useQuery({
    queryKey: ['providers'],
    queryFn: () => ipc('list_providers'),
    staleTime: 30_000,
  });

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['providers'] });
    // Provider changes alter what every market panel can show.
    void queryClient.invalidateQueries({ queryKey: ['market-list'] });
    void queryClient.invalidateQueries({ queryKey: ['quotes'] });
  };

  const setEnabled = useMutation({
    mutationFn: ({ providerId, enabled }: { providerId: string; enabled: boolean }) =>
      ipc('set_provider_enabled', { providerId, enabled }),
    onSuccess: refresh,
  });

  const saveKey = useMutation({
    mutationFn: ({ providerId, apiKey }: { providerId: string; apiKey: string }) =>
      ipc('save_provider_credential', { providerId, apiKey }),
    onSuccess: refresh,
  });

  const removeKey = useMutation({
    mutationFn: (providerId: string) => ipc('delete_provider_credential', { providerId }),
    onSuccess: refresh,
  });

  const testProvider = useMutation({
    mutationFn: (providerId: string) => ipc('test_provider', { providerId }),
    onSuccess: (result, providerId) => {
      setTestResults((current) => ({ ...current, [providerId]: result }));
      refresh();
    },
  });

  const filtered = (providers ?? []).filter((p) => p.kind === kind);

  return (
    <div className={styles.stack}>
      {filtered.map((provider: ProviderInfo) => {
        const testResult = testResults[provider.id];
        const help = KEY_HELP[provider.id];

        return (
          <Panel
            key={provider.id}
            title={provider.displayName}
            actions={
              <StatusPill
                state={HEALTH_STATE[provider.health]}
                label={HEALTH_LABEL[provider.health]}
              />
            }
          >
            <div className={styles.body}>
              <p className={styles.attribution}>{provider.attribution}</p>

              <Toggle
                label="Use this provider"
                description={
                  provider.requiresCredential && !provider.hasCredential
                    ? 'This provider needs an API key before it can be turned on.'
                    : 'Turning a provider off leaves its data out of every panel.'
                }
                checked={provider.enabled}
                disabled={provider.requiresCredential && !provider.hasCredential}
                onChange={(enabled) => setEnabled.mutate({ providerId: provider.id, enabled })}
              />

              {provider.id !== 'mock' ? (
                <MaskedSecretInput
                  label="API key"
                  storedHint={provider.hasCredential ? '••••  stored' : null}
                  saving={saveKey.isPending}
                  {...(help ? { helpText: help } : {})}
                  onSave={(apiKey) => saveKey.mutate({ providerId: provider.id, apiKey })}
                  onRemove={() => removeKey.mutate(provider.id)}
                />
              ) : null}

              <div className={styles.actions}>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!provider.enabled || testProvider.isPending}
                  onClick={() => testProvider.mutate(provider.id)}
                >
                  {testProvider.isPending ? 'Testing…' : 'Test connection'}
                </Button>

                {provider.docsUrl ? (
                  <a
                    className={styles.docsLink}
                    href={provider.docsUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Provider documentation
                  </a>
                ) : null}
              </div>

              {testResult ? (
                <p className={testResult.ok ? styles.testOk : styles.testFailed} role="status">
                  {testResult.message}
                </p>
              ) : null}

              {provider.supportedAssetTypes.length > 0 ? (
                <p className={styles.covers}>
                  Covers: {provider.supportedAssetTypes.join(', ')}
                  {provider.supportedRegions.length > 0
                    ? ` · ${provider.supportedRegions.map((r) => r.displayName).join(', ')}`
                    : ''}
                </p>
              ) : null}
            </div>
          </Panel>
        );
      })}

      <Panel title="How keys are stored">
        <div className={styles.note}>
          <p>
            API keys go straight into your operating system&rsquo;s credential store — Keychain on
            macOS, Credential Manager on Windows, Secret Service on Linux. They are never written to
            the database, never written to a log, and never included in an export.
          </p>
          <p>
            Once saved, a key cannot be shown again. The app can only ever check whether one exists;
            to change a key you remove it and enter a new one.
          </p>
        </div>
      </Panel>
    </div>
  );
}
