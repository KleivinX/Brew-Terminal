import { useQuery } from '@tanstack/react-query';
import { Panel } from '@/components/ui/Panel';
import { Toggle } from '@/components/ui/Toggle';
import { Icon } from '@/components/ui/Icon';
import { ipc } from '@/lib/ipc';
import { usePreferences, useSetPreference } from '@/lib/preferences';
import type { Region } from '@/types/domain';
import styles from './MarketsPanel.module.css';

/** Conservative floor and ceiling, matching the Rust-side validation. */
const REFRESH_OPTIONS = [
  { secs: 30, label: '30 seconds' },
  { secs: 60, label: '1 minute' },
  { secs: 300, label: '5 minutes' },
  { secs: 900, label: '15 minutes' },
] as const;

export function MarketsPanel() {
  const { data: preferences } = usePreferences();
  const setPreference = useSetPreference();

  const { data: providers } = useQuery({
    queryKey: ['providers'],
    queryFn: () => ipc('list_providers'),
    staleTime: 60_000,
  });

  /*
   * The union of every enabled market provider's regions, de-duplicated by id.
   *
   * Reading them from just the first provider would hide regions another one covers — with a
   * crypto provider listed first, its global-only coverage would erase the equity provider's
   * US region from the menu.
   */
  const regions = Array.from(
    (providers ?? [])
      .filter((p) => p.kind === 'market' && p.enabled)
      .flatMap((p) => p.supportedRegions)
      .reduce((byId, region) => byId.set(region.id, region), new Map<string, Region>())
      .values(),
  );
  const activeRegion = preferences?.region ?? 'global';

  return (
    <div className={styles.stack}>
      <Panel title="Region">
        <div className={styles.body}>
          <p className={styles.intro}>
            Sets which market the Stocks list discovers. Only regions the active data provider
            covers are listed here, so this grows as providers are added.
          </p>

          {regions.length === 0 ? (
            <p className={styles.empty}>No provider is configured, so there is nothing to pick.</p>
          ) : (
            <div className={styles.regions} role="radiogroup" aria-label="Region">
              {regions.map((region) => {
                const selected = region.id === activeRegion;
                return (
                  <button
                    key={region.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setPreference.mutate({ key: 'region', value: region.id })}
                    className={[styles.region, selected ? styles.regionSelected : null]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <span className={styles.regionName}>
                      {region.displayName}
                      {selected ? <Icon name="check" size={13} /> : null}
                    </span>
                    <span className={styles.regionDescription}>{region.description}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Refresh">
        <div className={styles.body}>
          <label className={styles.label} htmlFor="refresh-interval">
            How often visible data refreshes
          </label>
          <select
            id="refresh-interval"
            className={styles.select}
            value={preferences?.refreshIntervalSecs ?? 60}
            onChange={(event) =>
              setPreference.mutate({
                key: 'refreshIntervalSecs',
                value: Number(event.target.value),
              })
            }
          >
            {REFRESH_OPTIONS.map((option) => (
              <option key={option.secs} value={option.secs}>
                {option.label}
              </option>
            ))}
          </select>
          <p className={styles.hint}>
            Only data you can actually see is refreshed. A shorter interval uses more of a
            provider&rsquo;s request budget, which on a free tier can mean hitting its limit.
          </p>

          <Toggle
            label="Keep refreshing when the window is not focused"
            description="Refreshes are slowed to a quarter speed when Brew Terminal is in the background, and stop entirely after five minutes idle. Turning this off stops them immediately."
            checked={preferences?.refreshWhenUnfocused ?? true}
            onChange={(checked) =>
              setPreference.mutate({ key: 'refreshWhenUnfocused', value: checked })
            }
          />
        </div>
      </Panel>

      <Panel title="Currency">
        <div className={styles.body}>
          <p className={styles.intro}>
            Prices are shown in the currency each provider reports, which today means US dollars.
            Currency conversion is not built yet — showing a converted figure without a documented
            rate and timestamp would be a number this app cannot stand behind.
          </p>
        </div>
      </Panel>
    </div>
  );
}
