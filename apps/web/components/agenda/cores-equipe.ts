import type { Compromisso, ProfissionalAgenda, StatusAgenda } from '@/lib/agenda';

/**
 * Cor por profissional na agenda (pedido do product owner, 2026-11-16:
 * "separe por cor de membro da equipe"). Cada profissional ganha uma cor
 * fixa, na ordem do catálogo, para a recepção reconhecer quem atende sem
 * ler o nome. O STATUS deixa de ser cor e vira marcador (ícone/opacidade),
 * senão as duas leituras brigam pela mesma tinta.
 *
 * Classes escritas por extenso (o Tailwind só gera o que aparece literal).
 */
export interface CorEquipe {
  /** Faixa/barra sólida (borda esquerda do bloco, trilha do resumo, bolinha). */
  faixa: string;
  /** Fundo leve do bloco, com hover. */
  fundo: string;
  /** Texto de destaque na cor (nome no cabeçalho), legível no claro e no escuro. */
  texto: string;
  /** Borda esquerda (blocos que usam `border-l-[3px]`). */
  borda: string;
}

/** Ordem pensada para as 8 primeiras serem bem diferentes entre si (dia típico de salão). */
export const PALETA_EQUIPE: readonly CorEquipe[] = [
  { faixa: 'bg-sky-500', fundo: 'bg-sky-500/15 hover:bg-sky-500/25', texto: 'text-sky-700 dark:text-sky-300', borda: 'border-l-sky-500' },
  { faixa: 'bg-orange-500', fundo: 'bg-orange-500/15 hover:bg-orange-500/25', texto: 'text-orange-700 dark:text-orange-300', borda: 'border-l-orange-500' },
  { faixa: 'bg-violet-500', fundo: 'bg-violet-500/15 hover:bg-violet-500/25', texto: 'text-violet-700 dark:text-violet-300', borda: 'border-l-violet-500' },
  { faixa: 'bg-emerald-500', fundo: 'bg-emerald-500/15 hover:bg-emerald-500/25', texto: 'text-emerald-700 dark:text-emerald-300', borda: 'border-l-emerald-500' },
  { faixa: 'bg-rose-500', fundo: 'bg-rose-500/15 hover:bg-rose-500/25', texto: 'text-rose-700 dark:text-rose-300', borda: 'border-l-rose-500' },
  { faixa: 'bg-yellow-500', fundo: 'bg-yellow-500/15 hover:bg-yellow-500/25', texto: 'text-yellow-700 dark:text-yellow-300', borda: 'border-l-yellow-500' },
  { faixa: 'bg-teal-500', fundo: 'bg-teal-500/15 hover:bg-teal-500/25', texto: 'text-teal-700 dark:text-teal-300', borda: 'border-l-teal-500' },
  { faixa: 'bg-fuchsia-500', fundo: 'bg-fuchsia-500/15 hover:bg-fuchsia-500/25', texto: 'text-fuchsia-700 dark:text-fuchsia-300', borda: 'border-l-fuchsia-500' },
  { faixa: 'bg-lime-500', fundo: 'bg-lime-500/15 hover:bg-lime-500/25', texto: 'text-lime-700 dark:text-lime-300', borda: 'border-l-lime-500' },
  { faixa: 'bg-indigo-500', fundo: 'bg-indigo-500/15 hover:bg-indigo-500/25', texto: 'text-indigo-700 dark:text-indigo-300', borda: 'border-l-indigo-500' },
  { faixa: 'bg-amber-500', fundo: 'bg-amber-500/15 hover:bg-amber-500/25', texto: 'text-amber-700 dark:text-amber-300', borda: 'border-l-amber-500' },
  { faixa: 'bg-pink-500', fundo: 'bg-pink-500/15 hover:bg-pink-500/25', texto: 'text-pink-700 dark:text-pink-300', borda: 'border-l-pink-500' },
  { faixa: 'bg-cyan-500', fundo: 'bg-cyan-500/15 hover:bg-cyan-500/25', texto: 'text-cyan-700 dark:text-cyan-300', borda: 'border-l-cyan-500' },
];

/** Sem profissional: neutro, para não parecer de alguém. */
export const COR_SEM_PROFISSIONAL: CorEquipe = {
  faixa: 'bg-zinc-400',
  fundo: 'bg-surface2 hover:bg-surface3',
  texto: 'text-muted',
  borda: 'border-l-zinc-400',
};

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Cor de cada profissional.
 * - Catálogo com até 13 pessoas: cor FIXA pela posição no catálogo.
 * - Catálogo maior (ex.: importado do Avec com ex-funcionárias): as cores vão
 *   para quem aparece no período (`visiveis`), na ordem do catálogo; assim
 *   duas profissionais na mesma tela nunca dividem cor.
 * Quem não está no catálogo cai num hash estável do id. `null` = sem profissional.
 */
export function paletaEquipe(
  profissionais: Pick<ProfissionalAgenda, 'id'>[],
  visiveis?: Iterable<string | null | undefined>,
): (id: string | null | undefined) => CorEquipe {
  const n = PALETA_EQUIPE.length;
  const indice = new Map(profissionais.map((p, i) => [p.id, i]));
  if (profissionais.length > n && visiveis) {
    const presentes = [...new Set([...visiveis].filter((x): x is string => !!x))].sort(
      (a, b) => (indice.get(a) ?? Number.MAX_SAFE_INTEGER) - (indice.get(b) ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b),
    );
    indice.clear();
    presentes.forEach((id, i) => indice.set(id, i));
  }
  return (id) => {
    if (!id) return COR_SEM_PROFISSIONAL;
    const i = indice.get(id) ?? hash(id);
    return PALETA_EQUIPE[i % n];
  };
}

/** Status como marcador, não como cor: o que muda no bloco além da cor da profissional. */
export const MARCA_STATUS: Record<StatusAgenda, { bloco: string; icone: 'check' | 'check2' | 'alert' | 'close' | null; iconeCor: string }> = {
  agendado: { bloco: '', icone: null, iconeCor: '' },
  confirmado: { bloco: '', icone: 'check', iconeCor: 'text-success' },
  concluido: { bloco: 'opacity-60', icone: 'check2', iconeCor: 'text-muted' },
  faltou: { bloco: 'opacity-75 outline outline-1 outline-dashed outline-warning', icone: 'alert', iconeCor: 'text-warning' },
  cancelado: { bloco: 'opacity-50 line-through', icone: 'close', iconeCor: 'text-danger' },
};

/** Procedimento (serviço) do atendimento; sem serviço, o título. */
export const procedimento = (c: Pick<Compromisso, 'servicoNome' | 'titulo'>) => c.servicoNome ?? c.titulo;
