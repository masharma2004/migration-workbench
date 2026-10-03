import { z } from 'zod';
import { asText, defineRule, fail, ok } from './define';

export const DATE_FORMATS = ['YYYY-MM-DD', 'YYYY/MM/DD', 'MM/DD/YYYY', 'DD/MM/YYYY', 'DD-MMM-YYYY'] as const;
type DateFormat = (typeof DATE_FORMATS)[number];
interface DateParts { y: number; m: number; d: number }

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const PARSERS: Record<DateFormat, (text: string) => DateParts | null> = {
  'YYYY-MM-DD': (t) => {
    const r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
    return r ? { y: +r[1], m: +r[2], d: +r[3] } : null;
  },
  'YYYY/MM/DD': (t) => {
    const r = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(t);
    return r ? { y: +r[1], m: +r[2], d: +r[3] } : null;
  },
  'MM/DD/YYYY': (t) => {
    const r = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
    return r ? { y: +r[3], m: +r[1], d: +r[2] } : null;
  },
  'DD/MM/YYYY': (t) => {
    const r = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
    return r ? { y: +r[3], m: +r[2], d: +r[1] } : null;
  },
  'DD-MMM-YYYY': (t) => {
    const r = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(t);
    if (!r) return null;
    const m = MONTHS.indexOf(r[2].toLowerCase()) + 1;
    return m > 0 ? { y: +r[3], m, d: +r[1] } : null;
  },
};

function isRealDate({ y, m, d }: DateParts): boolean {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return d <= days;
}

const pad = (n: number, width: number) => String(n).padStart(width, '0');

export const parseDate = defineRule({
  name: 'parse_date',
  description:
    'Parse a date using the listed formats in order; the first format that yields a real calendar date (years 1900-2100) wins. Output is YYYY-MM-DD. Ambiguous values like 04/05/2019 are resolved by format order, so order matters.',
  params: z.object({ formats: z.array(z.enum(DATE_FORMATS)).min(1) }),
  apply(value, { formats }) {
    if (value === null) return ok(null);
    const text = asText(value).trim();
    for (const format of formats) {
      const parts = PARSERS[format](text);
      if (parts && isRealDate(parts)) {
        return ok(`${pad(parts.y, 4)}-${pad(parts.m, 2)}-${pad(parts.d, 2)}`);
      }
    }
    return fail('INVALID_DATE', `"${text}" is not a valid date in formats ${formats.join(', ')}`);
  },
});
