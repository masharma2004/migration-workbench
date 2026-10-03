import { z } from 'zod';
import type { RuleDef } from './define';
import { parseDate } from './date';
import { countryToIso2, mapValues, toBoolean } from './lookup';
import { currencyToCents } from './money';
import { phoneToE164 } from './phone';
import { defaultValue, lowercase, required, splitName, trim } from './text';

export type { RuleDef } from './define';
export { DATE_FORMATS } from './date';
export { ISO2_COUNTRIES } from './phone';

export const RULES = {
  trim,
  lowercase,
  split_name: splitName,
  parse_date: parseDate,
  phone_to_e164: phoneToE164,
  map_values: mapValues,
  country_to_iso2: countryToIso2,
  currency_to_cents: currencyToCents,
  to_boolean: toBoolean,
  default_value: defaultValue,
  required,
} as const;

export type RuleName = keyof typeof RULES;
export const RULE_NAMES = Object.keys(RULES) as RuleName[];

export function isRuleName(value: string): value is RuleName {
  return Object.hasOwn(RULES, value);
}

export function getRule(name: string): RuleDef<unknown> | undefined {
  return isRuleName(name) ? (RULES[name] as RuleDef<unknown>) : undefined;
}

export function describeRules(): { name: RuleName; description: string; params: Record<string, unknown> }[] {
  return RULE_NAMES.map((name) => {
    const params = z.toJSONSchema(RULES[name].params, { io: 'input' }) as Record<string, unknown>;
    delete params.$schema;
    return { name, description: RULES[name].description, params };
  });
}
