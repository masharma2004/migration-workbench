# Phase 1 — Foundation and Domain (Tasks 1–6)

Read `00-index.md` first (Global Constraints apply to every task).

---

### Task 1: Scaffold the project

**Files:**
- Create: Next.js app files (via `create-next-app`), `docker-compose.yml`, `deploy/initdb/01-test-db.sql`, `.env.example`, `.gitattributes`, `vitest.config.ts`, `tests/unit/smoke.test.ts`
- Modify: `package.json` (scripts), `next.config.ts`, `.gitignore`

**Interfaces:**
- Produces: npm scripts `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:unit`, `test:int`, `db:generate`, `db:migrate`, `seed:generate`; Vitest projects `unit` and `integration`; local Postgres on `localhost:5433` (user/password/db `workbench`, plus `workbench_test`).

- [ ] **Step 1: Generate the Next.js app in the scratchpad and copy it in** (the repo already contains files `create-next-app` refuses to overwrite)

```bash
SCRATCH="$(cygpath -u "$TEMP")/wb-scaffold" && rm -rf "$SCRATCH" && mkdir -p "$SCRATCH" && cd "$SCRATCH"
npx --yes create-next-app@16 app --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes --skip-install
cd app && rm -rf .git node_modules && cp -r . /c/Users/mayan/aggroso-assignment/
cd /c/Users/mayan/aggroso-assignment
```

- [ ] **Step 2: Install dependencies**

```bash
npm install
npm install drizzle-orm postgres zod pino @google/genai libphonenumber-js nanoid @tanstack/react-query
npm install -D typescript@~5.9 drizzle-kit vitest tsx @types/node pino-pretty
```

- [ ] **Step 3: Add scripts to `package.json`** (merge into the existing `scripts` object)

```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint .",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:unit": "vitest run --project unit",
  "test:int": "vitest run --project integration",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "tsx scripts/migrate.ts",
  "seed:generate": "tsx scripts/generate-seed.ts"
}
```

- [ ] **Step 4: Configure Next.js** — replace `next.config.ts`:

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['pino', 'postgres'],
  poweredByHeader: false,
};

export default nextConfig;
```

- [ ] **Step 5: Local Postgres** — create `docker-compose.yml`:

```yaml
services:
  db:
    image: postgres:17
    environment:
      POSTGRES_USER: workbench
      POSTGRES_PASSWORD: workbench
      POSTGRES_DB: workbench
    ports:
      - "5433:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./deploy/initdb:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U workbench"]
      interval: 5s
      retries: 10
volumes:
  pgdata:
```

Create `deploy/initdb/01-test-db.sql`:

```sql
CREATE DATABASE workbench_test;
```

- [ ] **Step 6: Env, git attributes, ignore rules**

`.env.example`:

```bash
# Postgres connection string
DATABASE_URL=postgres://workbench:workbench@localhost:5433/workbench
# Test database used by `npm run test:int`
DATABASE_URL_TEST=postgres://workbench:workbench@localhost:5433/workbench_test
# Gemini API key (https://aistudio.google.com/apikey). Leave empty to disable the agent.
GEMINI_API_KEY=
# Gemini model id
GEMINI_MODEL=gemini-2.5-flash
# LLM provider: gemini | mock (mock replays a scripted run; for demos/tests without a key)
LLM_PROVIDER=gemini
# Agent runs allowed per IP per 10 minutes, and per day across all users
AGENT_RATE_PER_10MIN=6
AGENT_DAILY_CAP=300
# pino log level: trace | debug | info | warn | error
LOG_LEVEL=info
# Public hostname for Caddy TLS in production (e.g. 3.110.12.34.sslip.io)
DOMAIN=localhost
```

`.gitattributes`:

```
* text=auto eol=lf
*.png binary
```

Append to `.gitignore`:

```
.env
.env.local
/playwright-report
/test-results
```

Then: `cp .env.example .env`

- [ ] **Step 7: Vitest config** — create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('./src', import.meta.url));
const testDb =
  process.env.DATABASE_URL_TEST ?? 'postgres://workbench:workbench@localhost:5433/workbench_test';

export default defineConfig({
  resolve: { alias: { '@': src } },
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], environment: 'node' },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          env: { DATABASE_URL: testDb, LOG_LEVEL: 'silent' },
          globalSetup: ['tests/integration/global-setup.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
```

`tests/unit/smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

describe('toolchain', () => {
  it('runs unit tests', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 8: Verify**

Run: `docker compose up -d db && npm run typecheck && npm run test:unit && npm run build`
Expected: typecheck clean, 1 test passes, Next build succeeds.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "chore: scaffold Next.js app, local Postgres, vitest"
```

---

### Task 2: Domain basics — types, canonical hashing, schemas

**Files:**
- Create: `src/domain/types.ts`, `src/domain/limits.ts`, `src/domain/hash.ts`, `src/domain/schemas/source.ts`, `src/domain/schemas/target.ts`
- Test: `tests/unit/domain/hash.test.ts`, `tests/unit/domain/schemas.test.ts`

**Interfaces:**
- Produces:
  - `type Scalar = string | number | boolean | null`
  - `type RuleResult = { ok: true; value: Scalar } | { ok: false; code: string; message: string }`
  - `interface FieldError { targetField: string; sourceField: string | null; sourceValue: string | null; rule: string | null; code: string; message: string }`
  - `type RejectionStage = 'TRANSFORM_ERROR' | 'VALIDATION_ERROR' | 'DUPLICATE_SOURCE_KEY' | 'TARGET_CONFLICT'`, `REJECTION_STAGES`
  - `interface SourceRecordInput { seq: number; raw: Record<string, unknown> }`
  - `class LimitExceededError extends Error`
  - `MAX_SOURCE_RECORDS = 500`, `EXECUTION_BATCH_SIZE = 50`
  - `canonicalJson(value: unknown): string`, `sha256(text: string): string`, `hashOf(value: unknown): string`
  - `SOURCE_SCHEMA_VERSION`, `SOURCE_FIELDS`, `type SourceField`, `SOURCE_FIELD_DESCRIPTIONS`, `isSourceField(x)`, `extractField(raw, field): string | null`
  - `TARGET_SCHEMA_VERSION`, `TARGET_FIELD_NAMES`, `type TargetField`, `TargetFieldDef`, `TARGET_FIELDS`, `type TargetRow`, `getTargetField(name)`

- [ ] **Step 1: Write failing tests**

`tests/unit/domain/hash.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { canonicalJson, hashOf, sha256 } from '@/domain/hash';

describe('canonicalJson', () => {
  it('sorts object keys recursively', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
  it('keeps array order and drops undefined object values', () => {
    expect(canonicalJson({ x: [3, 1, 2], y: undefined })).toBe('{"x":[3,1,2]}');
  });
  it('serialises undefined array items as null', () => {
    expect(canonicalJson([1, undefined])).toBe('[1,null]');
  });
  it('rejects non-finite numbers', () => {
    expect(() => canonicalJson({ n: Number.NaN })).toThrow(/Non-finite/);
  });
});

describe('hashOf', () => {
  it('is independent of key order', () => {
    expect(hashOf({ a: 1, b: 2 })).toBe(hashOf({ b: 2, a: 1 }));
  });
  it('produces 64-char hex sha256', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
```

`tests/unit/domain/schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { extractField, isSourceField, SOURCE_FIELDS } from '@/domain/schemas/source';
import { getTargetField, TARGET_FIELD_NAMES, TARGET_FIELDS } from '@/domain/schemas/target';

describe('source schema', () => {
  it('has 10 fields including cust_id and notes', () => {
    expect(SOURCE_FIELDS).toHaveLength(10);
    expect(isSourceField('cust_id')).toBe(true);
    expect(isSourceField('nope')).toBe(false);
  });
  it('extractField reads blank and whitespace as null and keeps other text untouched', () => {
    expect(extractField({ email: '' }, 'email')).toBeNull();
    expect(extractField({ email: '   ' }, 'email')).toBeNull();
    expect(extractField({}, 'email')).toBeNull();
    expect(extractField({ email: ' A@B.io ' }, 'email')).toBe(' A@B.io ');
    expect(extractField({ phone: 5550100 }, 'phone')).toBe('5550100');
  });
});

describe('target schema', () => {
  it('defines every field name exactly once, in order', () => {
    expect(TARGET_FIELDS.map((f) => f.name)).toEqual([...TARGET_FIELD_NAMES]);
  });
  it('marks marketing_opt_in as required boolean with no source', () => {
    expect(getTargetField('marketing_opt_in')).toMatchObject({ type: 'boolean', required: true });
  });
  it('returns undefined for unknown fields', () => {
    expect(getTargetField('nope')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --project unit tests/unit/domain`
Expected: FAIL — cannot resolve `@/domain/hash`.

- [ ] **Step 3: Implement**

`src/domain/types.ts`:

```ts
export type Scalar = string | number | boolean | null;

export type RuleResult = { ok: true; value: Scalar } | { ok: false; code: string; message: string };

export interface FieldError {
  targetField: string;
  sourceField: string | null;
  sourceValue: string | null;
  rule: string | null;
  code: string;
  message: string;
}

export type RejectionStage =
  | 'TRANSFORM_ERROR'
  | 'VALIDATION_ERROR'
  | 'DUPLICATE_SOURCE_KEY'
  | 'TARGET_CONFLICT';

export const REJECTION_STAGES: readonly RejectionStage[] = [
  'TRANSFORM_ERROR',
  'VALIDATION_ERROR',
  'DUPLICATE_SOURCE_KEY',
  'TARGET_CONFLICT',
];

export interface SourceRecordInput {
  seq: number;
  raw: Record<string, unknown>;
}

export class LimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LimitExceededError';
  }
}
```

