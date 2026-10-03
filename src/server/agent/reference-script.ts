import { REFERENCE_DRAFT } from '@/seed/reference-draft';
import type { MockStep } from './llm/mock';

/** Deterministic agent run: steps 1–6 are tool calls, step 7 submits REFERENCE_DRAFT. */
export function referenceScript(): MockStep[] {
  return [
    { calls: [{ name: 'get_source_schema', args: {} }, { name: 'get_target_schema', args: {} }, { name: 'list_transformation_rules', args: {} }] },
    { calls: [
      { name: 'profile_field', args: { field: 'signup_date' } },
      { name: 'profile_field', args: { field: 'status' } },
      { name: 'test_transformation', args: { sourceField: 'lifetime_value', targetField: 'lifetime_value_cents',
        transforms: [{ rule: 'trim', params: {} }, { rule: 'currency_to_cents', params: { allowNegative: false } }, { rule: 'required', params: {} }] } },
    ] },
    { calls: [{ name: 'submit_plan_draft', args: REFERENCE_DRAFT as unknown as Record<string, unknown> }] },
  ];
}
