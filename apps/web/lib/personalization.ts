'use client';

export interface Accent { key: string; nome: string; brand: string; bright: string; deep: string; lilac: string }
export const ACCENTS: Accent[] = [
  { key: 'roxo', nome: 'Roxo', brand: '#7B2FBE', bright: '#9B4DE0', deep: '#5B1E9E', lilac: '#C9A0F0' },
  { key: 'azul', nome: 'Azul', brand: '#2563EB', bright: '#3B82F6', deep: '#1D4ED8', lilac: '#93C5FD' },
  { key: 'verde', nome: 'Verde', brand: '#0E9F6E', bright: '#10B981', deep: '#047857', lilac: '#6EE7B7' },
  { key: 'rosa', nome: 'Rosa', brand: '#DB2777', bright: '#EC4899', deep: '#BE185D', lilac: '#F9A8D4' },
  { key: 'laranja', nome: 'Laranja', brand: '#EA580C', bright: '#F97316', deep: '#C2410C', lilac: '#FDBA74' },
  { key: 'grafite', nome: 'Grafite', brand: '#475569', bright: '#64748B', deep: '#334155', lilac: '#CBD5E1' },
];

export interface BgPreset { key: string; nome: string; light: string; dark: string }
export const BGS: BgPreset[] = [
  { key: 'aurora', nome: 'Aurora (padrão)', light: '#f6f4ef', dark: '#110d19' },
  { key: 'limpo', nome: 'Limpo', light: '#fafafa', dark: '#0b0b10' },
  { key: 'quente', nome: 'Quente', light: '#f7f2ea', dark: '#14100c' },
  { key: 'frio', nome: 'Frio', light: '#eef2f7', dark: '#0b0f16' },
];

export interface Prefs { accent?: string; bg?: string; theme?: 'light' | 'dark' | 'system' }

/** Aplica cor de destaque, fundo e tema nas CSS vars do documento. */
export function applyPrefs(prefs: Prefs | undefined) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const a = ACCENTS.find((x) => x.key === prefs?.accent);
  if (a) {
    root.style.setProperty('--brand', a.brand);
    root.style.setProperty('--brand-bright', a.bright);
    root.style.setProperty('--brand-deep', a.deep);
    root.style.setProperty('--lilac', a.lilac);
  }
  const bg = BGS.find((x) => x.key === prefs?.bg);
  if (bg) {
    root.style.setProperty('--bg-light', bg.light);
    root.style.setProperty('--bg-dark', bg.dark);
    root.setAttribute('data-bg', bg.key);
  }
  if (prefs?.theme === 'light' || prefs?.theme === 'dark') root.setAttribute('data-theme', prefs.theme);
  else if (prefs?.theme === 'system') root.removeAttribute('data-theme');
}
