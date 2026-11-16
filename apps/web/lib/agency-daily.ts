'use client';

import { clienteApi } from './session-fetch';

/**
 * Daily da agência (ADR-0050): Minhas tarefas, Todas as tarefas, Studio e
 * Calendário. Espelho do catálogo de `apps/api/src/agency/daily/daily.catalogo.ts`.
 */
const req = clienteApi('/api/v1/agency/daily/');

export type Tipo = 'post' | 'carrossel' | 'reel' | 'criativo' | 'copy' | 'trafego' | 'landing_page' | 'branding' | 'reuniao' | 'administrativo' | 'outro';
export type Status = 'backlog' | 'a_fazer' | 'em_andamento' | 'em_revisao' | 'aguardando_aprovacao' | 'concluida';
export type Prioridade = 'baixa' | 'normal' | 'alta' | 'urgente';
export type Aprovacao = 'em_producao' | 'revisao_interna' | 'aguardando_aprovacao' | 'ajustes' | 'aprovado' | 'publicado';
export type Plataforma = 'instagram' | 'tiktok' | 'facebook' | 'linkedin' | 'youtube' | 'outra';

/** Tons do design system (ADR-0036): nada de cor literal nas telas. */
export type Tom = 'neutro' | 'info' | 'brand' | 'warning' | 'rosa' | 'success' | 'danger';
export const TOM: Record<Tom, { dot: string; pill: string; borda: string }> = {
  neutro: { dot: 'bg-faint', pill: 'bg-surface3 text-muted', borda: 'border-l-faint' },
  info: { dot: 'bg-info', pill: 'bg-info-soft text-info', borda: 'border-l-info' },
  brand: { dot: 'bg-brand', pill: 'bg-brand-soft text-brand', borda: 'border-l-brand' },
  warning: { dot: 'bg-warning', pill: 'bg-warning-soft text-warning', borda: 'border-l-warning' },
  // A marca já é limão nos dois temas: "aguardando cliente" usa o rosa do token de canal para não confundir.
  rosa: { dot: 'bg-channel-instagram', pill: 'bg-[color-mix(in_srgb,var(--ch-instagram)_14%,transparent)] text-channel-instagram', borda: 'border-l-channel-instagram' },
  success: { dot: 'bg-success', pill: 'bg-success-soft text-success', borda: 'border-l-success' },
  danger: { dot: 'bg-danger', pill: 'bg-danger-soft text-danger', borda: 'border-l-danger' },
};

export const STATUS: Record<Status, { label: string; tom: Tom }> = {
  backlog: { label: 'Backlog', tom: 'neutro' },
  a_fazer: { label: 'A fazer', tom: 'info' },
  em_andamento: { label: 'Em andamento', tom: 'brand' },
  em_revisao: { label: 'Em revisão', tom: 'warning' },
  aguardando_aprovacao: { label: 'Aguardando aprovação', tom: 'rosa' },
  concluida: { label: 'Concluída', tom: 'success' },
};
export const STATUS_ORDEM = Object.keys(STATUS) as Status[];

export const PRIORIDADE: Record<Prioridade, { label: string; tom: Tom; peso: number }> = {
  urgente: { label: 'Urgente', tom: 'danger', peso: 3 },
  alta: { label: 'Alta', tom: 'warning', peso: 2 },
  normal: { label: 'Normal', tom: 'info', peso: 1 },
  baixa: { label: 'Baixa', tom: 'neutro', peso: 0 },
};
export const PRIORIDADE_ORDEM = Object.keys(PRIORIDADE) as Prioridade[];

export const TIPO: Record<Tipo, { label: string }> = {
  post: { label: 'Post estático' },
  carrossel: { label: 'Carrossel' },
  reel: { label: 'Reel' },
  criativo: { label: 'Criativo de anúncio' },
  copy: { label: 'Copy' },
  trafego: { label: 'Tráfego pago' },
  landing_page: { label: 'Landing page' },
  branding: { label: 'Branding' },
  reuniao: { label: 'Reunião' },
  administrativo: { label: 'Administrativo' },
  outro: { label: 'Outros' },
};
export const TIPO_ORDEM = Object.keys(TIPO) as Tipo[];
export const TIPOS_CONTEUDO: Tipo[] = ['post', 'carrossel', 'reel', 'criativo'];
export const ehConteudo = (t: Tipo) => TIPOS_CONTEUDO.includes(t);

