import { z } from 'zod';
import { asText, defineRule, fail, ok } from './define';
import { ISO2_COUNTRIES } from './phone';

export const mapValues = defineRule({
  name: 'map_values',
  description:
    'Translate values through a lookup table. onUnmapped decides what happens to values not in the table: "error" fails the record, "null" clears the value, "passthrough" keeps it.',
  params: z.object({
    mapping: z.record(z.string(), z.string()),
    caseInsensitive: z.boolean().default(true),
    onUnmapped: z.enum(['error', 'null', 'passthrough']).default('error'),
  }),
  apply(value, { mapping, caseInsensitive, onUnmapped }) {
    if (value === null) return ok(null);
    const key = asText(value);
    const hit = caseInsensitive
      ? Object.entries(mapping).find(([k]) => k.toLowerCase() === key.toLowerCase())
      : Object.hasOwn(mapping, key)
        ? ([key, mapping[key]] as const)
        : undefined;
    if (hit) return ok(hit[1]);
    if (onUnmapped === 'null') return ok(null);
    if (onUnmapped === 'passthrough') return ok(key);
    return fail('UNMAPPED_VALUE', `"${key}" has no mapping`);
  },
});

export const toBoolean = defineRule({
  name: 'to_boolean',
  description: 'Convert text to true/false using explicit case-insensitive lists. Other values fail.',
  params: z.object({ truthy: z.array(z.string()).min(1), falsy: z.array(z.string()).min(1) }),
  apply(value, { truthy, falsy }) {
    if (value === null || typeof value === 'boolean') return ok(value);
    const key = asText(value).trim().toLowerCase();
    if (truthy.some((t) => t.toLowerCase() === key)) return ok(true);
    if (falsy.some((f) => f.toLowerCase() === key)) return ok(false);
    return fail('INVALID_BOOLEAN', `"${asText(value)}" is not a recognised boolean`);
  },
});

const COUNTRY_ALIASES: Record<string, string> = {
  USA: 'US', 'UNITED STATES': 'US', 'UNITED STATES OF AMERICA': 'US', AMERICA: 'US',
  UK: 'GB', 'UNITED KINGDOM': 'GB', 'GREAT BRITAIN': 'GB', ENGLAND: 'GB',
  INDIA: 'IN', BHARAT: 'IN', GERMANY: 'DE', DEUTSCHLAND: 'DE', CANADA: 'CA', FRANCE: 'FR',
  AUSTRALIA: 'AU', SINGAPORE: 'SG', JAPAN: 'JP', BRAZIL: 'BR', BRASIL: 'BR', MEXICO: 'MX',
  SPAIN: 'ES', ESPANA: 'ES', ITALY: 'IT', NETHERLANDS: 'NL', IRELAND: 'IE', 'NEW ZEALAND': 'NZ',
  'SOUTH AFRICA': 'ZA', UAE: 'AE', 'UNITED ARAB EMIRATES': 'AE', CHINA: 'CN',
};

export const countryToIso2 = defineRule({
  name: 'country_to_iso2',
  description:
    'Convert a country code or common country name (e.g. "USA", "U.S.", "Deutschland") to an ISO 3166-1 alpha-2 code. Unknown names fail.',
  params: z.object({}),
  apply(value) {
    if (value === null) return ok(null);
    const key = asText(value)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/\./g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (key.length === 2 && ISO2_COUNTRIES.has(key)) return ok(key);
    const alias = COUNTRY_ALIASES[key];
    return alias ? ok(alias) : fail('UNKNOWN_COUNTRY', `"${asText(value)}" is not a recognised country`);
  },
});