`src/domain/limits.ts`:

```ts
/** Documented maximum number of source records per workspace. */
export const MAX_SOURCE_RECORDS = 500;
/** Rows inserted per transaction during execution. */
export const EXECUTION_BATCH_SIZE = 50;
```

`src/domain/hash.ts`:

```ts
import { createHash } from 'node:crypto';

/** JSON with recursively sorted object keys, so equal data always serialises identically. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('Non-finite number cannot be canonicalised');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function hashOf(value: unknown): string {
  return sha256(canonicalJson(value));
}
```

`src/domain/schemas/source.ts`:

```ts
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
```

`src/domain/schemas/target.ts`:

```ts
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
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run --project unit tests/unit/domain`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/domain tests/unit/domain && git commit -m "feat(domain): types, canonical hashing, source/target schemas"
```

---

### Task 3: Transformation rule catalog

**Files:**
- Create: `src/domain/rules/define.ts`, `src/domain/rules/text.ts`, `src/domain/rules/date.ts`, `src/domain/rules/phone.ts`, `src/domain/rules/lookup.ts`, `src/domain/rules/money.ts`, `src/domain/rules/index.ts`
- Test: `tests/unit/domain/rules.test.ts`

**Interfaces:**
- Consumes: `Scalar`, `RuleResult` (Task 2)
- Produces:
  - `interface RuleDef<P = unknown> { name: string; description: string; params: z.ZodType<P>; apply(value: Scalar, params: P): RuleResult }`
  - `RULES` (record of 11 rules), `type RuleName`, `RULE_NAMES`, `isRuleName(x)`, `getRule(name): RuleDef | undefined`, `describeRules(): { name; description; params: Record<string, unknown> }[]`
  - `DATE_FORMATS`, `ISO2_COUNTRIES: ReadonlySet<string>`

- [ ] **Step 1: Write failing tests** — `tests/unit/domain/rules.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { describeRules, getRule, RULE_NAMES } from '@/domain/rules';
import type { Scalar } from '@/domain/types';

function run(rule: string, value: Scalar, params: Record<string, unknown> = {}) {
  const def = getRule(rule);
  if (!def) throw new Error(`no rule ${rule}`);
  return def.apply(value, def.params.parse(params));
}

describe('catalog', () => {
  it('has 11 rules, each with description and JSON-schema params', () => {
    expect(RULE_NAMES).toHaveLength(11);
    for (const r of describeRules()) {
      expect(r.description.length).toBeGreaterThan(10);
      expect(r.params).toHaveProperty('type', 'object');
      expect(r.params).not.toHaveProperty('$schema');
    }
  });
  it('passes null through for every rule except required and default_value', () => {
    const params: Record<string, Record<string, unknown>> = {
      split_name: { part: 'first' },
      parse_date: { formats: ['YYYY-MM-DD'] },
      phone_to_e164: { defaultCountry: 'US' },
      map_values: { mapping: { a: 'b' } },
      to_boolean: { truthy: ['y'], falsy: ['n'] },
      default_value: { value: 'x' },
    };
    for (const name of RULE_NAMES) {
      if (name === 'required' || name === 'default_value') continue;
      expect(run(name, null, params[name] ?? {})).toEqual({ ok: true, value: null });
    }
  });
});

describe('text rules', () => {
  it('trim strips, collapses inner whitespace, and turns empty into null', () => {
    expect(run('trim', '  John   Smith ')).toEqual({ ok: true, value: 'John Smith' });
    expect(run('trim', '   ')).toEqual({ ok: true, value: null });
  });
  it('lowercase', () => {
    expect(run('lowercase', 'A+B@X.IO')).toEqual({ ok: true, value: 'a+b@x.io' });
  });
  it('split_name handles "First Last", "Last, First", and single names', () => {
    expect(run('split_name', 'John Smith', { part: 'first' })).toEqual({ ok: true, value: 'John' });
    expect(run('split_name', 'Mary Ann Lee', { part: 'last' })).toEqual({ ok: true, value: 'Ann Lee' });
    expect(run('split_name', 'Smith, John Q', { part: 'first' })).toEqual({ ok: true, value: 'John Q' });
    expect(run('split_name', 'Smith, John Q', { part: 'last' })).toEqual({ ok: true, value: 'Smith' });
    expect(run('split_name', 'Madonna', { part: 'first' })).toEqual({ ok: true, value: 'Madonna' });
    expect(run('split_name', 'Madonna', { part: 'last' })).toEqual({ ok: true, value: null });
  });
  it('split_name keeps unicode and apostrophes intact (review focus 1)', () => {
    expect(run('split_name', 'José Núñez', { part: 'last' })).toEqual({ ok: true, value: 'Núñez' });
    expect(run('split_name', "Sinéad O'Brien", { part: 'last' })).toEqual({ ok: true, value: "O'Brien" });
  });
  it('required fails on null only', () => {
    expect(run('required', null)).toMatchObject({ ok: false, code: 'REQUIRED_MISSING' });
    expect(run('required', 'x')).toEqual({ ok: true, value: 'x' });
  });
  it('default_value fills null only', () => {
    expect(run('default_value', null, { value: false })).toEqual({ ok: true, value: false });
    expect(run('default_value', true, { value: false })).toEqual({ ok: true, value: true });
  });
});

describe('parse_date', () => {
  const all = { formats: ['YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY', 'DD-MMM-YYYY'] };
  it('parses each supported format to ISO', () => {
    expect(run('parse_date', '2019-03-14', all)).toEqual({ ok: true, value: '2019-03-14' });
    expect(run('parse_date', '03/14/2019', all)).toEqual({ ok: true, value: '2019-03-14' });
    expect(run('parse_date', '14/03/2019', all)).toEqual({ ok: true, value: '2019-03-14' });
    expect(run('parse_date', '14-Mar-2019', all)).toEqual({ ok: true, value: '2019-03-14' });
    expect(run('parse_date', '2019/3/4', { formats: ['YYYY/MM/DD'] })).toEqual({ ok: true, value: '2019-03-04' });
  });
  it('resolves ambiguous dates by format order', () => {
    expect(run('parse_date', '04/05/2019', all)).toEqual({ ok: true, value: '2019-04-05' });
    expect(run('parse_date', '04/05/2019', { formats: ['DD/MM/YYYY', 'MM/DD/YYYY'] })).toEqual({
      ok: true,
      value: '2019-05-04',
    });
  });
  it('rejects impossible calendar dates', () => {
    expect(run('parse_date', '2019-02-30', all)).toMatchObject({ ok: false, code: 'INVALID_DATE' });
    expect(run('parse_date', '2020-02-29', all)).toEqual({ ok: true, value: '2020-02-29' });
    expect(run('parse_date', '31/31/2020', all)).toMatchObject({ ok: false, code: 'INVALID_DATE' });
  });
  it('rejects two-digit years, serial numbers and words (review focus 2)', () => {
    for (const v of ['3/4/19', '43567', 'unknown', '2019-3', '1850-01-01']) {
      expect(run('parse_date', v, all)).toMatchObject({ ok: false, code: 'INVALID_DATE' });
    }
  });
  it('rejects formats outside the catalog at param validation', () => {
    expect(getRule('parse_date')!.params.safeParse({ formats: ['YY-MM-DD'] }).success).toBe(false);
  });
});

describe('phone_to_e164', () => {
  it('formats national numbers with the default country and keeps international ones', () => {
    expect(run('phone_to_e164', '(212) 555-0187', { defaultCountry: 'US' })).toMatchObject({ ok: true });
    expect(run('phone_to_e164', '+44 20 7946 0018', { defaultCountry: 'US' })).toEqual({
      ok: true,
      value: '+442079460018',
    });
  });
  it('rejects garbage', () => {
    expect(run('phone_to_e164', 'call me', { defaultCountry: 'US' })).toMatchObject({
      ok: false,
      code: 'INVALID_PHONE',
    });
    expect(run('phone_to_e164', '12', { defaultCountry: 'US' })).toMatchObject({ ok: false });
  });
  it('rejects unsupported default countries at param validation', () => {
    expect(getRule('phone_to_e164')!.params.safeParse({ defaultCountry: 'XX' }).success).toBe(false);
  });
});

