import type { Scalar } from '../types';

export const TARGET_SCHEMA_VERSION = 'target-v1' as const;

export const TARGET_FIELD_NAMES = [
  'legacy_id',
  'first_name',
  'last_name',
  'email',
  'phone_e164',
  'created_on',
  'status',
  'country_code',
  'lifetime_value_cents',
  'is_vip',
  'marketing_opt_in',
] as const;

export type TargetField = (typeof TARGET_FIELD_NAMES)[number];
export type TargetFieldType = 'string' | 'date' | 'enum' | 'integer' | 'boolean';

export interface TargetFieldDef {
  name: TargetField;
  type: TargetFieldType;
  required: boolean;
  description: string;
  maxLength?: number;
  enumValues?: readonly string[];
  min?: number;
  max?: number;
  format?: 'email' | 'e164' | 'iso2';
  unique?: boolean;
}

export const TARGET_FIELDS: readonly TargetFieldDef[] = [
  { name: 'legacy_id', type: 'string', required: true, maxLength: 50, unique: true,
    description: 'Identifier from the legacy system; used as the idempotency key.' },
  { name: 'first_name', type: 'string', required: true, maxLength: 100, description: 'Given name.' },
  { name: 'last_name', type: 'string', required: false, maxLength: 100, description: 'Family name; may be absent.' },
  { name: 'email', type: 'string', required: true, maxLength: 254, format: 'email', unique: true,
    description: 'Contact email, unique case-insensitively.' },
  { name: 'phone_e164', type: 'string', required: false, format: 'e164', description: 'Phone in E.164 format.' },
  { name: 'created_on', type: 'date', required: true, description: 'Customer creation date (YYYY-MM-DD).' },
  { name: 'status', type: 'enum', required: true, enumValues: ['active', 'inactive', 'closed'],
    description: 'Account status.' },
  { name: 'country_code', type: 'string', required: false, format: 'iso2', description: 'ISO 3166-1 alpha-2 code.' },
  { name: 'lifetime_value_cents', type: 'integer', required: true, min: 0, max: 100_000_000_000,
    description: 'Lifetime spend in US cents; never negative.' },
  { name: 'is_vip', type: 'boolean', required: true, description: 'VIP customer flag.' },
  { name: 'marketing_opt_in', type: 'boolean', required: true,
    description: 'Customer consented to marketing. The legacy system has no such field.' },
];

export type TargetRow = Record<TargetField, Scalar>;

export function getTargetField(name: string): TargetFieldDef | undefined {
  return TARGET_FIELDS.find((f) => f.name === name);
}
