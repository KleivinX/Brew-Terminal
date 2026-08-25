import { useQueryClient } from '@tanstack/react-query';
import { ipc, type MockBehavior } from '@/lib/ipc';
import { useUiStore } from '@/stores/uiStore';
import styles from './MockControlPanel.module.css';

const BEHAVIORS: { id: MockBehavior; label: string; description: string }[] = [
  { id: 'normal', label: 'Normal', description: 'Fresh fixture data.' },
  { id: 'slow', label: 'Slow', description: '2.5s latency — exercises skeletons.' },
  { id: 'empty', label: 'Empty', description: 'Provider returns no rows.' },
  { id: 'stale', label: 'Stale', description: 'Cached data past its TTL.' },
  { id: 'rate-limited', label: 'Rate limited', description: 'Cached data plus a retry window.' },
  { id: 'error', label: 'Provider error', description: 'Refresh failed, last values shown.' },
  { id: 'not-configured', label: 'Not configured', description: 'No provider set up.' },
];

/**
 * Dev-only. Forces the mock provider into each failure mode so every UI state is reachable
 * without a network connection — this is what makes the Phase 1 state coverage testable.
 * Rendered only when `isDev()`; it is not part of a release build's UI.
 */
export function MockControlPanel() {
  const queryClient = useQueryClient();
  const behavior = useUiStore((s) => s.mockBehavior);
  const setBehavior = useUiStore((s) => s.setMockBehavior);

  const apply = async (next: MockBehavior): Promise<void> => {
    setBehavior(next);
    await ipc('set_mock_behavior', { behavior: next });
    await queryClient.invalidateQueries();
  };

  return (
    <div className={styles.panel}>
      <span className={styles.label}>Mock provider state</span>
      <div className={styles.buttons}>
        {BEHAVIORS.map((item) => (
          <button
            key={item.id}
            type="button"
            title={item.description}
            aria-pressed={behavior === item.id}
            className={[styles.button, behavior === item.id ? styles.active : null]
              .filter(Boolean)
              .join(' ')}
            onClick={() => void apply(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
