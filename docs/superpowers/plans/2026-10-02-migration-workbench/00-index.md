# Migration Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a web workbench where a Gemini agent proposes a migration plan for a bounded legacy-customer dataset, a human approves a specific plan version, and a deterministic engine dry-runs, executes (idempotently), reconciles and rolls back the migration into a mock Postgres target, with full history.

**Architecture:** One Next.js 16 (App Router, TypeScript) app. Pure domain code (`src/domain`) holds rules, plan validation, the engine and reconciliation; services (`src/server/services`) own transactions, locking and audit; the agent (`src/server/agent`) is a bounded tool-calling loop over a provider-neutral LLM interface (Gemini adapter + scripted mock). Postgres holds workbench state (schema `app`) and the mock target store (schema `target`). Deployed via Docker Compose (app + Postgres + Caddy) on EC2.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.9, Tailwind 4 + shadcn/ui, TanStack Query 5, Drizzle ORM 0.45 + postgres-js, zod 4, pino 10, @google/genai 2, libphonenumber-js, Vitest 5, Docker, Caddy, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-02-migration-workbench-design.md`

## Plan files (execute in order)
| File | Tasks |
|---|---|
| `01-foundation-and-domain.md` | 1 Scaffold · 2 Domain basics · 3 Rule catalog · 4 Plan model · 5 Engine · 6 Reconcile |
| `02-seed-data.md` | 7 Seed generator, reference plan, issue manifest |
| `03-persistence-and-services.md` | 8 DB schema · 9 Workspaces/dataset/target/audit · 10 Plans + dry runs · 11 Approvals · 12 Executions + rollback · 13 Reconcile + history |
| `04-agent.md` | 14 LLM adapters · 15 Tools + loop · 16 Agent runs + startup |
| `05-api.md` | 17 HTTP infrastructure · 18 Route handlers |
| `06-ui.md` | 19 UI foundation · 20 Overview · 21 Plan · 22 Dry run · 23 Approve & Execute · 24 Reconcile + History |
| `07-ship.md` | 25 Docker · 26 CI · 27 AWS deploy · 28 Docs · 29 (P2) Playwright · 30 (P2) Agent eval |

## Global Constraints
- Node 24 LTS in Docker (local Node 26 is fine); TypeScript pinned to `~5.9` (not 7.x).
- Next.js 16 App Router, `src/` dir, import alias `@/*`, `output: 'standalone'`.
- zod 4 APIs (`z.record(z.string(), …)`, `z.toJSONSchema`).
- Max source records: **500** (`MAX_SOURCE_RECORDS` in `src/domain/limits.ts`); shipped sample 200.
- Agent limits: ≤ **15** tool calls, ≤ **90 s** wall time, ≤ **2** draft corrections, ≤ 1 nudge; temperature 0.
- Execution batch size **50**; insert-only; one `running` run per workspace.
- Rate limits: `AGENT_RATE_PER_10MIN` default **6** per IP; `AGENT_DAILY_CAP` default **300**.
- Error body: `{ "error": { "code", "message", "details"?, "requestId" } }`; codes as in spec §10.
- Logs: pino JSON to stdout; never log secrets or full raw records (seq + legacy key only).
- No `window.alert/confirm/prompt`; every data panel has loading, empty, validation-error, success, failure states.
- Never commit secrets; `.env` is git-ignored; `.env.example` holds names only.
- Do not copy the original assignment text into the repository.
- Line endings LF (`.gitattributes`).
- After each phase file, append to `AGENT_USAGE.md` (prompts, delegated work, mistakes caught, verification) and give the user a "What / Why / Likely questions / Likely tweaks" note.

## Review Focus
Failure modes the spec implies but no feature test naturally exercises; each has a pinned test in the owning task:
1. **Unicode and punctuation in names/emails** (`José Núñez`, `O'Brien`, `a+b@x.io`) must pass through `trim`/`split_name`/validation unchanged → Task 3 and Task 5 tests.
2. **Two-digit years and Excel-ish dates** (`3/4/19`, `43567`) must be rejected as `INVALID_DATE`, never misparsed → Task 3 test.
3. **Over-precise or huge money values** (`1,234.567`, `99999999999999.99`) → `INVALID_NUMBER` / `AMOUNT_OUT_OF_RANGE`, never silently rounded → Task 3 test.
4. **Malformed LLM output** (params as a JSON string, missing fields, unknown tool, evidence IDs that don't exist) → structured correction feedback, never a crash → Task 15 tests.
5. **Process restart mid agent-run or mid execution** → statuses become `failed`/`interrupted` at startup and a retry works → Task 16 test (startup) and Task 12 test (interrupted run then retry).

## Teaching cadence
After finishing each plan file, stop and give the user:
- **What I built** (3–6 bullets), **Why** (the decision behind each non-obvious choice),
- **Likely reviewer questions** with 1–2 sentence answers,
- **Likely live tweaks** (e.g. "add a new rule", "change batch size") with the exact file(s) to touch.
