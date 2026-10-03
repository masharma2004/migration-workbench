import { z } from 'zod';
import { asText, defineRule, fail, ok } from './define';

export const trim = defineRule({
  name: 'trim',
  description:
    'Remove leading/trailing whitespace and collapse inner runs of whitespace to one space. An empty result becomes null.',
  params: z.object({}),
  apply(value) {
    if (typeof value !== 'string') return ok(value);
    const text = value.trim().replace(/\s+/g, ' ');
    return ok(text === '' ? null : text);
  },
});

export const lowercase = defineRule({
  name: 'lowercase',
  description: 'Convert text to lower case.',
  params: z.object({}),
  apply(value) {
    return typeof value === 'string' ? ok(value.toLowerCase()) : ok(value);
  },
});

export const splitName = defineRule({
  name: 'split_name',
  description:
    'Extract one part of a personal name. "Last, First Middle" splits at the comma; otherwise the first word is the first name and the remaining words the last name. A single word is a first name with no last name (null).',
  params: z.object({ part: z.enum(['first', 'last']) }),
  apply(value, { part }) {
    if (value === null) return ok(null);
    const text = asText(value).trim().replace(/\s+/g, ' ');
    if (text.includes(',')) {
      const [last, ...rest] = text.split(',');
      const first = rest.join(',').trim();
      const result = part === 'first' ? first : last.trim();
      return ok(result === '' ? null : result);
    }
    const tokens = text.split(' ');
    if (part === 'first') return ok(tokens[0] === '' ? null : tokens[0]);
    return ok(tokens.length > 1 ? tokens.slice(1).join(' ') : null);
  },
});

export const required = defineRule({
  name: 'required',
  description: 'Fail the record when the value is missing (null). Use for required target fields.',
  params: z.object({}),
  apply(value) {
    return value === null ? fail('REQUIRED_MISSING', 'Value is required but missing') : ok(value);
  },
});

export const defaultValue = defineRule({
  name: 'default_value',
  description: 'Replace a missing (null) value with a fixed value. Non-null values pass through.',
  params: z.object({ value: z.union([z.string(), z.number(), z.boolean()]) }),
  apply(value, params) {
    return ok(value === null ? params.value : value);
  },
});