describe('lookup rules', () => {
  it('map_values is case-insensitive by default and errors on unmapped', () => {
    const p = { mapping: { A: 'active', Closed: 'closed' } };
    expect(run('map_values', 'a', p)).toEqual({ ok: true, value: 'active' });
    expect(run('map_values', 'CLOSED', p)).toEqual({ ok: true, value: 'closed' });
    expect(run('map_values', 'S', p)).toMatchObject({ ok: false, code: 'UNMAPPED_VALUE' });
  });
  it('map_values honours onUnmapped and caseInsensitive=false', () => {
    const base = { mapping: { A: 'active' } };
    expect(run('map_values', 'S', { ...base, onUnmapped: 'null' })).toEqual({ ok: true, value: null });
    expect(run('map_values', 'S', { ...base, onUnmapped: 'passthrough' })).toEqual({ ok: true, value: 'S' });
    expect(run('map_values', 'a', { ...base, caseInsensitive: false })).toMatchObject({ ok: false });
  });
  it('to_boolean maps listed values and rejects others', () => {
    const p = { truthy: ['y', 'yes', '1'], falsy: ['n', 'no', '0'] };
    expect(run('to_boolean', 'YES', p)).toEqual({ ok: true, value: true });
    expect(run('to_boolean', '0', p)).toEqual({ ok: true, value: false });
    expect(run('to_boolean', true, p)).toEqual({ ok: true, value: true });
    expect(run('to_boolean', 'maybe', p)).toMatchObject({ ok: false, code: 'INVALID_BOOLEAN' });
  });
  it('country_to_iso2 handles codes, names, dots and accents', () => {
    for (const [input, out] of [
      ['USA', 'US'], ['U.S.', 'US'], ['United States', 'US'], ['in', 'IN'],
      ['India', 'IN'], ['Deutschland', 'DE'], ['España', 'ES'], ['gb', 'GB'],
    ] as const) {
      expect(run('country_to_iso2', input)).toEqual({ ok: true, value: out });
    }
    expect(run('country_to_iso2', 'Atlantis')).toMatchObject({ ok: false, code: 'UNKNOWN_COUNTRY' });
  });
});