export const APROVACAO: Record<Aprovacao, { label: string; tom: Tom }> = {
  em_producao: { label: 'Em produção', tom: 'brand' },
  revisao_interna: { label: 'Revisão interna', tom: 'warning' },
  aguardando_aprovacao: { label: 'Aguardando cliente', tom: 'rosa' },
  ajustes: { label: 'Ajustes solicitados', tom: 'danger' },
  aprovado: { label: 'Aprovado', tom: 'success' },
  publicado: { label: 'Publicado', tom: 'neutro' },
};
export const APROVACAO_ORDEM = Object.keys(APROVACAO) as Aprovacao[];

export const PLATAFORMA: Record<Plataforma, { label: string }> = {
  instagram: { label: 'Instagram' },
  tiktok: { label: 'TikTok' },
  facebook: { label: 'Facebook' },
  linkedin: { label: 'LinkedIn' },
  youtube: { label: 'YouTube' },
  outra: { label: 'Outra' },
};
export const PLATAFORMA_ORDEM = Object.keys(PLATAFORMA) as Plataforma[];

export interface Ref {
  id: string;
  nome: string;
}

export interface BaseDaily {
  eu: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  podeEditar: boolean;
  fuso: string;
  membros: (Ref & { email: string; role: string })[];
  clientes: Ref[];
}

export interface ResumoConteudo {
  aprovacao: Aprovacao;
  plataformas: Plataforma[];
  publicarEm: string | null;
  publicadoEm: string | null;
  exigeLegenda: boolean;
  temLegenda: boolean;
}

export interface Tarefa {
  id: string;
  numero: number;
  titulo: string;
  tipo: Tipo;
  status: Status;
  prioridade: Prioridade;
  inicioEm: string | null;
  prazoEm: string | null;
  posicao: number;
  concluidaEm: string | null;
  arquivada: boolean;
  cliente: Ref | null;
  responsavel: Ref | null;
  parent: { id: string; titulo: string } | null;
  subtarefas: number;
  comentarios: number;
  checklist: { feitos: number; total: number };
  conteudo: ResumoConteudo | null;
  createdAt: string;
}

export interface Comentario {
  id: string;
  corpo: string;
  createdAt: string;
  autor: Ref | null;
  meu: boolean;
}

export interface ItemChecklist {
  id: string;
  texto: string;
  feito: boolean;
}

export interface TarefaDetalhe extends Tarefa {
  descricao: string | null;
  legenda: string | null;
  objetivo: string | null;
  hashtags: string | null;
  cta: string | null;
  exigeLegenda: boolean;
  plataformas: Plataforma[];
  publicarEm: string | null;
  aprovacao: Aprovacao | null;
  criador: Ref | null;
  updatedAt: string;
  itens: ItemChecklist[];
  filhas: Tarefa[];
  conversa: Comentario[];
}

export interface NovaTarefa {
  titulo: string;
  tipo?: Tipo;
  status?: Status;
  prioridade?: Prioridade;
  clientId?: string | null;
  responsavelId?: string | null;
  parentId?: string | null;
  prazoEm?: string | null;
  publicarEm?: string | null;
  plataformas?: Plataforma[];
  descricao?: string | null;
}

export type PatchTarefa = Partial<{
  titulo: string;
  descricao: string | null;
  tipo: Tipo;
  status: Status;
  prioridade: Prioridade;
  clientId: string | null;
  responsavelId: string | null;
  inicioEm: string | null;
  prazoEm: string | null;
  plataformas: Plataforma[];
  objetivo: string | null;
  legenda: string | null;
  hashtags: string | null;
  cta: string | null;
  exigeLegenda: boolean;
  publicarEm: string | null;
  aprovacao: Aprovacao;
  posicao: number;
  arquivada: boolean;
}>;

interface ItemBase {
  chave: string;
  id: string;
  titulo: string;
  inicio: string;
  cliente: Ref | null;
}
export type ItemCalendario =
  | (ItemBase & { origem: 'evento'; fim: string | null; diaInteiro: boolean; local: string | null; notas: string | null; participantes: Ref[]; criador: Ref | null })
  | (ItemBase & { origem: 'prazo'; numero: number; tipo: Tipo; status: Status; prioridade: Prioridade; concluida: boolean; responsavel: Ref | null })
  | (ItemBase & { origem: 'publicacao'; numero: number; tipo: Tipo; aprovacao: Aprovacao; concluida: boolean; responsavel: Ref | null });

