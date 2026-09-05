import { Icon } from '@/components/ui/Icon';
import { RelativeTime } from '@/components/status/RelativeTime';
import type { Proximity } from '@/types/domain';
import styles from './WatchList.module.css';

/**
 * Hazards near a chokepoint or port.
 *
 * The only place in Sentry where two sources are put together, so it is also the only place
 * that could imply something neither of them said. It states a distance and stops there.
 *
 * The note above the list is not boilerplate. "A magnitude 6.1 earthquake 140 km from the Port
 * of Kaohsiung" invites a conclusion about shipping, and the app has no basis for one — no
 * model of port resilience, no berth status, nothing. Saying so in the panel is cheaper than
 * letting the layout imply otherwise. See ADR-022 and ADR-035.
 */

interface WatchListProps {
  proximities: Proximity[];
  onSelect: (markerId: string) => void;
  selectedId: string | null;
}

export function WatchList({ proximities, onSelect, selectedId }: WatchListProps) {
  if (proximities.length === 0) {
    return (
      <p className={styles.quiet}>
        Nothing active is within 500 km of a tracked strait, canal or port. This is the usual state
        — the list stays empty most days, which is what makes it worth reading when it is not.
      </p>
    );
  }

  return (
    <>
      <p className={styles.caveat}>
        Distance only. Whether any of this affects a route is not something this app can tell you,
        and it does not try.
      </p>

      <ul role="list" className={styles.list}>
        {proximities.map((entry) => (
          <li key={`${entry.markerId}:${entry.chokepointId}`}>
            <button
              type="button"
              className={styles.row}
              data-severity={entry.severity}
              data-selected={entry.markerId === selectedId ? 'true' : undefined}
              onClick={() => onSelect(entry.markerId)}
            >
              {/*
                Severity on three channels — glyph, colour and the word itself in the
                accessible label — because a coloured left border alone says nothing to a
                screen reader and little to a reader who cannot separate the hues.
              */}
              <span className={styles.glyph} aria-hidden="true">
                <Icon name={entry.severity === 'severe' ? 'warning' : 'info'} size={12} />
              </span>

              <span className={styles.body}>
                <span className={styles.hazard}>{entry.hazardLabel}</span>
                <span className={styles.detail}>
                  {Math.round(entry.distanceKm)} km from {entry.chokepointName}
                </span>
                {entry.observedAt !== null ? (
                  <span className={styles.age}>
                    <RelativeTime epochSeconds={entry.observedAt} />
                  </span>
                ) : null}
              </span>

              <span className="visually-hidden">
                {entry.severity === 'severe' ? 'Severe. ' : ''}
                Show on the map.
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
