import { getRule, RULE_NAMES } from '../rules';
import { isSourceField, SOURCE_FIELDS, SOURCE_SCHEMA_VERSION } from '../schemas/source';
import { getTargetField, TARGET_FIELD_NAMES, TARGET_SCHEMA_VERSION } from '../schemas/target';
import type { Plan } from './schema';

export interface PlanIssue {
  path: string;
  code: string;
  message: string;
}

export function validatePlan(plan: Plan): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const add = (path: string, code: string, message: string) => issues.push({ path, code, message });

  if (plan.sourceSchemaVersion !== SOURCE_SCHEMA_VERSION) {
    add('sourceSchemaVersion', 'SCHEMA_VERSION_MISMATCH', `Expected ${SOURCE_SCHEMA_VERSION}`);
  }
  if (plan.targetSchemaVersion !== TARGET_SCHEMA_VERSION) {
    add('targetSchemaVersion', 'SCHEMA_VERSION_MISMATCH', `Expected ${TARGET_SCHEMA_VERSION}`);
  }

  const mappedTargets = new Map<string, number>();
  const mappedSources = new Set<string>();

  plan.mappings.forEach((m, i) => {
    const path = `mappings[${i}]`;
    const def = getTargetField(m.targetField);
    if (!def) {
      add(`${path}.targetField`, 'UNKNOWN_TARGET_FIELD', `Unknown target field "${m.targetField}"`);
    } else if (mappedTargets.has(m.targetField)) {
      add(path, 'DUPLICATE_TARGET_MAPPING',
        `"${m.targetField}" is already mapped by mappings[${mappedTargets.get(m.targetField)}]`);
    } else {
      mappedTargets.set(m.targetField, i);
    }

    if (m.sourceField !== null) {
      if (isSourceField(m.sourceField)) mappedSources.add(m.sourceField);
      else add(`${path}.sourceField`, 'UNKNOWN_SOURCE_FIELD', `Unknown source field "${m.sourceField}"`);
    }

    m.transforms.forEach((t, j) => {
      const rule = getRule(t.rule);
      if (!rule) {
        add(`${path}.transforms[${j}].rule`, 'UNKNOWN_RULE',
          `Unknown rule "${t.rule}". Supported: ${RULE_NAMES.join(', ')}`);
        return;
      }
      const parsed = rule.params.safeParse(t.params ?? {});
      if (!parsed.success) {
        const detail = parsed.error.issues
          .map((x) => `${x.path.join('.') || '(root)'}: ${x.message}`)
          .join('; ');
        add(`${path}.transforms[${j}].params`, 'INVALID_PARAMS', `${t.rule} params invalid — ${detail}`);
      }
    });

    const rules = m.transforms.map((t) => t.rule);
    if (m.sourceField === null && !rules.includes('default_value')) {
      add(path, 'CONSTANT_WITHOUT_DEFAULT',
        `"${m.targetField}" has no source field, so it needs a default_value rule`);
    }
    if (def?.required && !rules.includes('required') && !rules.includes('default_value')) {
      add(path, 'REQUIRED_NOT_ENFORCED',
        `"${m.targetField}" is required in the target; add a "required" or "default_value" rule`);
    }
  });

  for (const field of TARGET_FIELD_NAMES) {
    if (!mappedTargets.has(field)) add('mappings', 'MISSING_TARGET_MAPPING', `Target field "${field}" is not mapped`);
  }

  const dropped = new Set<string>();
  plan.unmappedSourceFields.forEach((u, i) => {
    const path = `unmappedSourceFields[${i}]`;
    if (!isSourceField(u.field)) add(path, 'UNKNOWN_SOURCE_FIELD', `Unknown source field "${u.field}"`);
    else if (mappedSources.has(u.field)) add(path, 'SOURCE_FIELD_BOTH', `"${u.field}" is both mapped and dropped`);
    dropped.add(u.field);
  });
  for (const field of SOURCE_FIELDS) {
    if (!mappedSources.has(field) && !dropped.has(field)) {
      add('unmappedSourceFields', 'SOURCE_FIELD_UNACCOUNTED',
        `Source field "${field}" is neither mapped nor explicitly dropped`);
    }
  }
  return issues;
}