describe('currency_to_cents', () => {
  it('parses dollar amounts without floating-point drift', () => {
    expect(run('currency_to_cents', '$1,234.50')).toEqual({ ok: true, value: 123450 });
    expect(run('currency_to_cents', '1234.5')).toEqual({ ok: true, value: 123450 });
    expect(run('currency_to_cents', '0.29')).toEqual({ ok: true, value: 29 });
    expect(run('currency_to_cents', 'USD 10')).toEqual({ ok: true, value: 1000 });
  });
  it('handles negatives according to allowNegative', () => {
    expect(run('currency_to_cents', '-50.00')).toMatchObject({ ok: false, code: 'NEGATIVE_AMOUNT' });
    expect(run('currency_to_cents', '-$50.00', { allowNegative: true })).toEqual({ ok: true, value: -5000 });
  });
  it('rejects other currencies and non-numbers', () => {
    expect(run('currency_to_cents', '€300')).toMatchObject({ ok: false, code: 'UNSUPPORTED_CURRENCY' });
    expect(run('currency_to_cents', 'EUR 300')).toMatchObject({ ok: false, code: 'UNSUPPORTED_CURRENCY' });
    expect(run('currency_to_cents', 'N/A')).toMatchObject({ ok: false, code: 'INVALID_NUMBER' });
  });
  it('never silently rounds or overflows (review focus 3)', () => {
    expect(run('currency_to_cents', '1,234.567')).toMatchObject({ ok: false, code: 'INVALID_NUMBER' });
    expect(run('currency_to_cents', '12,34.00')).toMatchObject({ ok: false, code: 'INVALID_NUMBER' });
    expect(run('currency_to_cents', '99999999999999.99')).toMatchObject({
      ok: false,
      code: 'AMOUNT_OUT_OF_RANGE',
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project unit tests/unit/domain/rules.test.ts`
Expected: FAIL — cannot resolve `@/domain/rules`.

- [ ] **Step 3: Implement**

`src/domain/rules/define.ts`:

```ts
import type { z } from 'zod';
import type { RuleResult, Scalar } from '../types';

export interface RuleDef<P = unknown> {
  name: string;
  description: string;
  params: z.ZodType<P>;
  apply(value: Scalar, params: P): RuleResult;
}

export function defineRule<P>(def: RuleDef<P>): RuleDef<P> {
  return def;
}

export const ok = (value: Scalar): RuleResult => ({ ok: true, value });
export const fail = (code: string, message: string): RuleResult => ({ ok: false, code, message });
export const asText = (value: Scalar): string => (typeof value === 'string' ? value : String(value));
```

`src/domain/rules/text.ts`:

```ts
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
```

`src/domain/rules/date.ts`:

```ts
import { z } from 'zod';
import { asText, defineRule, fail, ok } from './define';

export const DATE_FORMATS = ['YYYY-MM-DD', 'YYYY/MM/DD', 'MM/DD/YYYY', 'DD/MM/YYYY', 'DD-MMM-YYYY'] as const;
type DateFormat = (typeof DATE_FORMATS)[number];
interface DateParts { y: number; m: number; d: number }

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const PARSERS: Record<DateFormat, (text: string) => DateParts | null> = {
  'YYYY-MM-DD': (t) => {
    const r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
    return r ? { y: +r[1], m: +r[2], d: +r[3] } : null;
  },
  'YYYY/MM/DD': (t) => {
    const r = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(t);
    return r ? { y: +r[1], m: +r[2], d: +r[3] } : null;
  },
  'MM/DD/YYYY': (t) => {
    const r = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
    return r ? { y: +r[3], m: +r[1], d: +r[2] } : null;
  },
  'DD/MM/YYYY': (t) => {
    const r = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
    return r ? { y: +r[3], m: +r[2], d: +r[1] } : null;
  },
  'DD-MMM-YYYY': (t) => {
    const r = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(t);
    if (!r) return null;
    const m = MONTHS.indexOf(r[2].toLowerCase()) + 1;
    return m > 0 ? { y: +r[3], m, d: +r[1] } : null;
  },
};

function isRealDate({ y, m, d }: DateParts): boolean {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return d <= days;
}

const pad = (n: number, width: number) => String(n).padStart(width, '0');

export const parseDate = defineRule({
  name: 'parse_date',
  description:
    'Parse a date using the listed formats in order; the first format that yields a real calendar date (years 1900-2100) wins. Output is YYYY-MM-DD. Ambiguous values like 04/05/2019 are resolved by format order, so order matters.',
  params: z.object({ formats: z.array(z.enum(DATE_FORMATS)).min(1) }),
  apply(value, { formats }) {
    if (value === null) return ok(null);
    const text = asText(value).trim();
    for (const format of formats) {
      const parts = PARSERS[format](text);
      if (parts && isRealDate(parts)) {
        return ok(`${pad(parts.y, 4)}-${pad(parts.m, 2)}-${pad(parts.d, 2)}`);
      }
    }
    return fail('INVALID_DATE', `"${text}" is not a valid date in formats ${formats.join(', ')}`);
  },
});
```

`src/domain/rules/phone.ts`:

```ts
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
```

`src/domain/rules/lookup.ts`:

```ts
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
```

`src/domain/rules/money.ts`:

```ts
import { z } from 'zod';
import { asText, defineRule, fail, ok } from './define';

const MAX_CENTS = 100_000_000_000;

export const currencyToCents = defineRule({
  name: 'currency_to_cents',
  description:
    'Parse a US-dollar amount such as "$1,234.50" or "1234.5" into integer cents. At most 2 decimals. Other currencies fail with UNSUPPORTED_CURRENCY; negative amounts fail unless allowNegative is true.',
  params: z.object({ allowNegative: z.boolean().default(false) }),
  apply(value, { allowNegative }) {
    if (value === null) return ok(null);
    const original = asText(value).trim();
    if (/[€£¥₹]/.test(original) || (/^[A-Z]{3}\s|\s[A-Z]{3}$/.test(original) && !/^USD\s|\sUSD$/.test(original))) {
      return fail('UNSUPPORTED_CURRENCY', `"${original}" is not in US dollars`);
    }
    let text = original.replace(/^USD\s+|\s+USD$/g, '');
    let negative = false;
    if (text.startsWith('-')) { negative = true; text = text.slice(1); }
    if (text.startsWith('$')) text = text.slice(1);
    if (!negative && text.startsWith('-')) { negative = true; text = text.slice(1); }
    if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(text)) {
      return fail('INVALID_NUMBER', `"${original}" is not a valid amount`);
    }
    const [whole, fraction = ''] = text.replace(/,/g, '').split('.');
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (cents > MAX_CENTS) return fail('AMOUNT_OUT_OF_RANGE', `"${original}" exceeds the supported maximum`);
    if (negative && cents !== 0 && !allowNegative) {
      return fail('NEGATIVE_AMOUNT', `"${original}" is negative`);
    }
    return ok(negative ? -cents : cents);
  },
});
```

`src/domain/rules/index.ts`:

```ts
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
    const { $schema: _ignored, ...params } = z.toJSONSchema(RULES[name].params, { io: 'input' }) as Record<
      string,
      unknown
    >;
    return { name, description: RULES[name].description, params };
  });
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run --project unit tests/unit/domain/rules.test.ts`
Expected: PASS. If the `(212) 555-0187` assertion fails because libphonenumber marks it invalid, replace it with `'(212) 736-5000'` (a real-format NYC number) — fictional 555 numbers are not guaranteed valid.

- [ ] **Step 5: Commit**

```bash
git add src/domain/rules tests/unit/domain/rules.test.ts && git commit -m "feat(domain): closed catalog of 11 transformation rules"
```

---

### Task 4: Plan model — schema, hash, validation, diff, reference plan

**Files:**
- Create: `src/domain/plan/schema.ts`, `src/domain/plan/hash.ts`, `src/domain/plan/validate.ts`, `src/domain/plan/diff.ts`, `src/domain/plan/index.ts`, `src/seed/reference-plan.ts`
- Test: `tests/unit/domain/plan.test.ts`

**Interfaces:**
- Consumes: schemas (Task 2), `getRule`, `RULE_NAMES` (Task 3), `hashOf`, `canonicalJson`
- Produces:
  - zod: `transformStepSchema`, `mappingSchema`, `planSchema`, `riskSchema`, `incompatibilitySchema`, `questionSchema`, `versionContentSchema`
  - types: `TransformStep`, `Mapping`, `Plan`, `Risk`, `Incompatibility`, `Question`, `VersionContent`
  - `interface MappingCore { targetField: string; sourceField: string | null; transforms: { rule: string; params: unknown }[] }`
  - `executablePlan(plan: Plan): { sourceSchemaVersion; targetSchemaVersion; mappings: MappingCore[]; unmappedSourceFields: { field; decision }[] }`
  - `planHash(plan: Plan): string`
  - `interface PlanIssue { path: string; code: string; message: string }`, `validatePlan(plan: Plan): PlanIssue[]`
  - `interface PlanDiff { added: string[]; removed: string[]; changed: { targetField: string; before: MappingCore; after: MappingCore }[]; unmappedAdded: string[]; unmappedRemoved: string[]; identical: boolean }`, `diffPlans(a: Plan, b: Plan): PlanDiff`
  - `REFERENCE_PLAN: Plan` (from `@/seed/reference-plan`)

- [ ] **Step 1: Write failing tests** — `tests/unit/domain/plan.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { diffPlans, planHash, planSchema, validatePlan, versionContentSchema, type Plan } from '@/domain/plan';
import { REFERENCE_PLAN } from '@/seed/reference-plan';

const clone = (): Plan => structuredClone(REFERENCE_PLAN);
const codes = (plan: Plan) => validatePlan(plan).map((i) => i.code);

describe('reference plan', () => {
  it('parses and validates with no issues', () => {
    expect(planSchema.parse(REFERENCE_PLAN)).toBeTruthy();
    expect(validatePlan(REFERENCE_PLAN)).toEqual([]);
  });
});

describe('validatePlan', () => {
  it('flags unknown target, source, rule and bad params', () => {
    const p = clone();
    p.mappings[0].targetField = 'nope';
    p.mappings[1].sourceField = 'nope';
    p.mappings[2].transforms.push({ rule: 'uppercase', params: {} });
    p.mappings[5].transforms[1] = { rule: 'parse_date', params: { formats: [] } };
    const c = codes(p);
    expect(c).toContain('UNKNOWN_TARGET_FIELD');
    expect(c).toContain('UNKNOWN_SOURCE_FIELD');
    expect(c).toContain('UNKNOWN_RULE');
    expect(c).toContain('INVALID_PARAMS');
    expect(c).toContain('MISSING_TARGET_MAPPING'); // legacy_id lost its mapping
  });
  it('flags duplicate target mappings', () => {
    const p = clone();
    p.mappings.push(structuredClone(p.mappings[3]));
    expect(codes(p)).toContain('DUPLICATE_TARGET_MAPPING');
  });
  it('requires required/default_value on required targets and default_value on constants', () => {
    const p = clone();
    const email = p.mappings.find((m) => m.targetField === 'email')!;
    email.transforms = email.transforms.filter((t) => t.rule !== 'required');
    const opt = p.mappings.find((m) => m.targetField === 'marketing_opt_in')!;
    opt.transforms = [];
    expect(codes(p)).toEqual(
      expect.arrayContaining(['REQUIRED_NOT_ENFORCED', 'CONSTANT_WITHOUT_DEFAULT']),
    );
  });
  it('requires every source field to be mapped or dropped, not both', () => {
    const p = clone();
    p.unmappedSourceFields = [];
    expect(codes(p)).toContain('SOURCE_FIELD_UNACCOUNTED');
    const q = clone();
    q.unmappedSourceFields.push({ field: 'email', decision: 'drop', reason: 'x' });
    expect(codes(q)).toContain('SOURCE_FIELD_BOTH');
  });
  it('flags schema version mismatch', () => {
    const p = clone();
    p.targetSchemaVersion = 'target-v0';
    expect(codes(p)).toContain('SCHEMA_VERSION_MISMATCH');
  });
});

describe('planHash', () => {
  it('ignores mapping order, rationale and confidence', () => {
    const p = clone();
    p.mappings.reverse();
    p.mappings[0].rationale = 'changed';
    p.mappings[0].confidence = 'low';
    expect(planHash(p)).toBe(planHash(REFERENCE_PLAN));
  });
  it('treats explicit default params the same as omitted ones', () => {
    const p = clone();
    const status = p.mappings.find((m) => m.targetField === 'status')!;
    const mv = status.transforms.find((t) => t.rule === 'map_values')!;
    delete (mv.params as Record<string, unknown>).caseInsensitive;
    expect(planHash(p)).toBe(planHash(REFERENCE_PLAN));
  });
  it('changes when a transform param changes', () => {
    const p = clone();
    p.mappings.find((m) => m.targetField === 'phone_e164')!.transforms[1].params = { defaultCountry: 'GB' };
    expect(planHash(p)).not.toBe(planHash(REFERENCE_PLAN));
  });
});

describe('diffPlans', () => {
  it('reports identical plans', () => {
    expect(diffPlans(REFERENCE_PLAN, clone()).identical).toBe(true);
  });
  it('reports changed, removed and unmapped changes', () => {
    const p = clone();
    p.mappings.find((m) => m.targetField === 'phone_e164')!.transforms[1].params = { defaultCountry: 'GB' };
    p.mappings = p.mappings.filter((m) => m.targetField !== 'country_code');
    p.unmappedSourceFields.push({ field: 'country', decision: 'drop', reason: 'not needed' });
    const d = diffPlans(REFERENCE_PLAN, p);
    expect(d.changed.map((c) => c.targetField)).toEqual(['phone_e164']);
    expect(d.removed).toEqual(['country_code']);
    expect(d.unmappedAdded).toEqual(['country']);
    expect(d.identical).toBe(false);
  });
});

describe('versionContentSchema', () => {
  it('applies defaults for metadata arrays', () => {
    const c = versionContentSchema.parse({ plan: REFERENCE_PLAN });
    expect(c).toMatchObject({ risks: [], incompatibilities: [], questions: [], summary: '' });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project unit tests/unit/domain/plan.test.ts`
Expected: FAIL — cannot resolve `@/domain/plan`.

- [ ] **Step 3: Implement**

`src/domain/plan/schema.ts`:

```ts
import { z } from 'zod';

export const transformStepSchema = z.object({
  rule: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
});

export const mappingSchema = z.object({
  targetField: z.string().min(1),
  sourceField: z.string().min(1).nullable(),
  transforms: z.array(transformStepSchema).default([]),
  rationale: z.string().max(1000).optional(),
  confidence: z.enum(['high', 'medium', 'low']).optional(),
});

export const planSchema = z.object({
  sourceSchemaVersion: z.string(),
  targetSchemaVersion: z.string(),
  mappings: z.array(mappingSchema),
  unmappedSourceFields: z
    .array(z.object({ field: z.string(), decision: z.literal('drop'), reason: z.string().min(1).max(500) }))
    .default([]),
});

export const riskSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(['high', 'medium', 'low']),
  fields: z.array(z.string()).default([]),
  description: z.string().min(1).max(1000),
  evidenceStepIds: z.array(z.number().int()).default([]),
});

export const incompatibilitySchema = z.object({
  field: z.string(),
  side: z.enum(['source', 'target']),
  kind: z.enum(['missing', 'type_mismatch', 'no_target', 'no_source']),
  description: z.string().max(1000),
});

export const questionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1).max(1000),
  blocking: z.boolean(),
  relatedFields: z.array(z.string()).default([]),
  suggestedOptions: z.array(z.string()).default([]),
  assumption: z.string().max(1000).default(''),
  answer: z.string().max(2000).optional(),
});

export const versionContentSchema = z.object({
  plan: planSchema,
  risks: z.array(riskSchema).default([]),
  incompatibilities: z.array(incompatibilitySchema).default([]),
  questions: z.array(questionSchema).default([]),
  summary: z.string().max(4000).default(''),
});

export type TransformStep = z.infer<typeof transformStepSchema>;
export type Mapping = z.infer<typeof mappingSchema>;
export type Plan = z.infer<typeof planSchema>;
export type Risk = z.infer<typeof riskSchema>;
export type Incompatibility = z.infer<typeof incompatibilitySchema>;
export type Question = z.infer<typeof questionSchema>;
export type VersionContent = z.infer<typeof versionContentSchema>;
```

`src/domain/plan/hash.ts`:

```ts
import { hashOf } from '../hash';
import { getRule } from '../rules';
import type { Plan } from './schema';

export interface MappingCore {
  targetField: string;
  sourceField: string | null;
  transforms: { rule: string; params: unknown }[];
}

function normaliseParams(rule: string, params: unknown): unknown {
  const def = getRule(rule);
  if (!def) return params;
  const parsed = def.params.safeParse(params ?? {});
  return parsed.success ? parsed.data : params;
}

/** The part of a plan that determines execution. Metadata (rationale, confidence) is excluded. */
export function executablePlan(plan: Plan) {
  return {
    sourceSchemaVersion: plan.sourceSchemaVersion,
    targetSchemaVersion: plan.targetSchemaVersion,
    mappings: [...plan.mappings]
      .sort((a, b) => a.targetField.localeCompare(b.targetField))
      .map<MappingCore>((m) => ({
        targetField: m.targetField,
        sourceField: m.sourceField,
        transforms: m.transforms.map((t) => ({ rule: t.rule, params: normaliseParams(t.rule, t.params) })),
      })),
    unmappedSourceFields: [...plan.unmappedSourceFields]
      .sort((a, b) => a.field.localeCompare(b.field))
      .map((u) => ({ field: u.field, decision: u.decision })),
  };
}

export function planHash(plan: Plan): string {
  return hashOf(executablePlan(plan));
}
```

`src/domain/plan/validate.ts`:

```ts
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
```

`src/domain/plan/diff.ts`:

```ts
import { canonicalJson } from '../hash';
import { executablePlan, type MappingCore } from './hash';
import type { Plan } from './schema';

export interface PlanDiff {
  added: string[];
  removed: string[];
  changed: { targetField: string; before: MappingCore; after: MappingCore }[];
  unmappedAdded: string[];
  unmappedRemoved: string[];
  identical: boolean;
}

export function diffPlans(a: Plan, b: Plan): PlanDiff {
  const ea = executablePlan(a);
  const eb = executablePlan(b);
  const before = new Map(ea.mappings.map((m) => [m.targetField, m]));
  const after = new Map(eb.mappings.map((m) => [m.targetField, m]));
  const added = [...after.keys()].filter((k) => !before.has(k));
  const removed = [...before.keys()].filter((k) => !after.has(k));
  const changed = [...after.entries()]
    .filter(([k, m]) => before.has(k) && canonicalJson(before.get(k)) !== canonicalJson(m))
    .map(([k, m]) => ({ targetField: k, before: before.get(k)!, after: m }));
  const ua = new Set(ea.unmappedSourceFields.map((u) => u.field));
  const ub = new Set(eb.unmappedSourceFields.map((u) => u.field));
  const unmappedAdded = [...ub].filter((f) => !ua.has(f));
  const unmappedRemoved = [...ua].filter((f) => !ub.has(f));
  return {
    added, removed, changed, unmappedAdded, unmappedRemoved,
    identical: !added.length && !removed.length && !changed.length && !unmappedAdded.length && !unmappedRemoved.length,
  };
}
```

`src/domain/plan/index.ts`:

```ts
export * from './schema';
export * from './hash';
export * from './validate';
export * from './diff';
```

`src/seed/reference-plan.ts`:

```ts
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
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run --project unit tests/unit/domain/plan.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/plan src/seed/reference-plan.ts tests/unit/domain/plan.test.ts && git commit -m "feat(domain): plan schema, executable hash, validation, diff, reference plan"
```

---

### Task 5: Deterministic engine — transform, validate, dry run, profiling, transformation tests

**Files:**
- Create: `src/domain/engine/compile.ts`, `src/domain/engine/transform.ts`, `src/domain/engine/validate-target.ts`, `src/domain/engine/dry-run.ts`, `src/domain/engine/profile.ts`, `src/domain/engine/test-transformation.ts`, `src/domain/engine/index.ts`
- Test: `tests/unit/domain/engine.test.ts`, `tests/unit/domain/profile.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4
- Produces:
  - `class InvalidPlanError extends Error { issues: PlanIssue[] }`
  - `interface CompiledStep { ruleName: string; rule: RuleDef<unknown>; params: unknown }`, `interface CompiledMapping { targetField: TargetField; sourceField: string | null; steps: CompiledStep[] }`, `compilePlan(plan: Plan): CompiledMapping[]`
  - `runPipeline(value: Scalar, steps: CompiledStep[]): { ok: true; value: Scalar } | { ok: false; rule: string; code: string; message: string }`
  - `transformRecord(raw, mappings): { row: Partial<TargetRow>; errors: FieldError[] }`
  - `validateTargetValue(def: TargetFieldDef, value: Scalar): { code: string; message: string } | null`
  - `validateTargetRow(row: TargetRow, raw, mappings): FieldError[]`
  - `rowHash(row: TargetRow): string`
  - `interface AcceptedRow { seq: number; legacyId: string; row: TargetRow; rowHash: string }`
  - `interface QuarantineEntry { seq: number; legacyKey: string | null; stage: RejectionStage; errors: FieldError[]; raw: Record<string, unknown> }`
  - `interface DryRunCounts { source: number; transformed: number; accepted: number; rejected: number; rejectedByStage: Record<RejectionStage, number> }`
  - `interface DryRunReport { planHash: string; counts: DryRunCounts; accepted: AcceptedRow[]; quarantine: QuarantineEntry[]; reportHash: string }`
  - `dryRun(input: { records: SourceRecordInput[]; plan: Plan; preexistingEmails: readonly string[] }): DryRunReport`
  - `profileField(records: SourceRecordInput[], field: string): FieldProfile` where `FieldProfile = { field; total; nullCount; nullRate; distinctCount; topValues: { value: string; count: number }[]; patterns: { pattern: string; count: number; example: string }[] }`
  - `testTransformation(records, input: { sourceField: string | null; targetField: string; transforms: TransformStep[] }): TransformationTestResult | { issues: PlanIssue[] }` where `TransformationTestResult = { total; passed; failed; failureCodes: Record<string, number>; failures: { seq; sourceValue: string | null; code; message }[]; samples: { seq; sourceValue: string | null; output: Scalar }[] }`

- [ ] **Step 1: Write failing tests**

`tests/unit/domain/engine.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { dryRun, InvalidPlanError, testTransformation } from '@/domain/engine';
import { MAX_SOURCE_RECORDS } from '@/domain/limits';
import type { SourceRecordInput } from '@/domain/types';
import { REFERENCE_PLAN } from '@/seed/reference-plan';

const good = (seq: number, overrides: Record<string, string> = {}): SourceRecordInput => ({
  seq,
  raw: {
    cust_id: `C-${String(seq).padStart(5, '0')}`,
    full_name: 'John Smith',
    email: `john${seq}@example.com`,
    phone: '+44 20 7946 0018',
    signup_date: '2019-03-14',
    status: 'A',
    country: 'USA',
    lifetime_value: '$1,234.50',
    is_vip: 'Y',
    notes: '',
    ...overrides,
  },
});

const run = (records: SourceRecordInput[], preexistingEmails: string[] = []) =>
  dryRun({ records, plan: REFERENCE_PLAN, preexistingEmails });

describe('dryRun', () => {
  it('accepts a clean record and produces the expected target row', () => {
    const r = run([good(1)]);
    expect(r.counts).toMatchObject({ source: 1, transformed: 1, accepted: 1, rejected: 0 });
    expect(r.accepted[0].row).toEqual({
      legacy_id: 'C-00001', first_name: 'John', last_name: 'Smith', email: 'john1@example.com',
      phone_e164: '+442079460018', created_on: '2019-03-14', status: 'active', country_code: 'US',
      lifetime_value_cents: 123450, is_vip: true, marketing_opt_in: false,
    });
    expect(r.accepted[0].rowHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('collects every field error with source evidence', () => {
    const r = run([good(1, { signup_date: '2019-02-30', lifetime_value: 'N/A', status: 'S' })]);
    expect(r.counts).toMatchObject({ accepted: 0, rejected: 1 });
    const q = r.quarantine[0];
    expect(q.stage).toBe('TRANSFORM_ERROR');
    expect(q.legacyKey).toBe('C-00001');
    expect(q.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetField: 'created_on', sourceField: 'signup_date', sourceValue: '2019-02-30', rule: 'parse_date', code: 'INVALID_DATE' }),
      expect.objectContaining({ targetField: 'lifetime_value_cents', code: 'INVALID_NUMBER' }),
      expect.objectContaining({ targetField: 'status', code: 'UNMAPPED_VALUE', sourceValue: 'S' }),
    ]));
  });

  it('flags target validation failures (bad email format)', () => {
    const r = run([good(1, { email: 'not-an-email' })]);
    expect(r.quarantine[0]).toMatchObject({ stage: 'VALIDATION_ERROR' });
    expect(r.quarantine[0].errors[0]).toMatchObject({ targetField: 'email', code: 'INVALID_FORMAT', sourceValue: 'not-an-email' });
  });

  it('first valid occurrence of a legacy key wins; later ones are DUPLICATE_SOURCE_KEY', () => {
    const r = run([good(1), good(2, { cust_id: 'C-00001', email: 'other@example.com' })]);
    expect(r.counts.accepted).toBe(1);
    expect(r.quarantine[0]).toMatchObject({ seq: 2, stage: 'DUPLICATE_SOURCE_KEY' });
    expect(r.quarantine[0].errors[0].message).toContain('#1');
  });

  it('rejects duplicate emails within the batch, case-insensitively', () => {
    const r = run([good(1), good(2, { email: 'JOHN1@example.com' })]);
    expect(r.quarantine[0]).toMatchObject({ seq: 2, stage: 'VALIDATION_ERROR' });
    expect(r.quarantine[0].errors[0].code).toBe('DUPLICATE_IN_BATCH');
  });

  it('rejects emails that already exist in the target as TARGET_CONFLICT', () => {
    const r = run([good(1)], ['John1@Example.com']);
    expect(r.quarantine[0]).toMatchObject({ stage: 'TARGET_CONFLICT' });
    expect(r.quarantine[0].errors[0].code).toBe('EMAIL_EXISTS_IN_TARGET');
  });

  it('accepts unicode names and plus-addressed emails (review focus 1)', () => {
    const r = run([good(1, { full_name: "José Núñez O'Brien", email: 'a+b@x.io' })]);
    expect(r.accepted[0].row).toMatchObject({ first_name: 'José', last_name: "Núñez O'Brien", email: 'a+b@x.io' });
  });

  it('is deterministic regardless of input order', () => {
    const records = [good(1), good(2, { status: 'S' }), good(3)];
    const a = run(records);
    const b = run([...records].reverse());
    expect(a.reportHash).toBe(b.reportHash);
    expect(a.counts).toEqual(b.counts);
  });

  it('balances counts: source = accepted + rejected, stages sum to rejected', () => {
    const r = run([good(1), good(2, { email: '' }), good(3, { cust_id: 'C-00001', email: 'z@z.io' })]);
    const byStage = Object.values(r.counts.rejectedByStage).reduce((a, b) => a + b, 0);
    expect(r.counts.source).toBe(r.counts.accepted + r.counts.rejected);
    expect(byStage).toBe(r.counts.rejected);
  });

  it('refuses invalid plans and oversize inputs', () => {
    const bad = structuredClone(REFERENCE_PLAN);
    bad.mappings = [];
    expect(() => dryRun({ records: [good(1)], plan: bad, preexistingEmails: [] })).toThrow(InvalidPlanError);
    const many = Array.from({ length: MAX_SOURCE_RECORDS + 1 }, (_, i) => good(i + 1));
    expect(() => run(many)).toThrow(/maximum/);
  });
});

describe('testTransformation', () => {
  it('reports pass/fail counts, codes, failures and samples for one field', () => {
    const records = [good(1), good(2, { signup_date: '31/31/2020' }), good(3, { signup_date: '14-Mar-2019' })];
    const r = testTransformation(records, {
      sourceField: 'signup_date', targetField: 'created_on',
      transforms: [{ rule: 'parse_date', params: { formats: ['YYYY-MM-DD', 'DD-MMM-YYYY'] } }, { rule: 'required', params: {} }],
    });
    if ('issues' in r) throw new Error('unexpected issues');
    expect(r).toMatchObject({ total: 3, passed: 2, failed: 1, failureCodes: { INVALID_DATE: 1 } });
    expect(r.failures[0]).toMatchObject({ seq: 2, sourceValue: '31/31/2020' });
    expect(r.samples[0]).toMatchObject({ seq: 1, output: '2019-03-14' });
  });
  it('also applies target constraints (enum)', () => {
    const r = testTransformation([good(1)], { sourceField: 'status', targetField: 'status', transforms: [] });
    if ('issues' in r) throw new Error('unexpected issues');
    expect(r.failureCodes).toEqual({ INVALID_ENUM: 1 });
  });
  it('returns issues for unknown fields or rules instead of throwing', () => {
    const r = testTransformation([good(1)], { sourceField: 'nope', targetField: 'email', transforms: [{ rule: 'x', params: {} }] });
    expect('issues' in r && r.issues.map((i) => i.code)).toEqual(['UNKNOWN_SOURCE_FIELD', 'UNKNOWN_RULE']);
  });
});
```

`tests/unit/domain/profile.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { profileField } from '@/domain/engine';

const recs = (values: (string | null)[]) => values.map((v, i) => ({ seq: i + 1, raw: { signup_date: v } }));

describe('profileField', () => {
  it('counts nulls, distinct values and top values', () => {
    const p = profileField(recs(['a', 'a', 'b', null, '  ']), 'signup_date');
    expect(p).toMatchObject({ total: 5, nullCount: 2, nullRate: 0.4, distinctCount: 2 });
    expect(p.topValues[0]).toEqual({ value: 'a', count: 2 });
  });
  it('labels slash dates as ambiguous, day-first or month-first', () => {
    const p = profileField(recs(['04/05/2019', '14/03/2019', '03/14/2019', '2019-03-14']), 'signup_date');
    const labels = p.patterns.map((x) => x.pattern);
    expect(labels).toEqual(expect.arrayContaining([
      '99/99/9999 [ambiguous: both parts <= 12]',
      '99/99/9999 [day-first: first part > 12]',
      '99/99/9999 [month-first: second part > 12]',
      '9999-99-99',
    ]));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project unit tests/unit/domain/engine.test.ts tests/unit/domain/profile.test.ts`
Expected: FAIL — cannot resolve `@/domain/engine`.

- [ ] **Step 3: Implement**

`src/domain/engine/compile.ts`:

```ts
import { validatePlan, type Plan, type PlanIssue } from '../plan';
import { getRule, type RuleDef } from '../rules';
import { TARGET_FIELD_NAMES, type TargetField } from '../schemas/target';

export class InvalidPlanError extends Error {
  constructor(public readonly issues: PlanIssue[]) {
    super(`Plan is invalid: ${issues.map((i) => i.code).join(', ')}`);
    this.name = 'InvalidPlanError';
  }
}

export interface CompiledStep {
  ruleName: string;
  rule: RuleDef<unknown>;
  params: unknown;
}

export interface CompiledMapping {
  targetField: TargetField;
  sourceField: string | null;
  steps: CompiledStep[];
}

/** Validates the plan and pre-parses rule params. Output is ordered by target schema order. */
export function compilePlan(plan: Plan): CompiledMapping[] {
  const issues = validatePlan(plan);
  if (issues.length) throw new InvalidPlanError(issues);
  return [...plan.mappings]
    .sort((a, b) => TARGET_FIELD_NAMES.indexOf(a.targetField as TargetField) - TARGET_FIELD_NAMES.indexOf(b.targetField as TargetField))
    .map((m) => ({
      targetField: m.targetField as TargetField,
      sourceField: m.sourceField,
      steps: m.transforms.map((t) => {
        const rule = getRule(t.rule)!;
        return { ruleName: t.rule, rule, params: rule.params.parse(t.params ?? {}) };
      }),
    }));
}
```

`src/domain/engine/transform.ts`:

```ts
import { extractField } from '../schemas/source';
import type { TargetRow } from '../schemas/target';
import type { FieldError, Scalar } from '../types';
import type { CompiledMapping, CompiledStep } from './compile';

export type PipelineResult =
  | { ok: true; value: Scalar }
  | { ok: false; rule: string; code: string; message: string };

export function runPipeline(value: Scalar, steps: CompiledStep[]): PipelineResult {
  let current = value;
  for (const step of steps) {
    const result = step.rule.apply(current, step.params);
    if (!result.ok) return { ok: false, rule: step.ruleName, code: result.code, message: result.message };
    current = result.value;
  }
  return { ok: true, value: current };
}

export function transformRecord(
  raw: Record<string, unknown>,
  mappings: CompiledMapping[],
): { row: Partial<TargetRow>; errors: FieldError[] } {
  const row: Partial<TargetRow> = {};
  const errors: FieldError[] = [];
  for (const m of mappings) {
    const sourceValue = m.sourceField ? extractField(raw, m.sourceField) : null;
    const result = runPipeline(sourceValue, m.steps);
    if (result.ok) row[m.targetField] = result.value;
    else errors.push({ targetField: m.targetField, sourceField: m.sourceField, sourceValue,
      rule: result.rule, code: result.code, message: result.message });
  }
  return { row, errors };
}
```

`src/domain/engine/validate-target.ts`:

```ts
import { extractField } from '../schemas/source';
import { TARGET_FIELDS, type TargetFieldDef, type TargetRow } from '../schemas/target';
import type { FieldError, Scalar } from '../types';
import type { CompiledMapping } from './compile';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const E164_RE = /^\+[1-9]\d{6,14}$/;
const ISO2_RE = /^[A-Z]{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateTargetValue(def: TargetFieldDef, value: Scalar): { code: string; message: string } | null {
  if (value === null) {
    return def.required ? { code: 'REQUIRED', message: `${def.name} is required` } : null;
  }
  switch (def.type) {
    case 'string':
    case 'enum':
      if (typeof value !== 'string') return { code: 'TYPE_MISMATCH', message: `${def.name} must be text` };
      break;
    case 'date':
      if (typeof value !== 'string' || !DATE_RE.test(value)) return { code: 'TYPE_MISMATCH', message: `${def.name} must be YYYY-MM-DD` };
      break;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) return { code: 'TYPE_MISMATCH', message: `${def.name} must be a whole number` };
      break;
    case 'boolean':
      if (typeof value !== 'boolean') return { code: 'TYPE_MISMATCH', message: `${def.name} must be true or false` };
      break;
  }
  if (typeof value === 'string') {
    if (def.maxLength && value.length > def.maxLength) return { code: 'MAX_LENGTH', message: `${def.name} exceeds ${def.maxLength} characters` };
    if (def.enumValues && !def.enumValues.includes(value)) return { code: 'INVALID_ENUM', message: `${def.name} must be one of ${def.enumValues.join(', ')}` };
    const re = def.format === 'email' ? EMAIL_RE : def.format === 'e164' ? E164_RE : def.format === 'iso2' ? ISO2_RE : null;
    if (re && !re.test(value)) return { code: 'INVALID_FORMAT', message: `${def.name} is not a valid ${def.format}` };
  }
  if (typeof value === 'number') {
    if (def.min !== undefined && value < def.min) return { code: 'BELOW_MIN', message: `${def.name} must be >= ${def.min}` };
    if (def.max !== undefined && value > def.max) return { code: 'ABOVE_MAX', message: `${def.name} must be <= ${def.max}` };
  }
  return null;
}

export function validateTargetRow(row: TargetRow, raw: Record<string, unknown>, mappings: CompiledMapping[]): FieldError[] {
  const sourceOf = new Map(mappings.map((m) => [m.targetField, m.sourceField]));
  const errors: FieldError[] = [];
  for (const def of TARGET_FIELDS) {
    const problem = validateTargetValue(def, row[def.name] ?? null);
    if (problem) {
      const sourceField = sourceOf.get(def.name) ?? null;
      errors.push({ targetField: def.name, sourceField, sourceValue: sourceField ? extractField(raw, sourceField) : null,
        rule: null, ...problem });
    }
  }
  return errors;
}
```

`src/domain/engine/dry-run.ts`:

```ts
import { hashOf } from '../hash';
import { MAX_SOURCE_RECORDS } from '../limits';
import { planHash, type Plan } from '../plan';
import { extractField } from '../schemas/source';
import { TARGET_FIELD_NAMES, type TargetRow } from '../schemas/target';
import { LimitExceededError, REJECTION_STAGES, type FieldError, type RejectionStage, type SourceRecordInput } from '../types';
import { compilePlan } from './compile';
import { transformRecord } from './transform';
import { validateTargetRow } from './validate-target';

export interface AcceptedRow { seq: number; legacyId: string; row: TargetRow; rowHash: string }
export interface QuarantineEntry {
  seq: number;
  legacyKey: string | null;
  stage: RejectionStage;
  errors: FieldError[];
  raw: Record<string, unknown>;
}
export interface DryRunCounts {
  source: number;
  transformed: number;
  accepted: number;
  rejected: number;
  rejectedByStage: Record<RejectionStage, number>;
}
export interface DryRunReport {
  planHash: string;
  counts: DryRunCounts;
  accepted: AcceptedRow[];
  quarantine: QuarantineEntry[];
  reportHash: string;
}

export function rowHash(row: TargetRow): string {
  return hashOf(TARGET_FIELD_NAMES.map((f) => [f, row[f] ?? null]));
}

export function dryRun(input: {
  records: SourceRecordInput[];
  plan: Plan;
  preexistingEmails: readonly string[];
}): DryRunReport {
  if (input.records.length > MAX_SOURCE_RECORDS) {
    throw new LimitExceededError(`Dataset has ${input.records.length} records; the maximum is ${MAX_SOURCE_RECORDS}`);
  }
  const mappings = compilePlan(input.plan);
  const legacySource = mappings.find((m) => m.targetField === 'legacy_id')?.sourceField ?? null;
  const emailSource = mappings.find((m) => m.targetField === 'email')?.sourceField ?? null;
  const preexisting = new Set(input.preexistingEmails.map((e) => e.toLowerCase()));
  const seenLegacy = new Map<string, number>();
  const seenEmail = new Map<string, number>();
  const accepted: AcceptedRow[] = [];
  const quarantine: QuarantineEntry[] = [];
  let transformed = 0;

  const records = [...input.records].sort((a, b) => a.seq - b.seq);
  for (const rec of records) {
    const legacyKey = extractField(rec.raw, 'cust_id');
    const reject = (stage: RejectionStage, errors: FieldError[]) =>
      quarantine.push({ seq: rec.seq, legacyKey, stage, errors, raw: rec.raw });

    const { row, errors } = transformRecord(rec.raw, mappings);
    if (errors.length) { reject('TRANSFORM_ERROR', errors); continue; }
    transformed += 1;

    const full = row as TargetRow;
    const invalid = validateTargetRow(full, rec.raw, mappings);
    if (invalid.length) { reject('VALIDATION_ERROR', invalid); continue; }

    // Keys are claimed by the first record that passes transformation and validation.
    const legacyId = String(full.legacy_id);
    const firstLegacy = seenLegacy.get(legacyId);
    if (firstLegacy !== undefined) {
      reject('DUPLICATE_SOURCE_KEY', [{ targetField: 'legacy_id', sourceField: legacySource,
        sourceValue: legacySource ? extractField(rec.raw, legacySource) : null, rule: null,
        code: 'DUPLICATE_SOURCE_KEY', message: `legacy_id "${legacyId}" already used by record #${firstLegacy}` }]);
      continue;
    }
    seenLegacy.set(legacyId, rec.seq);

    const emailKey = String(full.email).toLowerCase();
    const emailEvidence = { targetField: 'email', sourceField: emailSource,
      sourceValue: emailSource ? extractField(rec.raw, emailSource) : null, rule: null };
    const firstEmail = seenEmail.get(emailKey);
    if (firstEmail !== undefined) {
      reject('VALIDATION_ERROR', [{ ...emailEvidence, code: 'DUPLICATE_IN_BATCH',
        message: `email "${emailKey}" already used by record #${firstEmail}` }]);
      continue;
    }
    seenEmail.set(emailKey, rec.seq);

    if (preexisting.has(emailKey)) {
      reject('TARGET_CONFLICT', [{ ...emailEvidence, code: 'EMAIL_EXISTS_IN_TARGET',
        message: `email "${emailKey}" already belongs to an existing target customer` }]);
      continue;
    }
    accepted.push({ seq: rec.seq, legacyId, row: full, rowHash: rowHash(full) });
  }

  const rejectedByStage = Object.fromEntries(REJECTION_STAGES.map((s) => [s, 0])) as Record<RejectionStage, number>;
  for (const q of quarantine) rejectedByStage[q.stage] += 1;
  const counts: DryRunCounts = {
    source: records.length, transformed, accepted: accepted.length, rejected: quarantine.length, rejectedByStage,
  };
  const pHash = planHash(input.plan);
  const reportHash = hashOf({
    planHash: pHash,
    counts,
    accepted: accepted.map((a) => [a.seq, a.rowHash]),
    quarantine: quarantine.map((q) => [q.seq, q.stage, q.errors]),
  });
  return { planHash: pHash, counts, accepted, quarantine, reportHash };
}
```

`src/domain/engine/profile.ts`:

```ts
import { extractField } from '../schemas/source';
import type { SourceRecordInput } from '../types';

