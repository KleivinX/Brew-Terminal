import { CHART_RANGE_DESCRIPTIONS, CHART_RANGE_LABELS } from '@/lib/market';
import type { ChartRange } from '@/types/domain';
import styles from './RangeSelector.module.css';

interface RangeSelectorProps {
  ranges: ChartRange[];
  value: ChartRange;
  onChange: (range: ChartRange) => void;
}

/**
 * Chart range buttons.
 *
 * Rendered from the provider's declared capabilities, so an unsupported range is absent
 * rather than present-and-broken — the acceptance criterion is "hidden, not broken".
 */
export function RangeSelector({ ranges, value, onChange }: RangeSelectorProps) {
  if (ranges.length === 0) return null;

  return (
    <div className={styles.group} role="group" aria-label="Chart range">
      {ranges.map((range) => {
        const selected = range === value;
        return (
          <button
            key={range}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(range)}
            className={[styles.range, selected ? styles.selected : null].filter(Boolean).join(' ')}
          >
            <span aria-hidden="true">{CHART_RANGE_LABELS[range]}</span>
            <span className="visually-hidden">{CHART_RANGE_DESCRIPTIONS[range]}</span>
          </button>
        );
      })}
    </div>
  );
}
