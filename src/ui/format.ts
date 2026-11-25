/** Formatting helpers for player-facing text (British English, £, metric). */
import { clockString, dayOfSeason, season, seasonOf, yearOf } from '../sim';

const money = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
});

export const formatMoney = (pounds: number): string => money.format(pounds);

/** e.g. "Spring 3, Year 1 · 07:30". */
export const formatGameTime = (minute: number): string =>
  `${season(seasonOf(minute)).name} ${dayOfSeason(minute)}, Year ${yearOf(minute)} · ${clockString(minute)}`;

export const formatMW = (mw: number): string =>
  mw >= 100 ? `${Math.round(mw)} MW` : mw >= 10 ? `${mw.toFixed(1)} MW` : `${mw.toFixed(2)} MW`;

export const formatInt = (n: number): string => Math.round(n).toLocaleString('en-GB');

export const formatRealDate = (iso: string): string =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