export interface FieldProfile {
  field: string;
  total: number;
  nullCount: number;
  nullRate: number;
  distinctCount: number;
  topValues: { value: string; count: number }[];
  patterns: { pattern: string; count: number; example: string }[];
}

function shape(value: string): string {
  return value.replace(/[A-Za-zÀ-ɏ]+/g, 'A').replace(/\d/g, '9');
}

function slashDateHint(value: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a > 12 && b <= 12) return 'day-first: first part > 12';
  if (b > 12 && a <= 12) return 'month-first: second part > 12';
  if (a <= 12 && b <= 12) return 'ambiguous: both parts <= 12';
  return 'invalid: both parts > 12';
}

function tally(values: string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
}

export function profileField(records: SourceRecordInput[], field: string): FieldProfile {
  const values = records.map((r) => extractField(r.raw, field));
  const present = values.filter((v): v is string => v !== null);
  const examples = new Map<string, string>();
  const patternOf = (v: string) => {
    const hint = slashDateHint(v);
    const p = hint ? `${shape(v.trim())} [${hint}]` : shape(v.trim());
    if (!examples.has(p)) examples.set(p, v);
    return p;
  };
  const patterns = tally(present.map(patternOf));
  return {
    field,
    total: values.length,
    nullCount: values.length - present.length,
    nullRate: values.length ? Math.round(((values.length - present.length) / values.length) * 100) / 100 : 0,
    distinctCount: new Set(present).size,
    topValues: tally(present).slice(0, 15).map(([value, count]) => ({ value, count })),
    patterns: patterns.slice(0, 15).map(([pattern, count]) => ({ pattern, count, example: examples.get(pattern)! })),
  };
}
```

`src/domain/engine/test-transformation.ts`:

```ts
import type { PlanIssue, TransformStep } from '../plan';
import { getRule } from '../rules';
import { extractField, isSourceField } from '../schemas/source';
import { getTargetField } from '../schemas/target';
import type { Scalar, SourceRecordInput } from '../types';
import type { CompiledStep } from './compile';
import { runPipeline } from './transform';
import { validateTargetValue } from './validate-target';

