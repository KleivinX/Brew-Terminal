import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { RelativeTime } from '@/components/status/RelativeTime';
import type { MapMarker, SentryLayer } from '@/types/domain';
import styles from './InspectorHud.module.css';

/**
 * The target inspector, and the keyboard path onto the map.
 *
 * Two jobs in one panel, and the second is the important one. The map itself is `role="img"`
 * with unfocusable shapes inside it — several hundred focusable SVG nodes is a poor experience
 * and WKWebView's support for interactive SVG children is uneven. So every marker also appears
 * in the list below as a real button. That is not a hidden alternative for screen readers; it
 * is the visible list everyone uses, and it means nothing on this screen is reachable by
 * pointer but not by keyboard.
 */

const LAYER_LABEL: Record<SentryLayer, string> = {
  seismic: 'Earthquake',
  weather: 'Weather warning',
  economy: 'Economy',
  rates: 'Exchange rate',
  chokepoints: 'Chokepoint',
  flights: 'Freight aircraft',
};

const SEVERITY_LABEL = {
  severe: 'Severe',
  notable: 'Notable',
  info: 'Reference',
} as const;

interface InspectorHudProps {
  markers: MapMarker[];
  selectedId: string | null;
  onSelect: (markerId: string | null) => void;
  visible: Set<SentryLayer>;
}

export function InspectorHud({ markers, selectedId, onSelect, visible }: InspectorHudProps) {
  const [filter, setFilter] = useState('');

  const selected = useMemo(
    () => markers.find((marker) => marker.id === selectedId) ?? null,
    [markers, selectedId],
  );

  const listed = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return markers
      .filter((marker) => visible.has(marker.layer))
      .filter(
        (marker) =>
          needle === '' ||
          marker.label.toLowerCase().includes(needle) ||
          marker.summary.toLowerCase().includes(needle),
      );
  }, [markers, visible, filter]);

  return (
    <div className={styles.wrap}>
      {selected ? (
        <section className={styles.detail} aria-label="Selected marker">
          <header className={styles.detailHead}>
            <div>
              <p className={styles.kind}>
                {LAYER_LABEL[selected.layer]}
                {selected.severity !== 'info' ? (
                  <span className={styles.severity} data-severity={selected.severity}>
                    {SEVERITY_LABEL[selected.severity]}
                  </span>
                ) : null}
              </p>
              <h3 className={styles.title}>{selected.label}</h3>
            </div>
            <Button size="sm" variant="ghost" onClick={() => onSelect(null)}>
              Clear
            </Button>
          </header>

          <p className={styles.summary}>{selected.summary}</p>

          <dl className={styles.facts}>
            {selected.facts.map((fact) => (
              <div key={fact.label} className={styles.fact}>
                <dt className={styles.factLabel}>{fact.label}</dt>
                <dd className={styles.factValue}>{fact.value}</dd>
              </div>
            ))}
            <div className={styles.fact}>
              <dt className={styles.factLabel}>Position</dt>
              <dd className={styles.factValue}>{formatPosition(selected.lat, selected.lon)}</dd>
            </div>
            {selected.observedAt !== null ? (
              <div className={styles.fact}>
                <dt className={styles.factLabel}>Observed</dt>
                <dd className={styles.factValue}>
                  <RelativeTime epochSeconds={selected.observedAt} />
                </dd>
              </div>
            ) : null}
          </dl>

          {/*
            A plain link. The Tauri opener plugin sends it to the system browser rather than
            letting an untrusted URL navigate the webview — same path as every other outbound
            link in the app. See NewsPanel.
          */}
          {selected.sourceUrl ? (
            <a
              className={styles.source}
              href={selected.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              <Icon name="external" size={12} /> Check it at the source
            </a>
          ) : null}
        </section>
      ) : (
        <p className={styles.hint}>
          Pick anything on the map, or from the list below, to see what is behind it.
        </p>
      )}

      <section className={styles.listSection} aria-label="Everything on the map">
        <div className={styles.filterRow}>
          <label className="visually-hidden" htmlFor="sentry-marker-filter">
            Filter what is on the map
          </label>
          <input
            id="sentry-marker-filter"
            type="search"
            className={styles.filter}
            placeholder="Filter the map"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <span className={styles.listCount}>{listed.length}</span>
        </div>

        {listed.length === 0 ? (
          <p className={styles.hint}>
            {filter.trim() === ''
              ? 'No layers are switched on.'
              : 'Nothing on the map matches that.'}
          </p>
        ) : (
          <ul role="list" className={styles.list}>
            {listed.map((marker) => (
              <li key={marker.id}>
                <button
                  type="button"
                  className={styles.listRow}
                  data-severity={marker.severity}
                  data-selected={marker.id === selectedId ? 'true' : undefined}
                  onClick={() => onSelect(marker.id)}
                >
                  <span className={styles.listLabel}>{marker.label}</span>
                  <span className={styles.listKind}>{LAYER_LABEL[marker.layer]}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Degrees with a hemisphere letter rather than a sign.
 *
 * `-19.914` is unambiguous to a machine and slower to read than `19.914° S`, and this is a
 * readout a person is meant to check against another map.
 */
export function formatPosition(lat: number, lon: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(3)}° ${ns}, ${Math.abs(lon).toFixed(3)}° ${ew}`;
}
