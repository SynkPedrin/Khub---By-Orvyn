import type { Prisma } from '@prisma/client';
import type { Contexto } from './executor.service';

/**
 * Registro do banco → o que o fluxo enxerga em `{{contato.*}}`/`{{negocio.*}}`
 * e nas condições (Q3.1). Um lugar só: gatilho, teste, agente, webhook, agenda
 * e a releitura da condição montam o MESMO formato — sem isso, um operando novo
 * (dono, não perturbe, campo personalizado) existia num caminho e não no outro.
 */

const objeto = (v: Prisma.JsonValue | null | undefined): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export interface RegistroContato {
  id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  empresa: string | null;
  tag: string;
  tags: string[];
  valorEstimado: Prisma.Decimal | number | null;
  camposCustom?: Prisma.JsonValue;
  ownerId?: string | null;
  optedOutAt?: Date | null;
  origem?: string | null;
  proximaAcaoAt?: Date | null;
  createdAt?: Date;
}

export function contatoDoRegistro(c: RegistroContato): NonNullable<Contexto['contato']> {
  return {
    id: c.id, nome: c.nome, email: c.email, telefone: c.telefone, empresa: c.empresa,
    tag: c.tag, tags: c.tags ?? [], valor: Number(c.valorEstimado ?? 0),
    campos: objeto(c.camposCustom),
    ownerId: c.ownerId ?? null,
    naoPerturbe: !!c.optedOutAt,
    origem: c.origem ?? null,
    proximaAcaoAt: c.proximaAcaoAt ? c.proximaAcaoAt.toISOString() : null,
    ...(c.createdAt ? { criadoEm: c.createdAt.toISOString() } : {}),
  };
}

export interface RegistroNegocio {
  id: string;
  titulo: string;
  valor: Prisma.Decimal | number | null;
  stageId: string;
  origem: string | null;
  status?: string;
  ownerId?: string | null;
  camposCustom?: Prisma.JsonValue;
}

export function negocioDoRegistro(d: RegistroNegocio): NonNullable<Contexto['negocio']> {
  return {
    id: d.id, titulo: d.titulo, valor: Number(d.valor ?? 0), stageId: d.stageId, origem: d.origem,
    status: d.status ?? 'aberto', ownerId: d.ownerId ?? null, campos: objeto(d.camposCustom),
  };
}
