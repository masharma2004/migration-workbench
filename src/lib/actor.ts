const NAME_KEY = 'wb.actorName';
const RECENT_KEY = 'wb.recentWorkspaces';

export function getActorName(): string {
  try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; }
}
export function setActorName(name: string): void {
  try { localStorage.setItem(NAME_KEY, name.slice(0, 60)); } catch { /* storage unavailable */ }
}
export function recentWorkspaces(): { id: string; at: string }[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); } catch { return []; }
}
export function rememberWorkspace(id: string): void {
  try {
    const next = [{ id, at: new Date().toISOString() }, ...recentWorkspaces().filter((w) => w.id !== id)].slice(0, 5);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* storage unavailable */ }
}
