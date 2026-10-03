export const shortHash = (h: string | null | undefined) => (h ? h.slice(0, 8) : '—');
export const formatTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—');
export const formatCents = (n: number) => (n / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
