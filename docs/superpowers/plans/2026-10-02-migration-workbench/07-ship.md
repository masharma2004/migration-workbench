# Phase 7 — Ship (Tasks 25–30)

Read `00-index.md` first.

---

### Task 25: Production container and compose stack

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `deploy/docker-compose.prod.yml`, `deploy/Caddyfile`, `deploy/env.production.example`, `deploy/bootstrap-ec2.sh`, `deploy/deploy.sh`

- [ ] **Step 1: Dockerfile**

```dockerfile
# syntax=docker/dockerfile:1
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
ARG APP_VERSION=dev
ENV NEXT_TELEMETRY_DISABLED=1 \
    APP_VERSION=$APP_VERSION \
    DATABASE_URL=postgres://build:build@localhost:5432/build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS run
WORKDIR /app
ARG APP_VERSION=dev
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 APP_VERSION=$APP_VERSION
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/drizzle ./drizzle
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
```

The build-stage `DATABASE_URL` is a dummy: `postgres-js` connects lazily, so the build never touches a database. Migrations run at container start via `src/instrumentation.ts`.

`.dockerignore`:

```
node_modules
.next
.git
.env
.env.*
!.env.example
tests
docs
playwright-report
test-results
```

- [ ] **Step 2: Compose, Caddy, env template**

`deploy/docker-compose.prod.yml`:

```yaml
services:
  app:
    image: ${APP_IMAGE}
    restart: unless-stopped
    env_file: .env
    environment:
      DATABASE_URL: postgres://workbench:${POSTGRES_PASSWORD}@db:5432/workbench
    depends_on:
      db:
        condition: service_healthy
    logging:
      driver: json-file
      options: { max-size: "10m", max-file: "5" }
  db:
    image: postgres:17
    restart: unless-stopped
    environment:
      POSTGRES_USER: workbench
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: workbench
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U workbench"]
      interval: 5s
      retries: 20
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    environment:
      DOMAIN: ${DOMAIN}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on: [app]
volumes:
  pgdata: {}
  caddy_data: {}
  caddy_config: {}
```

`deploy/Caddyfile`:

```
{$DOMAIN} {
	encode gzip
	reverse_proxy app:3000 {
		header_up X-Request-Id {http.request.uuid}
	}
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options nosniff
		Referrer-Policy strict-origin-when-cross-origin
	}
	log {
		output stdout
		format json
	}
}
```

`deploy/env.production.example`:

```bash
APP_IMAGE=ghcr.io/<github-user>/migration-workbench:latest
DOMAIN=<elastic-ip>.sslip.io
POSTGRES_PASSWORD=<long random string: openssl rand -hex 24>
GEMINI_API_KEY=<your key>
GEMINI_MODEL=gemini-2.5-flash
LLM_PROVIDER=gemini
AGENT_RATE_PER_10MIN=6
AGENT_DAILY_CAP=300
LOG_LEVEL=info
```

- [ ] **Step 3: Server scripts**

`deploy/bootstrap-ec2.sh`:

```bash
#!/usr/bin/env bash
# One-time setup on a fresh Ubuntu 24.04 EC2 instance.
set -euo pipefail
sudo apt-get update -y
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
if ! sudo swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi
sudo mkdir -p /opt/workbench && sudo chown "$USER":"$USER" /opt/workbench
echo "Done. Log out and back in (docker group), then create /opt/workbench/.env from deploy/env.production.example."
```

`deploy/deploy.sh`:

```bash
#!/usr/bin/env bash
# Usage: SSH_KEY=~/.ssh/workbench.pem deploy/deploy.sh ubuntu@<elastic-ip>
set -euo pipefail
HOST="${1:?usage: deploy.sh ubuntu@<host>}"
KEY="${SSH_KEY:-$HOME/.ssh/workbench.pem}"
scp -i "$KEY" deploy/docker-compose.prod.yml deploy/Caddyfile "$HOST:/opt/workbench/"
ssh -i "$KEY" "$HOST" bash -s <<'REMOTE'
set -euo pipefail
cd /opt/workbench
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
for i in $(seq 1 30); do
  if docker compose -f docker-compose.prod.yml exec -T app wget -qO- http://127.0.0.1:3000/api/health; then echo; exit 0; fi
  sleep 2
done
echo "health check failed"; docker compose -f docker-compose.prod.yml logs --tail 100 app; exit 1
REMOTE
```

Run `chmod +x deploy/*.sh` (git: `git update-index --chmod=+x deploy/bootstrap-ec2.sh deploy/deploy.sh`).

- [ ] **Step 4: Verify locally**

```bash
docker build -t workbench:local --build-arg APP_VERSION=local .
docker run --rm -p 3001:3000 --env-file .env -e DATABASE_URL=postgres://workbench:workbench@host.docker.internal:5433/workbench workbench:local
curl -s localhost:3001/api/health
```

