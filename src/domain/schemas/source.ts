export const SOURCE_SCHEMA_VERSION = 'source-v1' as const;

export const SOURCE_FIELDS = [
  'cust_id',
  'full_name',
  'email',
  'phone',
  'signup_date',
  'status',
  'country',
  'lifetime_value',
  'is_vip',
  'notes',
] as const;

export type SourceField = (typeof SOURCE_FIELDS)[number];

export const SOURCE_FIELD_DESCRIPTIONS: Record<SourceField, string> = {
  cust_id: 'Legacy customer identifier, e.g. C-00042. Expected unique but not guaranteed.',
  full_name: 'Customer full name as typed by staff; formats vary.',
  email: 'Contact email as free text.',
  phone: 'Phone number in mixed national and international formats.',
  signup_date: 'Date the customer signed up; mixed formats.',
  status: 'Legacy account status as a code or word.',
  country: 'Country as free text or code.',
  lifetime_value: 'Lifetime spend as text; may include currency symbols.',
  is_vip: 'VIP flag as free text.',
  notes: 'Free-text staff notes.',
};

export function isSourceField(value: string): value is SourceField {
  return (SOURCE_FIELDS as readonly string[]).includes(value);
}

/** Reads a raw source value. Empty or whitespace-only strings become null; nothing else changes. */
export function extractField(raw: Record<string, unknown>, field: string): string | null {
  const value = raw[field];
  if (value === null || value === undefined) return null;
  const text = typeof value === 'string' ? value : String(value);
  return text.trim() === '' ? null : text;
}
