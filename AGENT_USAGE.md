# Agent Usage Log

Running log of how AI coding agents were used to build this project. Kept up to date during the build, not reconstructed afterwards.

## Tools
- Claude Code (Claude Opus) — design, planning, implementation, tests, review.

## Log

### 2026-10-02 — Design
- **Delegated:** problem selection analysis, initial architecture proposal, design spec drafting.
- **Prompts (representative):** "which one?" (choose between problems), "think more" (asked the agent to critique its own first design).
- **Agent mistakes caught / suggestions changed:**
  - First design used a single shared demo workspace — concurrent reviewers would interfere. Changed to isolated workspaces.
  - First design used `ON CONFLICT DO NOTHING` alone for idempotency — would silently mask changed values on retry. Added per-row hash comparison (`already_present` vs `conflict`) and a one-plan-version-per-migration rule.
  - First design allowed overwriting existing target rows implicitly — made rollback ambiguous. Changed to insert-only with `TARGET_CONFLICT` quarantine.
  - Initial hosting suggestion (SQLite on serverless) would lose data; chose Postgres on EC2 with Docker Compose.
- **Verification:** design reviewed section by section by me before writing the spec; spec self-reviewed for contradictions (moved workspaces and per-record reconciliation from P1 to P0 because tests depend on them).

### 2026-10-03 — Phase 1: foundation and domain (Tasks 1–6)
- **Delegated:** scaffolding, the rule catalog, plan validation, dry-run engine and reconciliation — all written test-first from the implementation plan.
- **Agent mistakes caught:**
  - Dependency conflict: vitest 5 requires `@types/node` ≥ 22; the scaffold pinned 20. Fixed by upgrading types.
  - `tsc --noEmit` failed on Next.js 16's generated `LayoutProps` global; the typecheck script now runs `next typegen` first.
  - The scaffold's `.gitignore` (`.env*`) would have hidden `.env.example`; added an explicit `!.env.example`.
- **Verification:** each test file was run and observed failing (module missing) before the implementation existed; 68/68 unit tests then passed; typecheck and production build clean.

### 2026-10-03 — Phases 2–3: seed data, persistence and services (Tasks 7–13)
- **Delegated:** deterministic seed generator, Drizzle schema/migrations, services for workspaces, plan versions, dry runs, approvals, execution, rollback and reconciliation.
- **Agent mistakes caught:**
  - The plan's DB test asserted the trigger message on the thrown error, but Drizzle wraps Postgres errors (`Failed query …`) with the original in `cause`; the test now asserts on `cause.message`. The trigger itself was verified to reject UPDATE/DELETE.
  - A generated `docs/sample-data.md` still contained template placeholders; rewritten from the real manifest and counts.
- **Verification:** seed generator output checked against the injected-issue manifest (200 → 177 accepted / 23 rejected, by stage); 26 integration tests against real Postgres cover duplicate-free retry after a simulated mid-run failure, concurrent executes, interrupted-run recovery, stale approvals, rollback leaving pre-existing rows untouched, and reconciliation detecting tampering.