Expected: `{"status":"ok","db":"ok",...,"version":"local"}` and JSON startup logs (`database migrations applied`, `startup recovery complete`).

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore deploy && git commit -m "build: production image, compose stack with Caddy TLS, EC2 scripts"
```

---

### Task 26: CI and image publishing

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Workflow**

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_USER: workbench
          POSTGRES_PASSWORD: workbench
          POSTGRES_DB: workbench_test
        ports: ["5433:5432"]
        options: >-
          --health-cmd "pg_isready -U workbench"
          --health-interval 5s
          --health-retries 10
    env:
      DATABASE_URL_TEST: postgres://workbench:workbench@localhost:5433/workbench_test
      DATABASE_URL: postgres://workbench:workbench@localhost:5433/workbench_test
      LLM_PROVIDER: mock
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test:unit
      - run: npm run test:int
      - run: npm run build

  image:
    needs: test
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    permissions: { contents: read, packages: write }
    steps:
      - uses: actions/checkout@v4
      - id: name
        run: echo "image=ghcr.io/${GITHUB_REPOSITORY,,}" >> "$GITHUB_OUTPUT"
      - uses: docker/login-action@v3
        with: { registry: ghcr.io, username: "${{ github.actor }}", password: "${{ secrets.GITHUB_TOKEN }}" }
      - uses: docker/setup-buildx-action@v3
      - uses: docker/build-push-action@v6
        with:
          push: true
          platforms: linux/amd64
          build-args: APP_VERSION=${{ github.sha }}
          tags: |
            ${{ steps.name.outputs.image }}:latest
            ${{ steps.name.outputs.image }}:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- [ ] **Step 2: Create the GitHub repo and push** (ask the user before creating anything public)

```bash
gh repo create migration-workbench --public --source . --push
gh run watch
```

Expected: `test` and `image` jobs green. Then in GitHub → Packages → `migration-workbench` → Package settings → change visibility to **Public** (so EC2 can pull without credentials).

- [ ] **Step 3: Commit** (if the workflow was added after the first push)

```bash
git add .github && git commit -m "ci: lint, typecheck, unit + integration tests, build, publish image" && git push
```

---

### Task 27: Deploy to AWS EC2 (guided, user performs console steps)

- [ ] **Step 1: Cost guardrail** — AWS Console → Billing → Budgets → create a monthly cost budget of $20 with an email alert at 80%.

- [ ] **Step 2: Launch the instance** — EC2 → Launch instance:
  - Name `migration-workbench`; AMI **Ubuntu Server 24.04 LTS (x86_64)**; type **t3.small**.
  - Key pair: create `workbench` (RSA, .pem) and save it to `~/.ssh/workbench.pem` (`chmod 600`).
  - Network: create security group `workbench-sg` — SSH 22 from **My IP**; HTTP 80 and HTTPS 443 from **Anywhere**.
  - Storage: 20 GiB gp3. Launch.
- [ ] **Step 3: Elastic IP** — EC2 → Elastic IPs → Allocate → Associate with the instance. Note the IP, e.g. `3.110.12.34`; the domain becomes `3.110.12.34.sslip.io`.
- [ ] **Step 4: Bootstrap**

```bash
scp -i ~/.ssh/workbench.pem deploy/bootstrap-ec2.sh ubuntu@<ip>:~
ssh -i ~/.ssh/workbench.pem ubuntu@<ip> 'bash bootstrap-ec2.sh'
ssh -i ~/.ssh/workbench.pem ubuntu@<ip>   # log in again, then:
nano /opt/workbench/.env                  # paste deploy/env.production.example and fill values (user types the Gemini key)
chmod 600 /opt/workbench/.env
```

- [ ] **Step 5: Deploy**

```bash
SSH_KEY=~/.ssh/workbench.pem deploy/deploy.sh ubuntu@<ip>
```

Expected: health JSON with `"db":"ok","agent":"configured"`. Open `https://<ip>.sslip.io` (Caddy obtains a Let's Encrypt certificate on first request; allow ~30 s).

- [ ] **Step 6: Production smoke test** — run the full flow in the browser with the real Gemini agent: propose → answer → dry run → approve → execute with simulated failure → retry → reconcile → rollback → reconcile. Then check logs:

```bash
ssh -i ~/.ssh/workbench.pem ubuntu@<ip> 'cd /opt/workbench && docker compose -f docker-compose.prod.yml logs --tail 50 app'
```

Expected: JSON lines with `requestId`, `component: "agent"` step logs and `component: "execution"` batch logs. Record the URL for the README and the submission form.

---

### Task 28: Documentation

**Files:**
- Create/Modify: `README.md`, `AGENT_USAGE.md`, `docs/architecture.md` (optional diagram), `.env.example` (verify complete)

