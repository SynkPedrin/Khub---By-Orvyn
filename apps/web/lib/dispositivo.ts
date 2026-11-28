/**
 * Celular × computador para o app instalado (PWA).
 *
 * O mesmo app instalado roda no celular e no computador (Chrome/Edge também
 * instalam no desktop). O app do cliente em /m foi desenhado para o celular;
 * no computador, quem abre o app instalado tem de cair no KHUB completo.
 */

export interface SinaisDispositivo {
  userAgent: string;
  /** navigator.maxTouchPoints */
  toques: number;
  /** matchMedia('(pointer: coarse)') — dedo como ponteiro principal. */
  ponteiroGrosso: boolean;
  /** Largura da tela em px (screen.width, não a janela: janela do PC pode estar estreita). */
  larguraTela: number;
}

/** Celular ou tablet. Pura: decide só pelos sinais recebidos. */
export function ehCelularPor(s: SinaisDispositivo): boolean {
  if (/Android|iPhone|iPod|iPad|Mobile|Windows Phone/i.test(s.userAgent)) return true;
  // iPadOS se apresenta como Mac: o que denuncia é a tela de toque.
  if (/Macintosh/.test(s.userAgent) && s.toques > 1) return true;
  // Notebook com tela de toque tem mouse/trackpad como ponteiro principal.
  return s.ponteiroGrosso && s.larguraTela <= 1024;
}

export function ehCelular(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  return ehCelularPor({
    userAgent: navigator.userAgent,
    toques: navigator.maxTouchPoints ?? 0,
    ponteiroGrosso: window.matchMedia('(pointer: coarse)').matches,
    larguraTela: window.screen?.width ?? window.innerWidth,
  });
}

/** Rota do KHUB completo equivalente a uma tela do app do cliente (/m). */
export function rotaDesktopDe(pathnameMobile: string): string | null {
  if (pathnameMobile.startsWith('/m/aprovacoes')) return '/aprovacoes';
  if (pathnameMobile.startsWith('/m/agenda')) return '/agenda';
  if (pathnameMobile.startsWith('/m/perfil')) return '/configuracoes';
  return null; // início: depende de ser agência ou cliente (quem chama decide)
}
