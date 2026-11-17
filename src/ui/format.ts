/** Formatting helpers for player-facing text (British English, £, metric). */
import { clockString, dayOf } from '../sim';

const money = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
});

export const formatMoney = (pounds: number): string => money.format(pounds);

export const formatGameTime = (minute: number): string =>
  `Day ${dayOf(minute)}, ${clockString(minute)}`;

export const formatRealDate = (iso: string): string =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
