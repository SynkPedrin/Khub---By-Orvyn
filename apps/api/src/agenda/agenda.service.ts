import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '../config/config.service';

async function audit(tx: Prisma.TransactionClient, tenantId: string, actorId: string, acao: string, entidadeId?: string) {
  await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id)
    VALUES (${tenantId}::uuid, 'humano', ${actorId}, ${acao}, 'agenda_compromisso', ${entidadeId ?? null})`;
}

const ATIVOS = ['agendado', 'confirmado'];

export interface CompromissoInput {
  titulo: string;
  inicio: string; // ISO
  fim: string;    // ISO
  contactId?: string | null;
  local?: string | null;
  notas?: string | null;
}

/**
 * Agenda: agendamentos do tenant. Booking local e real, com prevenção de choque
 * de horário; a sincronização com o Google Calendar é gated (config_required).
 */
@Injectable()
export class AgendaService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  listar(tenantId: string, range?: { de?: string; ate?: string }) {
    const where: Prisma.AgendaCompromissoWhereInput = {};
    if (range?.de || range?.ate) where.inicio = { ...(range.de ? { gte: new Date(range.de) } : {}), ...(range.ate ? { lte: new Date(range.ate) } : {}) };
    return this.prisma.withTenant(tenantId, (tx) => tx.agendaCompromisso.findMany({ where, orderBy: { inicio: 'asc' } }));
  }

  private async choca(tx: Prisma.TransactionClient, inicio: Date, fim: Date, ignorarId?: string): Promise<boolean> {
    const conflito = await tx.agendaCompromisso.findFirst({
      where: {
        status: { in: ATIVOS },
        inicio: { lt: fim },
        fim: { gt: inicio },
        ...(ignorarId ? { id: { not: ignorarId } } : {}),
      },
      select: { id: true },
    });
    return !!conflito;
  }

  async criar(tenantId: string, identityId: string, dto: CompromissoInput) {
    const inicio = new Date(dto.inicio); const fim = new Date(dto.fim);
    if (isNaN(+inicio) || isNaN(+fim)) throw new BadRequestException('datas inválidas');
    if (fim <= inicio) throw new BadRequestException('o fim deve ser depois do início');
    return this.prisma.withTenant(tenantId, async (tx) => {
      if (await this.choca(tx, inicio, fim)) throw new ConflictException('já existe um compromisso nesse horário');
      const c = await tx.agendaCompromisso.create({
        data: { tenantId, titulo: dto.titulo.trim(), inicio, fim, contactId: dto.contactId ?? null, local: dto.local ?? null, notas: dto.notas ?? null, createdBy: identityId },
      });
      await audit(tx, tenantId, identityId, 'compromisso.criado', c.id);
      return c;
    });
  }

  async atualizarStatus(tenantId: string, identityId: string, id: string, status: string) {
    if (!['agendado', 'confirmado', 'concluido', 'cancelado', 'nao_compareceu'].includes(status)) throw new BadRequestException('status inválido');
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existe = await tx.agendaCompromisso.findFirst({ where: { id }, select: { id: true } });
      if (!existe) throw new NotFoundException('compromisso inexistente');
      const c = await tx.agendaCompromisso.update({ where: { id }, data: { status, updatedAt: new Date() } });
      await audit(tx, tenantId, identityId, `compromisso.${status}`, id);
      return c;
    });
  }

  async remover(tenantId: string, identityId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existe = await tx.agendaCompromisso.findFirst({ where: { id }, select: { id: true } });
      if (!existe) throw new NotFoundException('compromisso inexistente');
      await tx.agendaCompromisso.delete({ where: { id } });
      await audit(tx, tenantId, identityId, 'compromisso.removido', id);
      return { ok: true };
    });
  }

  /**
   * Horários livres num dia: gera slots de `das`..`ate` (passo = duração) e remove
   * os que colidem com compromissos ativos. Horário no fuso do servidor (o cliente
   * envia o dia; a exibição é local). Sem depender de API externa.
   */
  async sugerirHorarios(tenantId: string, data: string, duracaoMin = 60, das = 9, ate = 18): Promise<{ inicio: string; fim: string }[]> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new BadRequestException('data deve ser YYYY-MM-DD');
    if (duracaoMin < 5 || duracaoMin > 480) throw new BadRequestException('duração inválida');
    const diaInicio = new Date(`${data}T00:00:00`);
    const diaFim = new Date(`${data}T23:59:59`);
    const ocupados = await this.prisma.withTenant(tenantId, (tx) =>
      tx.agendaCompromisso.findMany({ where: { status: { in: ATIVOS }, inicio: { gte: diaInicio, lte: diaFim } }, select: { inicio: true, fim: true } }),
    );
    const livres: { inicio: string; fim: string }[] = [];
    const passoMs = duracaoMin * 60_000;
    for (let h = das; h < ate; h += duracaoMin / 60) {
      const ini = new Date(`${data}T${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}:00`);
      const fim = new Date(+ini + passoMs);
      if (fim.getHours() > ate || (fim.getHours() === ate && fim.getMinutes() > 0)) break;
      const colide = ocupados.some((o) => o.inicio < fim && o.fim > ini);
      if (!colide) livres.push({ inicio: ini.toISOString(), fim: fim.toISOString() });
    }
    return livres;
  }

  /**
   * Sincroniza o compromisso com o Google Calendar. Gated: sem as credenciais do
   * Google → 501 config_required (o push real usa o OAuth do usuário — plugar a API).
   */
  async sincronizarCalendar(_tenantId: string, _identityId: string, _id: string): Promise<{ googleEventId: string }> {
    this.config.require('google_calendar'); // 501 se faltar GOOGLE_CLIENT_ID/SECRET
    // Com a credencial + token OAuth do usuário, aqui entra o events.insert do
    // Google Calendar. Até lá, o gating acima já bloqueia de forma honesta; se a
    // credencial existir mas a conexão OAuth não foi concluída, avisamos claro.
    throw new BadRequestException('conclua a conexão do Google Calendar para sincronizar');
  }
}