export interface TransformationTestResult {
  total: number;
  passed: number;
  failed: number;
  failureCodes: Record<string, number>;
  failures: { seq: number; sourceValue: string | null; code: string; message: string }[];
  samples: { seq: number; sourceValue: string | null; output: Scalar }[];
}

export function testTransformation(
  records: SourceRecordInput[],
  input: { sourceField: string | null; targetField: string; transforms: TransformStep[] },
): TransformationTestResult | { issues: PlanIssue[] } {
  const issues: PlanIssue[] = [];
  const target = getTargetField(input.targetField);
  if (!target) issues.push({ path: 'targetField', code: 'UNKNOWN_TARGET_FIELD', message: `Unknown target field "${input.targetField}"` });
  if (input.sourceField !== null && !isSourceField(input.sourceField)) {
    issues.push({ path: 'sourceField', code: 'UNKNOWN_SOURCE_FIELD', message: `Unknown source field "${input.sourceField}"` });
  }
  const steps: CompiledStep[] = [];
  input.transforms.forEach((t, i) => {
    const rule = getRule(t.rule);
    if (!rule) { issues.push({ path: `transforms[${i}]`, code: 'UNKNOWN_RULE', message: `Unknown rule "${t.rule}"` }); return; }
    const parsed = rule.params.safeParse(t.params ?? {});
    if (!parsed.success) { issues.push({ path: `transforms[${i}].params`, code: 'INVALID_PARAMS', message: parsed.error.issues.map((x) => x.message).join('; ') }); return; }
    steps.push({ ruleName: t.rule, rule, params: parsed.data });
  });
  if (issues.length || !target) return { issues };

  const result: TransformationTestResult = { total: 0, passed: 0, failed: 0, failureCodes: {}, failures: [], samples: [] };
  for (const rec of [...records].sort((a, b) => a.seq - b.seq)) {
    result.total += 1;
    const sourceValue = input.sourceField ? extractField(rec.raw, input.sourceField) : null;
    const out = runPipeline(sourceValue, steps);
    const problem = out.ok ? validateTargetValue(target, out.value) : { code: out.code, message: out.message };
    if (problem) {
      result.failed += 1;
      result.failureCodes[problem.code] = (result.failureCodes[problem.code] ?? 0) + 1;
      if (result.failures.length < 5) result.failures.push({ seq: rec.seq, sourceValue, ...problem });
    } else {
      result.passed += 1;
      if (result.samples.length < 5 && out.ok) result.samples.push({ seq: rec.seq, sourceValue, output: out.value });
    }
  }
  return result;
}
```

`src/domain/engine/index.ts`:

```ts
export * from './compile';
export * from './transform';
export * from './validate-target';
export * from './dry-run';
export * from './profile';
export * from './test-transformation';
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run --project unit tests/unit/domain`
Expected: PASS (all domain tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/engine tests/unit/domain && git commit -m "feat(domain): deterministic dry-run engine, profiling and transformation testing"
```

