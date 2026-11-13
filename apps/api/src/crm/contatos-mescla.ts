import type { Prisma } from '@prisma/client';

/** Regras PURAS de duplicados e mesclagem de contatos (Q2.2). */

export interface ParDuplicado {
  motivo: 'email' | 'telefone';
  chave: string;
  ids: string[];
}
export interface GrupoDuplicado {
  ids: string[];
  motivos: ('email' | 'telefone')[];
}

/**
 * Junta pares "mesmo e-mail" e "mesmo telefone" em grupos (union-find): se A
 * e B têm o mesmo e-mail e B e C o mesmo telefone, A, B e C são UMA pessoa
 * e precisam aparecer num grupo só, senão a tela pede duas mesclagens.
 */
export function agruparDuplicados(pares: ParDuplicado[]): GrupoDuplicado[] {
  const pai = new Map<string, string>();
  const raiz = (x: string): string => {
    let r = x;
    while (pai.get(r) !== r) r = pai.get(r)!;
    let c = x;
    while (pai.get(c) !== r) { const n = pai.get(c)!; pai.set(c, r); c = n; }
    return r;
  };
  for (const p of pares) for (const id of p.ids) if (!pai.has(id)) pai.set(id, id);
  for (const p of pares) {
    const [a, ...resto] = p.ids;
    for (const b of resto) {
      const ra = raiz(a);
      const rb = raiz(b);
      if (ra !== rb) pai.set(rb, ra);
    }
  }
  const grupos = new Map<string, { ids: string[]; motivos: Set<'email' | 'telefone'> }>();
  const ordem: string[] = [];
  for (const p of pares) {
    for (const id of p.ids) {
      const r = raiz(id);
      if (!grupos.has(r)) { grupos.set(r, { ids: [], motivos: new Set() }); ordem.push(r); }
      const g = grupos.get(r)!;
      if (!g.ids.includes(id)) g.ids.push(id);
      g.motivos.add(p.motivo);
    }
  }
  return ordem.map((r) => ({ ids: grupos.get(r)!.ids, motivos: [...grupos.get(r)!.motivos].sort() }));
}

/** O que importa de um contato para fundir os dados no principal. */
export interface ContatoFundivel {
  id: string;
  email: string | null;
  telefone: string | null;
  empresa: string | null;
  cargo: string | null;
  origem: string | null;
  localizacao: string | null;
  site: string | null;
  linkedin: string | null;
  companyId: string | null;
  ownerId: string | null;
  fotoUrl: string | null;
  fotoEm: Date | null;
  tags: string[];
  camposCustom: Prisma.JsonValue;
  consentimento: Prisma.JsonValue;
  valorEstimado: number;
  optedOutAt: Date | null;
  ultimoContatoAt: Date | null;
  lastInboundAt: Date | null;
  createdAt: Date;
}

const obj = (v: Prisma.JsonValue): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const vazio = (v: unknown) => v === null || v === undefined || v === '';
const maxData = (...ds: (Date | null)[]) => ds.filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
const minData = (...ds: (Date | null)[]) => ds.filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

/**
 * Dados finais do principal. Regras: o principal manda; o que nele está
 * VAZIO é completado pelos duplicados, do mais antigo para o mais novo.
 * Tags somam. "Não perturbe" de qualquer um vale para o principal (pedir
 * para não receber mensagem é da pessoa, não do registro — LGPD). Datas de
 * último contato ficam com a mais recente.
 */
export function fundirContatos(principal: ContatoFundivel, duplicados: ContatoFundivel[]) {
  const dups = [...duplicados].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const escalar = <K extends 'email' | 'telefone' | 'empresa' | 'cargo' | 'origem' | 'localizacao' | 'site' | 'linkedin' | 'companyId' | 'ownerId'>(k: K) =>
    vazio(principal[k]) ? (dups.find((d) => !vazio(d[k]))?.[k] ?? principal[k]) : principal[k];

  const tags = [...principal.tags];
  for (const d of dups) for (const t of d.tags) if (!tags.some((x) => x.toLowerCase() === t.toLowerCase())) tags.push(t);

  const campos: Record<string, unknown> = {};
  for (const d of [...dups].reverse()) Object.assign(campos, obj(d.camposCustom)); // mais antigo sobrepõe o mais novo
  for (const [k, v] of Object.entries(obj(principal.camposCustom))) if (!vazio(v)) campos[k] = v;
  for (const [k, v] of Object.entries(obj(principal.camposCustom))) if (vazio(v) && campos[k] === undefined) campos[k] = v;

  const consentimento = Object.keys(obj(principal.consentimento)).length ? principal.consentimento : (dups.find((d) => Object.keys(obj(d.consentimento)).length)?.consentimento ?? principal.consentimento);
  const foto = principal.fotoUrl ? principal : (dups.find((d) => d.fotoUrl) ?? principal);

  return {
    email: escalar('email'), telefone: escalar('telefone'), empresa: escalar('empresa'), cargo: escalar('cargo'),
    origem: escalar('origem'), localizacao: escalar('localizacao'), site: escalar('site'), linkedin: escalar('linkedin'),
    companyId: escalar('companyId'), ownerId: escalar('ownerId'),
    fotoUrl: foto.fotoUrl, fotoEm: foto.fotoEm,
    tags,
    camposCustom: campos,
    consentimento,
    valorEstimado: Math.max(principal.valorEstimado, ...dups.map((d) => d.valorEstimado)),
    optedOutAt: minData(principal.optedOutAt, ...dups.map((d) => d.optedOutAt)),
    ultimoContatoAt: maxData(principal.ultimoContatoAt, ...dups.map((d) => d.ultimoContatoAt)),
    lastInboundAt: maxData(principal.lastInboundAt, ...dups.map((d) => d.lastInboundAt)),
  };
}

/** Identificador SQL vindo do catálogo — validado antes de virar `Prisma.raw`. */
export const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;
