import { useNavigate } from 'react-router-dom';
import { Toggle } from '@/components/ui/Toggle';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ProviderBadge } from '@/components/status/ProviderBadge';
import type { LayerStatus, SentryLayer } from '@/types/domain';
import styles from './LayerSidebar.module.css';

/**
 * The layer manager.
 *
 * A toggle per layer, and under it everything the reader needs to judge what they are looking
 * at: which service answered, how old it is, why it did not answer, and where the layer's
 * coverage stops. That last one is the reason this panel is as wordy as it is — a map with no
 * markers over Europe means something entirely different depending on whether the weather feed
 * is American, unreachable, or simply quiet, and only one of those three is visible from the
 * map itself.
 *
 * Switching a layer off disables its source as well as hiding it, so an unwanted layer stops
 * costing requests rather than merely stopping being drawn.
 */

interface LayerSidebarProps {
  layers: LayerStatus[];
  visible: Set<SentryLayer>;
  onToggle: (layer: SentryLayer, next: boolean) => void;
  busy: SentryLayer | null;
}

export function LayerSidebar({ layers, visible, onToggle, busy }: LayerSidebarProps) {
  const navigate = useNavigate();

  return (
    <ul role="list" className={styles.list}>
      {layers.map((status) => {
        const on = visible.has(status.layer);
        const degraded = status.meta?.degraded ?? null;

        return (
          <li key={status.layer} className={styles.row} data-on={on ? 'true' : undefined}>
            <div className={styles.head}>
              <Toggle
                label={status.label}
                checked={on}
                disabled={busy === status.layer}
                onChange={(next) => onToggle(status.layer, next)}
              />
              {status.count > 0 ? (
                <span className={styles.count} aria-label={`${status.count} on the map`}>
                  {status.count}
                </span>
              ) : null}
            </div>

            <p className={styles.description}>{status.description}</p>

            {/*
              A layer needing a credential is not an error and is not shown as one. It is a
              thing the reader can act on, so it gets a route to the place they act on it.
            */}
            {status.needsCredential ? (
              <p className={styles.needsKey}>
                <Icon name="info" size={12} /> Needs your own key.{' '}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void navigate('/settings/providers')}
                >
                  Add one
                </Button>
              </p>
            ) : null}

            {degraded ? (
              <p className={styles.degraded}>
                <Icon name="warning" size={12} /> {degraded.message}
              </p>
            ) : null}

            {status.meta && !degraded ? (
              <p className={styles.meta}>
                <ProviderBadge meta={status.meta} />
              </p>
            ) : null}

            {status.coverageNote ? <p className={styles.coverage}>{status.coverageNote}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}
