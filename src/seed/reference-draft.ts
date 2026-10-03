import type { DraftArgs } from '@/server/agent/draft';
import { REFERENCE_PLAN } from './reference-plan';

/** What a good agent run should submit. Evidence step ids match referenceScript(). */
export const REFERENCE_DRAFT: DraftArgs = {
  summary:
    'Map 10 of 11 target fields from the legacy source and default marketing_opt_in to false pending confirmation. ' +
    'Drop notes (possible personal data). Ambiguous slash dates, undocumented status S, and non-USD or negative lifetime values need decisions.',
  mappings: REFERENCE_PLAN.mappings.map((m) => ({ ...m, sourceField: m.sourceField ?? '' })),
  unmappedSourceFields: REFERENCE_PLAN.unmappedSourceFields,
  incompatibilities: [
    { field: 'marketing_opt_in', side: 'target', kind: 'no_source', description: 'Required consent flag has no legacy source.' },
    { field: 'notes', side: 'source', kind: 'no_target', description: 'Free-text notes have no target column.' },
    { field: 'lifetime_value', side: 'source', kind: 'type_mismatch', description: 'Text amounts must become integer cents.' },
    { field: 'signup_date', side: 'source', kind: 'type_mismatch', description: 'Mixed-format text must become a date.' },
  ],
  risks: [
    { id: 'r-date-ambiguity', severity: 'high', fields: ['signup_date'], evidenceStepIds: [4],
      description: 'Some slash dates are ambiguous (both parts ≤ 12); format order silently decides month vs day.' },
    { id: 'r-status-unknown', severity: 'medium', fields: ['status'], evidenceStepIds: [5],
      description: 'Status code "S" is undocumented; records with it will be quarantined.' },
    { id: 'r-ltv-invalid', severity: 'medium', fields: ['lifetime_value'], evidenceStepIds: [6],
      description: 'Negative, non-USD and placeholder lifetime values fail conversion and will be quarantined.' },
    { id: 'r-consent-default', severity: 'high', fields: ['marketing_opt_in'], evidenceStepIds: [2],
      description: 'Defaulting consent to true would be a compliance risk; the plan defaults to false.' },
  ],
  questions: [
    { id: 'q-date-order', blocking: true, relatedFields: ['signup_date'], text: 'Ambiguous dates like 04/05/2019: month-first (US) or day-first?',
      suggestedOptions: ['Month-first (US)', 'Day-first', 'Quarantine ambiguous dates'], assumption: 'Month-first, as most customers are US-based.' },
    { id: 'q-marketing-consent', blocking: true, relatedFields: ['marketing_opt_in'], text: 'No consent data exists. Is defaulting marketing_opt_in to false acceptable?',
      suggestedOptions: ['Yes, default to false', 'Block migration until consent is collected'], assumption: 'Default to false (no consent).' },
    { id: 'q-status-s', blocking: false, relatedFields: ['status'], text: 'What does legacy status "S" mean?',
      suggestedOptions: ['Suspended → inactive', 'Keep quarantined'], assumption: 'Quarantine until clarified.' },
    { id: 'q-notes', blocking: false, relatedFields: ['notes'], text: 'Notes contain personal data (DOB, passport references). Confirm they can be dropped?',
      suggestedOptions: ['Drop', 'Keep in a restricted archive'], assumption: 'Drop.' },
  ],
};