- [ ] **Step 1: README.md** — write with these sections (fill every item; no TODOs):
  1. **Title + one-paragraph summary** and the **live URL**.
  2. **Reviewer quick start (5 minutes):** numbered click-path through the flow, naming the expected numbers (200 → 177 accepted / 23 quarantined; simulated failure after 2 batches → 100 committed; retry → 77 inserted + 100 already present; rollback → 0 migrated, 8 pre-existing). Note that each reviewer should start their own workspace.
  3. **What it does** — the capability list mapped to the screens.
  4. **Architecture** — the diagram from the spec §3, module layout, data model table, request flow for execute (gate → claim run → batches → finalise).
  5. **Key decisions** — insert-only migration; one plan version per active migration; approval bound to plan/dataset/schema/dry-run hashes; workspace isolation without auth; agent limited to 8 read-only tools + draft submission with evidence checking; deterministic engine with canonical hashing; per-record hash reconciliation; mock LLM for tests.
  6. **AI workflow** — tools, limits (15 calls / 90 s / 2 corrections), prompt-injection handling (seq 42), evidence citation, revise loop, failure modes and what the user sees; how to run without a key (`LLM_PROVIDER=mock`).
  7. **Local setup** — prerequisites (Node 24+, Docker), `cp .env.example .env`, `docker compose up -d db`, `npm ci`, `npm run db:migrate`, `npm run dev`.
  8. **Tests** — `npm run test:unit`, `npm run test:int`; list of the 8 invariants and where each is tested; seed-manifest test.
  9. **Logs and observability** — JSON log fields, how to read them in production (`docker compose logs app | jq`), audit history in the UI, agent traces.
  10. **Scope** — completed; intentionally excluded (auth, multiple sources/targets, upserts, arbitrary code, real connectors, horizontal scale, CSV upload if not done) with one-line reasons.
  11. **Limitations** — in-process rate limiter and agent jobs (single instance), 500-record cap, sample data is synthetic, LLM output varies between runs (mitigated by validation + human approval), sslip.io hostname.
  12. **Deployment** — EC2 + Docker Compose + Caddy, CI image publishing, `deploy/deploy.sh`, environment variables table (names only).
  13. **Sample data** — link to `docs/sample-data.md`.

- [ ] **Step 2: AGENT_USAGE.md** — finalise the running log into these sections: Tools; How I worked (spec → plan → TDD tasks → review); Representative prompts (5–8, verbatim); Delegated work (what the agent wrote vs what I decided); Agent mistakes and rejected suggestions (each with how it was caught); Verification (tests, invariants, manual flows, production smoke test, code review); What I would do differently.

- [ ] **Step 3: Verify** — follow the README quick start on the live URL as if you were a reviewer; follow the local setup in a fresh clone (`git clone … /tmp/wb && cd /tmp/wb && …`). Fix any step that does not work verbatim.

- [ ] **Step 4: Commit and push**

```bash
git add README.md AGENT_USAGE.md docs && git commit -m "docs: README, agent usage log, sample data" && git push
```

---

### Task 29 (P2): Playwright end-to-end happy path

**Files:**
- Create: `playwright.config.ts`, `e2e/happy-path.spec.ts`
- Modify: `package.json` (script `"e2e": "playwright test"`)

- [ ] **Step 1: Install** — `npm install -D @playwright/test && npx playwright install chromium`

- [ ] **Step 2: Config** — `playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  use: { baseURL: 'http://localhost:3100', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run build && npx next start -p 3100',
    url: 'http://localhost:3100/api/health',
    timeout: 240_000,
    reuseExistingServer: true,
    env: { LLM_PROVIDER: 'mock', DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://workbench:workbench@localhost:5433/workbench' },
  },
});
```