---

### Task 6: Reconciliation (pure)

**Files:**
- Create: `src/domain/reconcile.ts`
- Test: `tests/unit/domain/reconcile.test.ts`

**Interfaces:**
- Consumes: `DryRunReport`, `rowHash`, `TargetRow`
- Produces:
  - `type ReconcileCheckId = 'source_balance' | 'row_count' | 'control_total' | 'per_record' | 'preexisting_untouched'`
  - `interface ReconcileCheck { id: ReconcileCheckId; label: string; passed: boolean; expected: string | number; actual: string | number; detail?: string }`
  - `interface ReconcileInput { sourceCount: number; report: DryRunReport | null; migrated: { legacyId: string; row: TargetRow }[]; preexistingExpected: TargetRow[]; preexistingActual: TargetRow[] }`
  - `interface ReconcileResult { result: 'pass' | 'fail'; activeMigration: boolean; checks: ReconcileCheck[]; missing: string[]; unexpected: string[]; mismatched: { legacyId: string; expectedHash: string; actualHash: string }[] }`
  - `reconcile(input: ReconcileInput): ReconcileResult`

- [ ] **Step 1: Write failing tests** — `tests/unit/domain/reconcile.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { dryRun } from '@/domain/engine';
import { reconcile } from '@/domain/reconcile';
import type { TargetRow } from '@/domain/schemas/target';
import { REFERENCE_PLAN } from '@/seed/reference-plan';

const rec = (seq: number, extra: Record<string, string> = {}) => ({
  seq,
  raw: { cust_id: `C-${seq}`, full_name: 'Ann Lee', email: `ann${seq}@x.io`, phone: '', signup_date: '2020-01-0' + seq,
    status: 'A', country: 'IN', lifetime_value: '10.00', is_vip: 'N', notes: '', ...extra },
});
const report = dryRun({ records: [rec(1), rec(2), rec(3, { status: 'S' })], plan: REFERENCE_PLAN, preexistingEmails: [] });
const pre: TargetRow = { legacy_id: null, first_name: 'Pre', last_name: 'Existing', email: 'pre@x.io', phone_e164: null,
  created_on: '2024-01-01', status: 'active', country_code: 'US', lifetime_value_cents: 0, is_vip: false, marketing_opt_in: true };
const migratedFrom = (r = report) => r.accepted.map((a) => ({ legacyId: a.legacyId, row: structuredClone(a.row) }));
const base = () => ({ sourceCount: 3, report, migrated: migratedFrom(), preexistingExpected: [pre], preexistingActual: [structuredClone(pre)] });

describe('reconcile', () => {
  it('passes when target matches the expected accepted set', () => {
    const r = reconcile(base());
    expect(r.result).toBe('pass');
    expect(r.checks.every((c) => c.passed)).toBe(true);
    expect(r.checks.map((c) => c.id)).toEqual(['source_balance', 'row_count', 'control_total', 'per_record', 'preexisting_untouched']);
  });
  it('detects a missing row (partial run)', () => {
    const input = base();
    input.migrated.pop();
    const r = reconcile(input);
    expect(r.result).toBe('fail');
    expect(r.missing).toEqual(['C-2']);
  });
  it('detects tampering via recomputed row hashes and control totals', () => {
    const input = base();
    input.migrated[0].row.lifetime_value_cents = 999;
    const r = reconcile(input);
    expect(r.mismatched.map((m) => m.legacyId)).toEqual(['C-1']);
    expect(r.checks.find((c) => c.id === 'control_total')!.passed).toBe(false);
  });
  it('detects unexpected rows and modified pre-existing rows', () => {
    const input = base();
    input.migrated.push({ legacyId: 'C-99', row: { ...input.migrated[0].row, legacy_id: 'C-99' } });
    input.preexistingActual[0].status = 'closed';
    const r = reconcile(input);
    expect(r.unexpected).toEqual(['C-99']);
    expect(r.checks.find((c) => c.id === 'preexisting_untouched')!.passed).toBe(false);
  });
  it('with no active migration, passes only when no migrated rows remain', () => {
    const clean = reconcile({ ...base(), report: null, migrated: [] });
    expect(clean).toMatchObject({ result: 'pass', activeMigration: false });
    const dirty = reconcile({ ...base(), report: null });
    expect(dirty.result).toBe('fail');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project unit tests/unit/domain/reconcile.test.ts`
