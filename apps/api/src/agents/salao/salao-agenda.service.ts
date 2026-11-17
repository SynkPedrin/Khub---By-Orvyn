import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MessagesService } from '../../crm/messaging/messages.service';
import {
  acharProfissional,
  acharServico,
  diaDaSemana,
  duracaoTipica,
  horariosLivres,
  inferirExpedientes,
  partesLocais,
  profissionaisDoServico,
  somarDiasData,
  instanteNoFuso,
  type AtendimentoHist,
  type Expedientes,
  type ProfissionalCatalogo,
  type ServicoCatalogo,
} from './agenda-salao';

const ATIVOS = ['agendado', 'confirmado'];
/** Histórico usado para deduzir expediente e quem faz cada serviço. */
const JANELA_HISTORICO_DIAS = 120;
const CACHE_MS = 10 * 60_000;
const DIAS_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export interface PedidoHorarios {
  servico: string;
  data: string;
  profissional?: string;
  horario?: string;
}

export interface PedidoReserva {
  servico: string;
  profissional: string;
  inicio: string;
}

interface Base {
  servicos: ServicoCatalogo[];
  profissionais: ProfissionalCatalogo[];
  hist: AtendimentoHist[];
  expedientes: Expedientes;
}

/** Erro que vai de volta para o agente como orientação (não é falha de sistema). */
export class OrientacaoAgente extends Error {}

/**
 * Agenda de salão para os agentes (ver agenda-salao.ts): horários livres por
 * profissional com a duração do serviço, e reserva com aviso no WhatsApp da
 * equipe (o número da "Notificação Interna" importada do GHL).
 */
