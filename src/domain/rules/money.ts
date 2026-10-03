import { z } from 'zod';
import { asText, defineRule, fail, ok } from './define';

const MAX_CENTS = 100_000_000_000;

export const currencyToCents = defineRule({
  name: 'currency_to_cents',
  description:
    'Parse a US-dollar amount such as "$1,234.50" or "1234.5" into integer cents. At most 2 decimals. Other currencies fail with UNSUPPORTED_CURRENCY; negative amounts fail unless allowNegative is true.',
  params: z.object({ allowNegative: z.boolean().default(false) }),
  apply(value, { allowNegative }) {
    if (value === null) return ok(null);
    const original = asText(value).trim();
    if (/[€£¥₹]/.test(original) || (/^[A-Z]{3}\s|\s[A-Z]{3}$/.test(original) && !/^USD\s|\sUSD$/.test(original))) {
      return fail('UNSUPPORTED_CURRENCY', `"${original}" is not in US dollars`);
    }
    let text = original.replace(/^USD\s+|\s+USD$/g, '');
    let negative = false;
    if (text.startsWith('-')) { negative = true; text = text.slice(1); }
    if (text.startsWith('$')) text = text.slice(1);
    if (!negative && text.startsWith('-')) { negative = true; text = text.slice(1); }
    if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(text)) {
      return fail('INVALID_NUMBER', `"${original}" is not a valid amount`);
    }
    const [whole, fraction = ''] = text.replace(/,/g, '').split('.');
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (cents > MAX_CENTS) return fail('AMOUNT_OUT_OF_RANGE', `"${original}" exceeds the supported maximum`);
    if (negative && cents !== 0 && !allowNegative) {
      return fail('NEGATIVE_AMOUNT', `"${original}" is negative`);
    }
    return ok(negative ? -cents : cents);
  },
});
