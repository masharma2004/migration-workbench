import { getCountries, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max';
import { z } from 'zod';
import { asText, defineRule, fail, ok } from './define';

export const ISO2_COUNTRIES: ReadonlySet<string> = new Set<string>(getCountries());

export const phoneToE164 = defineRule({
  name: 'phone_to_e164',
  description:
    'Parse a phone number and format it as E.164 (e.g. +12125550187). Numbers without a + prefix are read as national numbers of defaultCountry. Invalid numbers fail.',
  params: z.object({
    defaultCountry: z
      .string()
      .length(2)
      .refine((c) => ISO2_COUNTRIES.has(c), 'Unsupported country code'),
  }),
  apply(value, { defaultCountry }) {
    if (value === null) return ok(null);
    const text = asText(value).trim();
    const parsed = parsePhoneNumberFromString(text, defaultCountry as CountryCode);
    if (!parsed || !parsed.isValid()) return fail('INVALID_PHONE', `"${text}" is not a valid phone number`);
    return ok(parsed.number);
  },
});