export interface EventoInput {
  titulo: string;
  inicioEm: string;
  fimEm?: string | null;
  diaInteiro?: boolean;
  local?: string | null;
  notas?: string | null;
  clientId?: string | null;
  participantes?: string[];
}

const qs = (f: Record<string, string | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};
const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });

export const daily = {
  base: () => req<BaseDaily>('base'),
  tarefas: (f: Record<string, string | undefined | null>) => req<Tarefa[]>(`tarefas${qs(f)}`),
  studio: (f: Record<string, string | undefined | null>) => req<Tarefa[]>(`studio${qs(f)}`),
  detalhe: (id: string) => req<TarefaDetalhe>(`tarefas/${id}`),
  criar: (t: NovaTarefa) => req<TarefaDetalhe>('tarefas', json('POST', t)),
  atualizar: (id: string, p: PatchTarefa) => req<TarefaDetalhe>(`tarefas/${id}`, json('PATCH', p)),
  excluir: (id: string) => req<{ ok: true }>(`tarefas/${id}`, json('DELETE')),
  adicionarItem: (taskId: string, texto: string) => req<ItemChecklist>(`tarefas/${taskId}/checklist`, json('POST', { texto })),
  atualizarItem: (id: string, p: Partial<Pick<ItemChecklist, 'texto' | 'feito'>>) => req<ItemChecklist>(`checklist/${id}`, json('PATCH', p)),
  removerItem: (id: string) => req<{ ok: true }>(`checklist/${id}`, json('DELETE')),
  comentar: (taskId: string, corpo: string) => req<Comentario>(`tarefas/${taskId}/comentarios`, json('POST', { corpo })),
  removerComentario: (id: string) => req<{ ok: true }>(`comentarios/${id}`, json('DELETE')),
  calendario: (de: string, ate: string, f: { cliente?: string; meus?: boolean }) =>
    req<{ itens: ItemCalendario[] }>(`calendario${qs({ de, ate, cliente: f.cliente, meus: f.meus ? '1' : undefined })}`),
  criarEvento: (e: EventoInput) => req<{ id: string }>('eventos', json('POST', e)),
  atualizarEvento: (id: string, e: Partial<EventoInput>) => req<{ ok: true }>(`eventos/${id}`, json('PATCH', e)),
  removerEvento: (id: string) => req<{ ok: true }>(`eventos/${id}`, json('DELETE')),
};

// ───────────────────────────── datas ─────────────────────────────

/** "2026-11-16" no fuso do navegador. */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Prazo é "do dia": gravado ao meio-dia local para não trocar de dia por fuso. */
export function prazoDoDia(dia: string): string | null {
  if (!dia) return null;
  const [y, m, d] = dia.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0).toISOString();
}

export function inicioDoDia(d = new Date(), somar = 0): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + somar);
}

export type FaixaPrazo = 'atrasada' | 'hoje' | 'amanha' | 'semana' | 'depois' | 'sem';
export function faixaPrazo(prazo: string | null, concluida: boolean, agora = new Date()): FaixaPrazo {
  if (!prazo) return 'sem';
  const t = new Date(prazo).getTime();
  if (t < inicioDoDia(agora).getTime()) return concluida ? 'depois' : 'atrasada';
  if (t < inicioDoDia(agora, 1).getTime()) return 'hoje';
  if (t < inicioDoDia(agora, 2).getTime()) return 'amanha';
  if (t < inicioDoDia(agora, 7).getTime()) return 'semana';
  return 'depois';
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
/** "Hoje", "Amanhã", "Ontem", "seg, 18 nov". */
export function rotuloDia(iso: string | null, agora = new Date()): string {
  if (!iso) return 'Sem prazo';
  const d = new Date(iso);
  const dias = Math.round((inicioDoDia(d).getTime() - inicioDoDia(agora).getTime()) / 86_400_000);
  if (dias === 0) return 'Hoje';
  if (dias === 1) return 'Amanhã';
  if (dias === -1) return 'Ontem';
  const semana = d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
  const ano = d.getFullYear() !== agora.getFullYear() ? ` ${d.getFullYear()}` : '';
  return `${semana}, ${d.getDate()} ${MESES[d.getMonth()]}${ano}`;
}

export function horaLocal(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export const codigo = (n: number) => `#${n}`;
