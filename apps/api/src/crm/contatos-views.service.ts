import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { COLUNAS, parseFiltro, parseOrdem, type FiltroContatos, type OrdemContatos } from './contatos-filtro';

export interface ContactViewInput {
  nome?: string;
  filtros?: unknown;
  colunas?: unknown;
  ordem?: unknown;
  compartilhada?: boolean;
}
export interface ContactViewDto {
  id: string;
  nome: string;
  filtros: FiltroContatos;
  colunas: string[];
  ordem: OrdemContatos;
  compartilhada: boolean;
  ownerIdentityId: string;
  minha: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const MAX_VIEWS_POR_USUARIO = 50;

/** Colunas: subconjunto ordenado e sem repetição do catálogo `COLUNAS`. */
export function parseColunas(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new BadRequestException('colunas: esperado uma lista');
  const validas = new Set<string>(COLUNAS);
  const out: string[] = [];
  for (const c of v) {
    if (typeof c !== 'string' || !validas.has(c)) throw new BadRequestException(`coluna desconhecida: ${String(c)}`);
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

const nomeValido = (n: unknown): string => {
  const s = typeof n === 'string' ? n.replace(/\s+/g, ' ').trim() : '';
  if (!s || s.length > 80) throw new BadRequestException('nome da lista: de 1 a 80 caracteres');
  return s;
};

/**
 * Listas salvas (smart lists, Q2.2 · db/052). Visíveis: as minhas + as
 * compartilhadas do MESMO tenant (RLS). Só quem criou altera ou apaga.
 */
@Injectable()
export class ContatosViewsService {
  constructor(private readonly prisma: PrismaService) {}

  private dto(v: { id: string; nome: string; filtros: Prisma.JsonValue; colunas: Prisma.JsonValue; ordem: string; compartilhada: boolean; ownerIdentityId: string; createdAt: Date; updatedAt: Date }, identityId: string): ContactViewDto {
    return {
      id: v.id, nome: v.nome,
      // filtro gravado por versão anterior que não valida mais vira "sem filtro", não 500
      filtros: (() => { try { return parseFiltro(v.filtros); } catch { return {}; } })(),
      colunas: Array.isArray(v.colunas) ? (v.colunas.filter((c) => typeof c === 'string') as string[]) : [],
      ordem: (() => { try { return parseOrdem(v.ordem); } catch { return 'recentes' as const; } })(),
      compartilhada: v.compartilhada, ownerIdentityId: v.ownerIdentityId, minha: v.ownerIdentityId === identityId,
      createdAt: v.createdAt, updatedAt: v.updatedAt,
    };
  }

  async listar(tenantId: string, identityId: string): Promise<ContactViewDto[]> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.contactView.findMany({
        where: { OR: [{ ownerIdentityId: identityId }, { compartilhada: true }] },
        orderBy: [{ nome: 'asc' }, { id: 'asc' }],
      });
      return rows.map((r) => this.dto(r, identityId));
    });
  }

  async criar(tenantId: string, identityId: string, input: ContactViewInput): Promise<ContactViewDto> {
    const nome = nomeValido(input.nome);
    const filtros = parseFiltro(input.filtros);
    const colunas = parseColunas(input.colunas);
    const ordem = parseOrdem(input.ordem);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const n = await tx.contactView.count({ where: { ownerIdentityId: identityId } });
      if (n >= MAX_VIEWS_POR_USUARIO) throw new BadRequestException(`limite de ${MAX_VIEWS_POR_USUARIO} listas salvas por pessoa`);
      try {
        const v = await tx.contactView.create({
          data: { tenantId, nome, filtros: filtros as Prisma.InputJsonValue, colunas, ordem, ownerIdentityId: identityId, compartilhada: input.compartilhada ?? false },
        });
        return this.dto(v, identityId);
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('você já tem uma lista com esse nome');
        throw e;
      }
    });
  }

  async atualizar(tenantId: string, identityId: string, id: string, input: ContactViewInput): Promise<ContactViewDto> {
    const data: Prisma.ContactViewUpdateInput = { updatedAt: new Date() };
    if (input.nome !== undefined) data.nome = nomeValido(input.nome);
    if (input.filtros !== undefined) data.filtros = parseFiltro(input.filtros) as Prisma.InputJsonValue;
    if (input.colunas !== undefined) data.colunas = parseColunas(input.colunas);
    if (input.ordem !== undefined) data.ordem = parseOrdem(input.ordem);
    if (input.compartilhada !== undefined) data.compartilhada = input.compartilhada;
    return this.prisma.withTenant(tenantId, async (tx) => {
      await this.daPessoa(tx, id, identityId);
      try {
        const v = await tx.contactView.update({ where: { id }, data });
        return this.dto(v, identityId);
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('você já tem uma lista com esse nome');
        throw e;
      }
    });
  }

  async remover(tenantId: string, identityId: string, id: string): Promise<{ ok: true }> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      await this.daPessoa(tx, id, identityId);
      await tx.contactView.delete({ where: { id } });
      return { ok: true as const };
    });
  }

  /** Existe no tenant (RLS) e é de quem pede. Compartilhada de outro: só leitura. */
  private async daPessoa(tx: Prisma.TransactionClient, id: string, identityId: string) {
    const v = await tx.contactView.findUnique({ where: { id }, select: { ownerIdentityId: true } });
    if (!v) throw new NotFoundException('lista salva inexistente');
    if (v.ownerIdentityId !== identityId) throw new ForbiddenException('só quem criou a lista pode alterá-la');
  }
}
