import { formatPrice } from '@/lib/format';
import styles from './PriceValue.module.css';

interface PriceValueProps {
  value: number;
  currency?: string | undefined;
  className?: string | undefined;
}

export function PriceValue({ value, currency = 'USD', className }: PriceValueProps) {
  return (
    <span className={[styles.price, 'tabular', className].filter(Boolean).join(' ')}>
      {formatPrice(value, currency)}
    </span>
  );
}
