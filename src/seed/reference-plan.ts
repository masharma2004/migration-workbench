import type { Plan } from '@/domain/plan';

const t = (rule: string, params: Record<string, unknown> = {}) => ({ rule, params });

/** Hand-written correct plan. Used by tests, the mock LLM and docs/sample-data.md. */
export const REFERENCE_PLAN: Plan = {
  sourceSchemaVersion: 'source-v1',
  targetSchemaVersion: 'target-v1',
  mappings: [
    { targetField: 'legacy_id', sourceField: 'cust_id', transforms: [t('trim'), t('required')],
      rationale: 'Legacy key becomes the idempotency key.', confidence: 'high' },
    { targetField: 'first_name', sourceField: 'full_name',
      transforms: [t('trim'), t('split_name', { part: 'first' }), t('required')],
      rationale: 'Split full name; handles "Last, First".', confidence: 'medium' },
    { targetField: 'last_name', sourceField: 'full_name', transforms: [t('trim'), t('split_name', { part: 'last' })],
      rationale: 'Single-word names have no last name.', confidence: 'medium' },
    { targetField: 'email', sourceField: 'email', transforms: [t('trim'), t('lowercase'), t('required')],
      rationale: 'Lower-cased for case-insensitive uniqueness.', confidence: 'high' },
    { targetField: 'phone_e164', sourceField: 'phone', transforms: [t('trim'), t('phone_to_e164', { defaultCountry: 'US' })],
      rationale: 'National numbers are US; international numbers carry a + prefix.', confidence: 'medium' },
    { targetField: 'created_on', sourceField: 'signup_date',
      transforms: [t('trim'), t('parse_date', { formats: ['YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY', 'DD-MMM-YYYY'] }), t('required')],
      rationale: 'Ambiguous slash dates are read month-first.', confidence: 'low' },
    { targetField: 'status', sourceField: 'status',
      transforms: [t('trim'), t('map_values', {
        mapping: { A: 'active', active: 'active', I: 'inactive', inactive: 'inactive', C: 'closed', closed: 'closed' },
        caseInsensitive: true, onUnmapped: 'error' }), t('required')],
      rationale: 'Unknown codes are quarantined rather than guessed.', confidence: 'medium' },
    { targetField: 'country_code', sourceField: 'country', transforms: [t('trim'), t('country_to_iso2')],
      rationale: 'Names and variants normalised to ISO2.', confidence: 'high' },
    { targetField: 'lifetime_value_cents', sourceField: 'lifetime_value',
      transforms: [t('trim'), t('currency_to_cents', { allowNegative: false }), t('required')],
      rationale: 'Negative, non-USD and missing values are quarantined.', confidence: 'medium' },
    { targetField: 'is_vip', sourceField: 'is_vip',
      transforms: [t('trim'), t('to_boolean', { truthy: ['y', 'yes', '1', 'true'], falsy: ['n', 'no', '0', 'false'] }),
        t('default_value', { value: false })],
      rationale: 'Missing flag treated as not VIP.', confidence: 'high' },
    { targetField: 'marketing_opt_in', sourceField: null, transforms: [t('default_value', { value: false })],
      rationale: 'No consent data exists; default to no consent.', confidence: 'low' },
  ],
  unmappedSourceFields: [
    { field: 'notes', decision: 'drop', reason: 'Free text with possible personal data and no target column.' },
  ],
};