@Injectable()
export class SalaoAgendaService {
  private readonly log = new Logger(SalaoAgendaService.name);
  private cache = new Map<string, { em: number; base: Base; fuso: string }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly mensagens: MessagesService,
  ) {}

  /** O tenant opera como salão? (tem catálogo de profissionais e serviços) */
  async ehSalao(tenantId: string): Promise<boolean> {
    const n = await this.prisma.withTenant(tenantId, (tx) => tx.profissional.count({ where: { ativo: true } }));
    return n > 0;
  }

  private async base(tenantId: string, fuso: string): Promise<Base> {
    const c = this.cache.get(tenantId);
    if (c && c.fuso === fuso && Date.now() - c.em < CACHE_MS) return c.base;
    const desde = new Date(Date.now() - JANELA_HISTORICO_DIAS * 86_400_000);
    const [servicos, profissionais, linhas] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        tx.servico.findMany({ where: { ativo: true }, select: { id: true, nome: true, duracaoMin: true, precoCentavos: true } }),
        tx.profissional.findMany({ where: { ativo: true }, orderBy: { nome: 'asc' }, select: { id: true, nome: true } }),
        tx.agendaCompromisso.findMany({
          where: { inicio: { gte: desde, lt: new Date() }, profissionalId: { not: null }, status: { notIn: ['cancelado'] } },
          select: { profissionalId: true, servicoId: true, inicio: true, fim: true },
        }),
      ]),
    );
    const hist = linhas.map((l) => ({ profissionalId: l.profissionalId!, servicoId: l.servicoId, inicio: +l.inicio, fim: +l.fim }));
    // Duração real (mediana do histórico) vence a do catálogo importado.
    const comDuracao = servicos.map((sv) => ({ ...sv, duracaoMin: duracaoTipica(hist, sv.id) ?? sv.duracaoMin }));
    const base = { servicos: comDuracao, profissionais, hist, expedientes: inferirExpedientes(hist, fuso) };
    this.cache.set(tenantId, { em: Date.now(), base, fuso });
    return base;
  }

  /** Ocupações ativas por profissional numa faixa de dias (inclui o que a IA e a equipe marcaram). */
  private async ocupados(tenantId: string, de: number, ate: number): Promise<Map<string, { inicio: number; fim: number }[]>> {
    const linhas = await this.prisma.withTenant(tenantId, (tx) =>
      tx.agendaCompromisso.findMany({
        where: { inicio: { lt: new Date(ate) }, fim: { gt: new Date(de) }, status: { in: ATIVOS }, profissionalId: { not: null } },
        select: { profissionalId: true, inicio: true, fim: true },
      }),
    );
    const m = new Map<string, { inicio: number; fim: number }[]>();
    for (const l of linhas) m.set(l.profissionalId!, [...(m.get(l.profissionalId!) ?? []), { inicio: +l.inicio, fim: +l.fim }]);
    return m;
  }

  private resolverServico(base: Base, termo: string): ServicoCatalogo {
    const pop = new Map<string, number>();
    for (const a of base.hist) if (a.servicoId) pop.set(a.servicoId, (pop.get(a.servicoId) ?? 0) + 1);
    const r = acharServico(base.servicos, termo, pop);
    if (r.servico) return r.servico;
    if (r.candidatos.length) {
      throw new OrientacaoAgente(`serviço "${termo}" é ambíguo; pergunte à cliente qual destes: ${r.candidatos.map((s) => s.nome).join('; ')}`);
    }
    throw new OrientacaoAgente(`serviço "${termo}" não está no catálogo do salão; confirme o nome com a cliente ou transfira para a equipe`);
  }

  /** Quem pode fazer o serviço (histórico); sem histórico do serviço, quem tem expediente. */
  private candidatas(base: Base, servico: ServicoCatalogo): ProfissionalCatalogo[] {
    const fazem = profissionaisDoServico(base.hist, servico.id);
    const lista = base.profissionais.filter((p) => base.expedientes.has(p.id) && (fazem.size === 0 || fazem.has(p.id)));
    return lista;
  }

  async horarios(tenantId: string, pedido: PedidoHorarios, fuso: string, agora = Date.now()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(pedido.data)) throw new OrientacaoAgente('data deve ser AAAA-MM-DD');
    const base = await this.base(tenantId, fuso);
    const servico = this.resolverServico(base, pedido.servico);
    let profs = this.candidatas(base, servico);
    if (pedido.profissional) {
      const p = acharProfissional(base.profissionais, pedido.profissional);
      if (!p) throw new OrientacaoAgente(`não há profissional "${pedido.profissional}" no salão; quem faz ${servico.nome}: ${profs.map((x) => x.nome).join(', ') || 'ninguém com agenda'}`);
      if (!profs.some((x) => x.id === p.id)) {
        throw new OrientacaoAgente(`${p.nome} não faz ${servico.nome} (ou não tem agenda); quem faz: ${profs.map((x) => x.nome).join(', ') || 'ninguém com agenda'}`);
      }
      profs = [p];
    }
    if (!profs.length) throw new OrientacaoAgente(`nenhuma profissional com agenda para ${servico.nome}; transfira para a equipe`);

    const dia = (data: string) => this.livresDoDia(tenantId, base, profs, servico, data, fuso, agora);
    const doDia = await dia(pedido.data);
    const resposta: Record<string, unknown> = {
      servico: { nome: servico.nome, duracaoMin: servico.duracaoMin, preco: servico.precoCentavos ? `R$ ${(servico.precoCentavos / 100).toFixed(2).replace('.', ',')}` : null },
      data: pedido.data,
      diaSemana: DIAS_SEMANA[diaDaSemana(pedido.data)],
      profissionais: doDia.filter((d) => d.horarios.length).map((d) => ({ nome: d.nome, horarios: d.horarios.slice(0, 10) })),
      naoAtendemNesseDia: doDia.filter((d) => d.semExpediente).map((d) => d.nome),
    };
    if (pedido.horario && /^\d{2}:\d{2}$/.test(pedido.horario)) {
      const livresNoHorario = doDia.filter((d) => d.horarios.includes(pedido.horario!)).map((d) => d.nome);
      resposta.solicitado = { horario: pedido.horario, disponivelCom: livresNoHorario };
    }
    if (!doDia.some((d) => d.horarios.length)) {
      // Nada no dia: os próximos 7 dias com vaga (até 3 dias, 4 horários cada).
      const proximos: { data: string; diaSemana: string; opcoes: string[] }[] = [];
      for (let i = 1; i <= 7 && proximos.length < 3; i++) {
        const data = somarDiasData(pedido.data, i);
        const r = await dia(data);
        const opcoes = r.flatMap((d) => d.horarios.map((h) => `${h} com ${d.nome}`)).sort().slice(0, 4);
        if (opcoes.length) proximos.push({ data, diaSemana: DIAS_SEMANA[diaDaSemana(data)], opcoes });
      }
      resposta.semVagaNesseDia = true;
      resposta.proximosDiasComVaga = proximos;
    }
    return resposta;
  }

  private async livresDoDia(tenantId: string, base: Base, profs: ProfissionalCatalogo[], servico: ServicoCatalogo, data: string, fuso: string, agora: number) {
    const ini = instanteNoFuso(data, 0, fuso);
    const ocup = await this.ocupados(tenantId, ini, ini + 86_400_000);
    const ds = diaDaSemana(data);
    return profs.map((p) => {
      const janela = base.expedientes.get(p.id)?.get(ds);
      if (!janela) return { nome: p.nome, id: p.id, horarios: [] as string[], semExpediente: true };
      const livres = horariosLivres({ data, janela, duracaoMin: servico.duracaoMin, ocupados: ocup.get(p.id) ?? [], fuso, agora });
      const hhmm = (ms: number) => {
        const m = partesLocais(ms, fuso).minutos;
        return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      };
      return { nome: p.nome, id: p.id, horarios: livres.map(hhmm), semExpediente: false };
    });
  }

  /**
   * Reserva: revalida sob a mesma trava da agenda (AgendaService), grava o
   * atendimento com profissional e serviço e avisa a equipe no WhatsApp.
   */
  async reservar(
    tenantId: string,
    ctx: { agentId: string | null; agentNome: string; contactId: string },
    pedido: PedidoReserva,
    fuso: string,
    agora = Date.now(),
  ) {
    const base = await this.base(tenantId, fuso);
    const servico = this.resolverServico(base, pedido.servico);
    const prof = acharProfissional(base.profissionais, pedido.profissional);
    if (!prof) throw new OrientacaoAgente(`profissional "${pedido.profissional}" não encontrada; use um nome que veio em ver_horarios_salao`);
    const inicio = new Date(pedido.inicio);
    if (Number.isNaN(+inicio)) throw new OrientacaoAgente('horário inválido');
    const local = partesLocais(+inicio, fuso);
    const janela = base.expedientes.get(prof.id)?.get(local.diaSemana);
    const hora = `${String(Math.floor(local.minutos / 60)).padStart(2, '0')}:${String(local.minutos % 60).padStart(2, '0')}`;
    const livres = janela ? horariosLivres({ data: local.data, janela, duracaoMin: servico.duracaoMin, ocupados: [], fuso, agora }) : [];
    if (!livres.includes(+inicio)) {
      throw new OrientacaoAgente(`${hora} de ${local.data} não é um horário oferecido para ${prof.nome}; consulte ver_horarios_salao e ofereça um horário da lista`);
    }
    const fim = new Date(+inicio + servico.duracaoMin * 60_000);

    const { compromisso, contato } = await this.prisma.withTenant(tenantId, async (tx) => {
      // Mesma trava da AgendaService: reserva e agenda manual não se cruzam.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`agenda:${tenantId}`}, 0))`;
      const choque = await tx.agendaCompromisso.findFirst({
        where: { profissionalId: prof.id, status: { in: ATIVOS }, inicio: { lt: fim }, fim: { gt: inicio } },
        select: { id: true },
      });
      if (choque) throw new OrientacaoAgente(`${prof.nome} acabou de ser reservada às ${hora}; consulte ver_horarios_salao de novo e ofereça outro horário`);
      const contato = await tx.contact.findUnique({ where: { id: ctx.contactId }, select: { nome: true, telefone: true } });
      const c = await tx.agendaCompromisso.create({
        data: {
          tenantId,
          titulo: `${servico.nome} — ${contato?.nome ?? 'Cliente'}`.slice(0, 120),
          inicio,
          fim,
          contactId: ctx.contactId,
          servicoId: servico.id,
          profissionalId: prof.id,
          tipo: 'outro',
          status: 'agendado',
          valorCentavos: servico.precoCentavos || null,
          notas: `Reservado pela ${ctx.agentNome} no WhatsApp.`,
          createdBy: null,
        },
      });
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id)
        VALUES (${tenantId}::uuid, 'nyro', ${ctx.agentId ?? 'agente'}, 'compromisso.criado', 'agenda_compromisso', ${c.id})`;
      return { compromisso: c, contato };
    });
    this.cache.delete(tenantId);

    const quando = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(inicio);
    const aviso = await this.avisarEquipe(tenantId, compromisso.id, [
      `📅 NOVO AGENDAMENTO PELA ${ctx.agentNome.toUpperCase()}`,
      '',
      `CLIENTE: ${contato?.nome ?? '-'}`,
      `TELEFONE: ${contato?.telefone ?? '-'}`,
      `SERVIÇO: ${servico.nome}`,
      `PROFISSIONAL: ${prof.nome}`,
      `QUANDO: ${quando}`,
      '',
      '*Conferir e confirmar com a cliente (e o sinal, se houver).*',
    ].join('\n'));
    return {
      compromissoId: compromisso.id,
      servico: servico.nome,
      profissional: prof.nome,
      quando,
      duracaoMin: servico.duracaoMin,
      equipeAvisada: aviso.ok,
      ...(aviso.ok ? {} : { avisoEquipe: aviso.motivo }),
    };
  }

  /**
   * Número da equipe = o da automação "Notificação Interna" importada do GHL
   * (fonte única: trocar lá troca aqui). Sem ela, qualquer automação ativa
   * com "Notificar equipe".
   */
  async telefoneEquipe(tenantId: string): Promise<string | null> {
    const fluxos = await this.prisma.withTenant(tenantId, (tx) =>
      tx.workflow.findMany({ where: { status: 'ativo', versaoAtivaId: { not: null } }, select: { nome: true, versaoAtiva: { select: { grafo: true } } } }),
    );
    const telefones = (grafo: unknown): string[] => {
      const nos = (grafo as { nos?: { id?: string; tipo?: string; config?: { telefone?: unknown } }[] } | null)?.nos ?? [];
      return nos
        .filter((n) => n.tipo === 'acao.notificar_equipe' && typeof n.config?.telefone === 'string')
        .sort((a, b) => Number(b.id === 'avisa_servico') - Number(a.id === 'avisa_servico'))
        .map((n) => String(n.config!.telefone).replace(/\D/g, ''))
        .filter((t) => t.length >= 10);
    };
    const ghl = fluxos.filter((f) => /notifica/i.test(f.nome) && /ghl/i.test(f.nome));
    for (const f of [...ghl, ...fluxos]) {
      const t = telefones(f.versaoAtiva?.grafo)[0];
      if (t) return t;
    }
    return null;
  }

  private async avisarEquipe(tenantId: string, compromissoId: string, texto: string): Promise<{ ok: boolean; motivo?: string }> {
    try {
      const fone = await this.telefoneEquipe(tenantId);
      if (!fone) return { ok: false, motivo: 'nenhuma automação de Notificação Interna ativa com telefone' };
      const r = await this.mensagens.notificarNumero(tenantId, fone, texto, `agenda-salao:${compromissoId}`);
      return r.status === 'sent' ? { ok: true } : { ok: false, motivo: `envio ${r.status}${r.erro ? `: ${r.erro}` : ''}` };
    } catch (e) {
      this.log.warn(`aviso da equipe falhou (reserva ${compromissoId}): ${(e as Error).message.slice(0, 200)}`);
      return { ok: false, motivo: 'falha no envio' };
    }
  }
}
