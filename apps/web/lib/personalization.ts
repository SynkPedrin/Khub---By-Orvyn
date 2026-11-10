'use client';

export interface Accent { key: string; nome: string; brand: string; bright: string; deep: string; lilac: string }
export const ACCENTS: Accent[] = [
  { key: 'roxo', nome: 'Roxo', brand: '#7B2EFF', bright: '#A66BFF', deep: '#6A1FE6', lilac: '#C9B3FF' },
  { key: 'azul', nome: 'Azul', brand: '#2563EB', bright: '#3B82F6', deep: '#1D4ED8', lilac: '#93C5FD' },
  { key: 'verde', nome: 'Verde', brand: '#0E9F6E', bright: '#10B981', deep: '#047857', lilac: '#6EE7B7' },
  { key: 'rosa', nome: 'Rosa', brand: '#DB2777', bright: '#EC4899', deep: '#BE185D', lilac: '#F9A8D4' },
  { key: 'laranja', nome: 'Laranja', brand: '#EA580C', bright: '#F97316', deep: '#C2410C', lilac: '#FDBA74' },
  { key: 'grafite', nome: 'Grafite', brand: '#475569', bright: '#64748B', deep: '#334155', lilac: '#CBD5E1' },
];

export interface BgPreset { key: string; nome: string; light: string; dark: string }
export const BGS: BgPreset[] = [
  // Cristal é o padrão da marca: lavanda gelada, o neutro da identidade.
  { key: 'cristal', nome: 'Cristal (padrão)', light: '#efebfa', dark: '#110d19' },
  { key: 'ametista', nome: 'Ametista', light: '#e9e2f8', dark: '#150e22' },
  { key: 'aurora', nome: 'Aurora', light: '#f6f4ef', dark: '#110d19' },
  { key: 'limpo', nome: 'Limpo', light: '#fafafa', dark: '#0b0b10' },
  { key: 'quente', nome: 'Quente', light: '#f7f2ea', dark: '#14100c' },
  { key: 'frio', nome: 'Frio', light: '#eef2f7', dark: '#0b0f16' },
];

export interface Prefs {
  accent?: string;
  bg?: string;
  theme?: 'light' | 'dark' | 'system';
  /** Logo da marca do cliente: data URL (upload) ou URL. Vazio = logo KHUB. */
  logo?: string;
  /** Plano de fundo próprio: data URL (upload). Vazio = fundo estúdio. */
  bgImage?: string;
}

/**
 * Otimiza a imagem NO CLIENTE antes de guardar em `users.prefs`: qualquer
 * arquivo entra (sem limite pro usuário) — a gente redimensiona e recomprime
 * para não estourar o banco. SVG passa direto (vetorial e leve).
 *
 * @param maxDim  maior lado em px (logo ~512, fundo ~2560).
 */
export async function otimizarImagem(file: File, maxDim: number): Promise<string> {
  const dataUrl = await lerComoDataUrl(file);
  if (file.type === 'image/svg+xml') return dataUrl; // vetorial: mantém como está
  const img = await carregarImagem(dataUrl);
  const escala = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * escala));
  const h = Math.max(1, Math.round(img.height * escala));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, w, h);
  // WEBP preserva transparência (logo) e comprime bem; PNG como fallback.
  const webp = canvas.toDataURL('image/webp', 0.9);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
}

function lerComoDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error('leitura falhou'));
    r.readAsDataURL(file);
  });
}
function carregarImagem(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new window.Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('imagem inválida'));
    i.src = src;
  });
}

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

  // Plano de fundo próprio: quando presente, o `.studio-bg` mostra a imagem
  // (com um leve scrim para leitura). Vazio = volta ao estúdio.
  if (prefs?.bgImage) {
    root.style.setProperty('--bg-image', `url("${prefs.bgImage}")`);
    root.setAttribute('data-bg-image', '1');
  } else {
    root.style.removeProperty('--bg-image');
    root.removeAttribute('data-bg-image');
  }
}