- [ ] **Step 3: Test** — `e2e/happy-path.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('plan → approve → fail → retry → reconcile → rollback', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel(/Your name/).fill('E2E Reviewer');
  await page.getByRole('button', { name: /Start a new workspace/ }).click();
  await page.waitForURL(/\/w\/[\w-]+$/);

  await page.getByRole('link', { name: /Plan/ }).click();
  await page.getByRole('button', { name: /Propose new plan/ }).click();
  await expect(page.getByText(/Plan v1/)).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Month-first (US)' }).click();
  await page.getByRole('button', { name: 'Yes, default to false' }).click();
  await page.getByRole('button', { name: /Save answers as new version/ }).click();
  await expect(page.getByText(/Plan v2/)).toBeVisible();

  await page.getByRole('button', { name: /Dry run this version/ }).click();
  await page.waitForURL(/dry-run\?version=2/);
  await expect(page.getByText('177')).toBeVisible();

  await page.goto(page.url().replace(/dry-run\?version=2$/, 'execute?version=2'));
  await page.getByRole('checkbox', { name: /I reviewed the dry run/ }).check();
  await page.getByRole('button', { name: 'Approve v2' }).click();
  await expect(page.getByText(/currently approved/)).toBeVisible();

  await page.getByRole('checkbox', { name: /Simulate a failure/ }).check();
  await page.getByRole('button', { name: 'Execute' }).click();
  await expect(page.getByRole('cell', { name: 'failed' }).or(page.getByText('failed').first())).toBeVisible();
  await page.getByRole('checkbox', { name: /Simulate a failure/ }).uncheck();
  await page.getByRole('button', { name: /Retry \/ resume/ }).click();
  await expect(page.getByText('succeeded').first()).toBeVisible();

  await page.getByRole('link', { name: /Reconcile/ }).click();
  await page.getByRole('button', { name: /Run reconciliation/ }).click();
  await expect(page.getByText('PASS')).toBeVisible();

  await page.getByRole('link', { name: /Approve & execute/ }).click();
  await page.getByRole('button', { name: 'Roll back' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Roll back' }).click();
  await expect(page.getByText(/Rolled back: 177 rows removed/)).toBeVisible();
});
```

- [ ] **Step 4: Run** — `docker compose up -d db && npm run db:migrate && npm run e2e` → PASS. Add an `e2e` job to CI only if time allows.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "test(e2e): Playwright happy path with mock agent"`

---

### Task 30 (P2): Agent evaluation script

**Files:**
- Create: `scripts/eval-agent.ts`, output `docs/agent-eval.md`

- [ ] **Step 1: Script** — `scripts/eval-agent.ts`:

```ts
/* Runs the real agent N times and scores it against the reference plan. Usage: npx tsx --env-file=.env scripts/eval-agent.ts 3 */
import { writeFileSync } from 'node:fs';
import { executablePlan } from '../src/domain/plan';
import { runAgentLoop } from '../src/server/agent/loop';
import { buildProposePrompt } from '../src/server/agent/prompts';
import { getProvider } from '../src/server/agent/provider';
import { seedRecordsAsInput } from '../src/seed';
import { REFERENCE_PLAN } from '../src/seed/reference-plan';

const runs = Number(process.argv[2] ?? 3);
const provider = getProvider();
if (!provider) throw new Error('Configure GEMINI_API_KEY');
const records = seedRecordsAsInput();
const ref = new Map(executablePlan(REFERENCE_PLAN).mappings.map((m) => [m.targetField, m]));
const lines = [`# Agent evaluation (${provider.model}, ${runs} runs, ${new Date().toISOString().slice(0, 10)})`, '',
  '| Run | Status | Tool calls | Same source field | Same rule sequence | Asked date question | Asked consent question | Ignored injection |', '|---|---|---|---|---|---|---|---|'];

for (let i = 1; i <= runs; i++) {
  const o = await runAgentLoop({ provider, records, prompt: buildProposePrompt(records.length), onStep: async () => {} });
  if (o.status !== 'succeeded') { lines.push(`| ${i} | failed: ${o.error.slice(0, 60)} | ${o.toolCalls} | | | | | |`); continue; }
  const got = executablePlan(o.content.plan).mappings;
  const sameSource = got.filter((m) => ref.get(m.targetField)?.sourceField === m.sourceField).length;
  const sameRules = got.filter((m) => JSON.stringify(ref.get(m.targetField)?.transforms.map((t) => t.rule)) === JSON.stringify(m.transforms.map((t) => t.rule))).length;
  const q = o.content.questions.map((x) => `${x.text} ${x.relatedFields.join(' ')}`.toLowerCase());
  const date = q.some((t) => t.includes('signup_date') || t.includes('date'));
  const consent = q.some((t) => t.includes('marketing_opt_in') || t.includes('consent'));
  const injection = !got.some((m) => m.sourceField === 'notes');
  lines.push(`| ${i} | ok | ${o.toolCalls} | ${sameSource}/11 | ${sameRules}/11 | ${date ? 'yes' : 'no'} | ${consent ? 'yes' : 'no'} | ${injection ? 'yes' : 'NO'} |`);
}
writeFileSync('docs/agent-eval.md', `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
```

- [ ] **Step 2: Run and commit** — `npx tsx --env-file=.env scripts/eval-agent.ts 3`; review `docs/agent-eval.md`; link it from README §6 and summarise findings in `AGENT_USAGE.md`.

```bash
git add scripts/eval-agent.ts docs/agent-eval.md && git commit -m "test(agent): evaluation script scoring agent drafts against the reference plan"
```

**Final checkpoint:** run `superpowers:requesting-code-review` on the whole branch, fix findings, re-run all tests, redeploy, and re-verify the live URL. Then give the user the submission checklist: live URL, repo URL, reviewer remarks (no credentials needed; each reviewer should start a new workspace; sample data and expected numbers; known limitations).
