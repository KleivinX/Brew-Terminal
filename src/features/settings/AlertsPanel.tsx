import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Toggle } from '@/components/ui/Toggle';
import { RelativeTime } from '@/components/status/RelativeTime';
import { EmptyState } from '@/components/status/EmptyState';
import { ipc } from '@/lib/ipc';
import { usePreferences, useSetPreference } from '@/lib/preferences';
import type { Alert, AlertKind } from '@/types/domain';
import styles from './AlertsPanel.module.css';

const KINDS: { id: AlertKind; label: string; unit: string }[] = [
  { id: 'price-above', label: 'Price rises to', unit: 'price' },
  { id: 'price-below', label: 'Price falls to', unit: 'price' },
  { id: 'change-above', label: '24h change rises to', unit: '%' },
  { id: 'change-below', label: '24h change falls to', unit: '%' },
];

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'That could not be saved.';
}

/**
 * Alerts, and the switch that permits them.
 *
 * The copy on that switch is the point of this screen as much as the alerts are: it is the one
 * place the app asks to make a request the user did not cause, so it says so plainly rather than
 * describing itself as "background updates".
 */
export function AlertsPanel() {
  const queryClient = useQueryClient();
  const { data: preferences } = usePreferences();
  const setPreference = useSetPreference();

  const [assetId, setAssetId] = useState('');
  const [symbol, setSymbol] = useState('');
  const [kind, setKind] = useState<AlertKind>('price-above');
  const [threshold, setThreshold] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const { data: alerts } = useQuery({
    queryKey: ['alerts'],
    queryFn: () => ipc('list_alerts'),
  });

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['alerts'] });
  };

  const create = useMutation({
    mutationFn: (alert: Alert) => ipc('create_alert', { alert }),
    onSuccess: () => {
      setAssetId('');
      setSymbol('');
      setThreshold('');
      setFormError(null);
      refresh();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => ipc('delete_alert', { id }),
    onSuccess: refresh,
  });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      ipc('set_alert_enabled', { id, enabled }),
    onSuccess: refresh,
  });
  const rearm = useMutation({
    mutationFn: (id: string) => ipc('rearm_alert', { id }),
    onSuccess: refresh,
  });
  const checkNow = useMutation({
    mutationFn: () => ipc('check_alerts'),
    onSuccess: refresh,
  });

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    setFormError(null);

    const value = Number(threshold);
    if (!Number.isFinite(value)) {
      setFormError('That threshold is not a number.');
      return;
    }

    create.mutate({
      id: '',
      assetId: assetId.trim(),
      symbol: symbol.trim() || assetId.trim().split(':').pop() || assetId.trim(),
      kind,
      threshold: value,
      enabled: true,
      note: null,
      createdAt: 0,
      triggeredAt: null,
      triggeredValue: null,
    });
  };

  const rows: Alert[] = alerts ?? [];
  const armed = rows.filter((a) => a.triggeredAt === null);
  const fired = rows.filter((a) => a.triggeredAt !== null);
  const enabled = preferences?.alertsEnabled ?? false;

  return (
    <div className={styles.stack}>
      <Panel title="Background checking">
        <div className={styles.body}>
          <p className={styles.notice}>
            Everywhere else, Brew Terminal only makes a request because you did something. Alerts
            cannot work that way — the whole point is being told about a price while you are not
            looking. Turning this on means the app will check the assets you have alerts on, on its
            own, about every two minutes.
          </p>

          <Toggle
            label="Let Brew Terminal check prices in the background"
            description="Only assets with an armed alert are fetched, in one request. With no armed alerts, nothing is requested at all."
            checked={enabled}
            onChange={(value) => setPreference.mutate({ key: 'alertsEnabled', value })}
          />

          {enabled ? (
            <p className={styles.hint}>
              A fired alert appears in the app, and as a system notification so it reaches you when
              the window is not in front. Your operating system will ask once whether to allow
              those; declining leaves everything else working, and fired alerts still appear here.
            </p>
          ) : null}

          {enabled && armed.length === 0 ? (
            <p className={styles.hint}>
              Nothing is being checked yet — add an alert below and it starts then.
            </p>
          ) : null}

          {enabled && armed.length > 0 ? (
            <Button
              variant="secondary"
              onClick={() => checkNow.mutate()}
              disabled={checkNow.isPending}
            >
              {checkNow.isPending ? 'Checking…' : 'Check now'}
            </Button>
          ) : null}
        </div>
      </Panel>

      {fired.length > 0 ? (
        <Panel
          title={`Triggered (${fired.length})`}
          meta="Each fires once, then waits to be re-armed."
        >
          <ul role="list" className={styles.list}>
            {fired.map((alert) => (
              <li key={alert.id} className={styles.alert}>
                <div className={styles.alertMain}>
                  <span className={styles.symbol}>{alert.symbol}</span>
                  <span className={styles.detail}>
                    {describe(alert)}
                    {alert.triggeredValue !== null ? <> — reached {alert.triggeredValue}</> : null}
                  </span>
                  {alert.triggeredAt !== null ? (
                    <span className={styles.when}>
                      <RelativeTime epochSeconds={alert.triggeredAt} />
                    </span>
                  ) : null}
                </div>
                <div className={styles.actions}>
                  <Button variant="secondary" size="sm" onClick={() => rearm.mutate(alert.id)}>
                    Re-arm
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => remove.mutate(alert.id)}
                    aria-label={`Delete alert on ${alert.symbol}`}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel title={`Watching (${armed.length})`}>
        {armed.length === 0 ? (
          <EmptyState
            icon="info"
            title="No alerts yet"
            description="An alert watches one asset for one condition, fires once, and then waits until you re-arm it."
          />
        ) : (
          <ul role="list" className={styles.list}>
            {armed.map((alert) => (
              <li key={alert.id} className={styles.alert}>
                <div className={styles.alertMain}>
                  <span className={styles.symbol}>{alert.symbol}</span>
                  <span className={styles.detail}>{describe(alert)}</span>
                </div>
                <div className={styles.actions}>
                  <Toggle
                    checked={alert.enabled}
                    onChange={(value) => toggle.mutate({ id: alert.id, enabled: value })}
                    label={`Watch ${alert.symbol}`}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => remove.mutate(alert.id)}
                    aria-label={`Delete alert on ${alert.symbol}`}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Add an alert">
        <form className={styles.form} onSubmit={onSubmit}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="alert-asset">
              Asset id
            </label>
            <Input
              id="alert-asset"
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
              placeholder="crypto:cg:bitcoin"
              spellCheck={false}
              autoComplete="off"
              required
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="alert-symbol">
              Label (optional)
            </label>
            <Input
              id="alert-symbol"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="BTC"
              spellCheck={false}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="alert-kind">
              Condition
            </label>
            <select
              id="alert-kind"
              className={styles.select}
              value={kind}
              onChange={(e) => setKind(e.target.value as AlertKind)}
            >
              {KINDS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="alert-threshold">
              Threshold {KINDS.find((k) => k.id === kind)?.unit === '%' ? '(%)' : ''}
            </label>
            <Input
              id="alert-threshold"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              inputMode="decimal"
              placeholder={kind.startsWith('change') ? '-5' : '70000'}
              required
            />
          </div>

          {formError ? (
            <p className={styles.formError} role="alert">
              {formError}
            </p>
          ) : null}

          <div className={styles.formActions}>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Adding…' : 'Add alert'}
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}

function describe(alert: Alert): string {
  const kind = KINDS.find((k) => k.id === alert.kind);
  const unit = kind?.unit === '%' ? '%' : '';
  return `${kind?.label ?? alert.kind} ${alert.threshold}${unit}`;
}
