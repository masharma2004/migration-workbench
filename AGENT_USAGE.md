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

### 2026-10-03 — Phases 4–6: agent, API, UI (Tasks 14–24, 29)
- **Delegated:** Gemini adapter + scripted mock, the bounded tool-calling loop, background agent runs, REST API, and the six workspace screens.
- **Agent mistakes caught:**
  - The current shadcn generator uses Base UI, which has no `asChild`; the planned `<Button asChild><Link/></Button>` pattern did not type-check. Links now use `buttonVariants()`, the dialog trigger uses Base UI's `render` prop.
  - I briefly removed the `cn` npm package believing it was a stray dependency — it is how the new shadcn exports `cn`. Reinstalled after the typecheck failed.
  - React's lint rule flagged `setState` inside effects for default version selection; replaced with derived state.
  - The Playwright end-to-end test found a real UI bug: saving answers created v2 but the page stayed on v1. Fixed by selecting the saved version.
  - Screenshots showed the sans font was never applied (shadcn's CSS pointed `--font-sans` at itself) and long transform chips were clipped on both sides. Both fixed.
  - Operational slip: I stopped a local server with `taskkill /IM node.exe`, which also killed unrelated Node processes (editor tooling). Later servers are stopped by PID.
- **Verification:** unit + integration suites, `next build`, lint, a curl smoke test of the API with JSON request logs, and a Playwright happy path (propose → answer → dry run → approve → simulated failure → retry → reconcile → rollback) run twice; screenshots reviewed at 1366 px and 390 px.

### 2026-10-03 — Final review
- **How:** a separate, fresh-context reviewer agent (strongest model) reviewed the whole branch against the spec, the plan's "review focus" list and my recorded rulings.
- **Accepted and fixed (each with a failing test first):** a 10-minute "stale run takeover" that could leave two executions writing at once; one client being able to exhaust the shared daily agent quota; unlimited workspace creation; unbounded request bodies and plan sizes that could block the single Node process.
- **Deferred (documented):** raw driver error text shown for failed batches, non-UUID ids returning 500 instead of 404, missing audit event for agent runs recovered at restart, "succeeded" status for runs with hash conflicts, reconciliation not blocked during a running execution, CSV formula-injection hardening, unbounded client request-id header.
- **Verification:** unit 100/100, integration 38/38, typecheck and lint clean, end-to-end happy path re-run after the fixes.

### 2026-10-03 — Live Gemini runs and second review pass
- **What the live model revealed (the mock could not):**
  - `gemini-2.5-flash` returns 404 for new API keys; switched models after listing what the key can access.
  - A thorough model profiles every field one call at a time and exhausted the 15-call budget. `profile_field` now accepts several fields per call, and the budget is 25 calls / 150 s (a deliberate change from the spec's 15 / 90 s, recorded in the ledger).
  - The free tier allows 5 requests/minute; the adapter now waits for the `retryDelay` Gemini returns on 429 instead of a fixed 1 s / 3 s backoff. `gemini-3.5-flash-lite` completes runs within the free tier.
  - The agent did not notice the ambiguous `04/05/2019`-style dates because every value parsed successfully. Rather than only adding prompt text, `test_transformation` now emits a deterministic `AMBIGUOUS_DATE` warning; afterwards both evaluation runs flagged the 5 ambiguous records as a risk with evidence (they still raise it as a risk, not as a question — documented in `docs/agent-eval.md`).
- **Second review pass — fixed the deferred minor findings, each test-first:** malformed ids return 404 instead of 500; restart recovery writes `agent_run.failed` audit events; reconciliation refuses while a run is in progress; CSV export neutralises spreadsheet formulas; client `x-request-id` values are validated; failed batches store a sanitized error (SQLSTATE and constraint) instead of the driver message containing record values.
- **Still deferred:** a run whose skipped rows conflict by hash is reported as `succeeded` (conflicts are counted and reconciliation fails on them).
- **Free-tier constraint (decided with the user):** the hosted demo uses a free Gemini key. Added plain-language quota errors, lower production caps, and a "Scripted demo (no LLM)" button that replays the hand-written reference run, labelled as scripted in the UI and in the run's recorded model name, so reviewers can still complete the workflow if the daily quota runs out.

### 2026-10-03 — Deployment
- **Delegated:** server bootstrap (Docker, swap), writing the server `.env` (the Gemini key was copied file-to-file, never printed), compose deploy, verification.
- **Verification on the live URL:** `/api/health` ok with database and agent configured; HTTP→HTTPS redirect with a valid Let's Encrypt certificate; a real Gemini agent run via the public API succeeded (19 tool calls, draft v1); the Playwright happy path passed against the deployment using the scripted demo agent to preserve free-tier quota.
- **Repository hygiene (user request):** commit messages were rewritten to remove AI co-author trailers; AI usage is documented here instead.