Expected: FAIL — cannot resolve `@/domain/reconcile`.

- [ ] **Step 3: Implement** — `src/domain/reconcile.ts`:

```ts
import { rowHash, type DryRunReport } from './engine';
import type { TargetRow } from './schemas/target';

export type ReconcileCheckId = 'source_balance' | 'row_count' | 'control_total' | 'per_record' | 'preexisting_untouched';

export interface ReconcileCheck {
  id: ReconcileCheckId;
  label: string;
  passed: boolean;
  expected: string | number;
  actual: string | number;
  detail?: string;
}

export interface ReconcileInput {
  sourceCount: number;
  report: DryRunReport | null;
  migrated: { legacyId: string; row: TargetRow }[];
  preexistingExpected: TargetRow[];
  preexistingActual: TargetRow[];
}

export interface ReconcileResult {
  result: 'pass' | 'fail';
  activeMigration: boolean;
  checks: ReconcileCheck[];
  missing: string[];
  unexpected: string[];
  mismatched: { legacyId: string; expectedHash: string; actualHash: string }[];
}

const cents = (row: TargetRow) => (typeof row.lifetime_value_cents === 'number' ? row.lifetime_value_cents : 0);

export function reconcile(input: ReconcileInput): ReconcileResult {
  const expected = new Map((input.report?.accepted ?? []).map((a) => [a.legacyId, a.rowHash]));
  const actual = new Map(input.migrated.map((m) => [m.legacyId, rowHash(m.row)]));

  const missing = [...expected.keys()].filter((k) => !actual.has(k)).sort();
  const unexpected = [...actual.keys()].filter((k) => !expected.has(k)).sort();
  const mismatched = [...expected.entries()]
    .filter(([k, h]) => actual.has(k) && actual.get(k) !== h)
    .map(([legacyId, expectedHash]) => ({ legacyId, expectedHash, actualHash: actual.get(legacyId)! }))
    .sort((a, b) => a.legacyId.localeCompare(b.legacyId));

  const counts = input.report?.counts;
  const expectedTotal = (input.report?.accepted ?? []).reduce((s, a) => s + cents(a.row), 0);
  const actualTotal = input.migrated.reduce((s, m) => s + cents(m.row), 0);
  const preHash = (rows: TargetRow[]) => rows.map(rowHash).sort().join(',');

  const checks: ReconcileCheck[] = [
    counts
      ? { id: 'source_balance', label: 'Source = accepted + rejected',
          passed: counts.source === input.sourceCount && counts.accepted + counts.rejected === counts.source,
          expected: input.sourceCount, actual: `${counts.accepted} + ${counts.rejected}` }
      : { id: 'source_balance', label: 'Source = accepted + rejected', passed: true, expected: 'n/a', actual: 'n/a',
          detail: 'No active migration' },
    { id: 'row_count', label: 'Accepted rows = migrated rows in target', passed: expected.size === actual.size,
      expected: expected.size, actual: actual.size },
    { id: 'control_total', label: 'Σ lifetime_value_cents matches', passed: expectedTotal === actualTotal,
      expected: expectedTotal, actual: actualTotal },
    { id: 'per_record', label: 'Every row present with identical content',
      passed: !missing.length && !unexpected.length && !mismatched.length, expected: 0,
      actual: missing.length + unexpected.length + mismatched.length,
      detail: `${missing.length} missing, ${unexpected.length} unexpected, ${mismatched.length} mismatched` },
    { id: 'preexisting_untouched', label: 'Pre-existing target rows unchanged',
      passed: preHash(input.preexistingExpected) === preHash(input.preexistingActual),
      expected: input.preexistingExpected.length, actual: input.preexistingActual.length },
  ];

  return {
    result: checks.every((c) => c.passed) ? 'pass' : 'fail',
    activeMigration: input.report !== null,
    checks, missing, unexpected, mismatched,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run --project unit tests/unit/domain`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/reconcile.ts tests/unit/domain/reconcile.test.ts && git commit -m "feat(domain): reconciliation with counts, control totals and per-record hashes"
```

**Phase checkpoint:** update `AGENT_USAGE.md` and give the user the teaching note (What / Why / Likely questions / Likely tweaks).
