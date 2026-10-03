export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private day = '';
  private dayCount = 0;

  constructor(private readonly perWindow: number, private readonly windowMs: number, private readonly dailyCap: number,
    private readonly now: () => number = Date.now) {}

  check(key: string): { ok: true } | { ok: false; retryAfterSec: number; reason: string } {
    const t = this.now();
    const today = new Date(t).toISOString().slice(0, 10);
    if (today !== this.day) { this.day = today; this.dayCount = 0; }
    if (this.dayCount >= this.dailyCap) {
      return { ok: false, retryAfterSec: 3600, reason: `The daily agent run limit (${this.dailyCap}) has been reached` };
    }
    const recent = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (recent.length >= this.perWindow) {
      this.hits.set(key, recent);
      return { ok: false, retryAfterSec: Math.ceil((this.windowMs - (t - recent[0])) / 1000),
        reason: `At most ${this.perWindow} agent runs per ${Math.round(this.windowMs / 60000)} minutes` };
    }
    recent.push(t);
    this.hits.set(key, recent);
    this.dayCount += 1;
    return { ok: true };
  }
}

export const agentLimiter = new RateLimiter(
  Number(process.env.AGENT_RATE_PER_10MIN ?? 6), 10 * 60_000, Number(process.env.AGENT_DAILY_CAP ?? 300));
