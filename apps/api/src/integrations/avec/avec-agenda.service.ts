import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '../../config/config.service';
import { CryptoService } from '../crypto.service';
import { acharContatoPorTelefone } from '../../crm/telefone';
import { fusoPadrao, instanteNoFuso, partesLocais } from '../../common/hora';
import { AvecCliente, ErroAvec, type CredenciaisAvec, type ProfissionalAvec } from './avec.client';
import { itensDoDia, jornadaDoDia, mapearProfissionais, normalizarNome, planejarDia, type LinhaKhub, type PlanoDia } from './avec-agenda';

export const PROVIDER_AVEC = 'avec';
/** Janela sincronizada pelo agendador: hoje + 60 dias. */
export const DIAS_JANELA = 60;
/** Leitura ao vivo de um dia (antes de oferecer/reservar) reaproveitada por 60 s. */
const FRESCOR_DIA_MS = 60_000;
const CACHE_PROFISSIONAIS_MS = 30 * 60_000;

export interface ResumoSync {
  dias: number;
  criados: number;
  atualizados: number;
  adotados: number;
  cancelados: number;
  conflitosIa: number;
  semProfissional: number;
  falhas: string[];
}

interface Conexao {
  integrationId: string;
  versao: number;
  cliente: AvecCliente;
  corteLegado: number;
  profissionais?: { em: number; lista: ProfissionalAvec[] };
}

const somarDias = (data: string, n: number) => {
  const [y, m, d] = data.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/**
 * Agenda do Avec dentro da agenda do KHUB (ADR-0052, BUG-050). Somente
 * leitura do Avec; escreve só em agenda_compromissos/agenda_jornadas, sem
 * disparar automação (o salão já avisa a cliente pelo Avec). Ver avec-agenda.ts.
 */
@Injectable()
export class AvecAgendaService {
  private readonly log = new Logger(AvecAgendaService.name);
  private conexoes = new Map<string, Conexao>();
  private frescor = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
  ) {}

  /** Conecta (ou troca a senha): testa o login e a lista de profissionais antes de gravar. */
  async conectar(tenantId: string, ator: { identityId: string; role: string }, c: CredenciaisAvec) {
    if (!['owner', 'admin'].includes(ator.role)) throw new ForbiddenException('só proprietário ou administrador conecta o Avec');
    this.config.require('integrations_crypto');
    const cliente = new AvecCliente(c);
    let profissionais: ProfissionalAvec[];
    try {
      await cliente.entrar();
      profissionais = await cliente.profissionais();
    } catch (e) {
      throw new BadRequestException(e instanceof ErroAvec ? e.message : 'não foi possível entrar no Avec com esses dados');
    }
    const integ = await this.prisma.withTenant(tenantId, async (tx) => {
      const ja = await tx.integration.findFirst({ where: { provider: PROVIDER_AVEC }, select: { id: true, connectedAt: true } });
      const dados = {
        status: 'connected',
        externalBusinessId: String(c.salaoId),
        credentialsEncrypted: this.crypto.encryptJson(c),
        scopes: ['agenda:leitura'],
        connectedBy: ator.identityId,
        health: 'ok',
        erro: null,
      };
      const r = ja
        ? await tx.integration.update({ where: { id: ja.id }, data: { ...dados, connectedAt: ja.connectedAt ?? new Date() } })
        : await tx.integration.create({ data: { tenantId, provider: PROVIDER_AVEC, ...dados, connectedAt: new Date() } });
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id)
        VALUES (${tenantId}::uuid, 'humano', ${ator.identityId}, 'integracao.avec.conectada', 'integration', ${r.id})`;
      return r;
    });
    this.conexoes.delete(tenantId);
    const khub = await this.prisma.withTenant(tenantId, (tx) => tx.profissional.findMany({ where: { ativo: true }, select: { id: true, nome: true } }));
    const mapa = mapearProfissionais(profissionais, khub);
    return {
      integrationId: integ.id,
      profissionais: profissionais.map((p) => ({ avec: p.apelido || p.nome, khub: khub.find((k) => k.id === mapa.get(p.id))?.nome ?? null })),
    };
  }

  async estado(tenantId: string) {
    const i = await this.prisma.withTenant(tenantId, (tx) =>
      tx.integration.findFirst({ where: { provider: PROVIDER_AVEC }, select: { status: true, health: true, erro: true, lastSyncAt: true, connectedAt: true } }),
    );
    return i ? { conectado: i.status === 'connected', saude: i.health, erro: i.erro, ultimaSincronizacao: i.lastSyncAt, conectadoEm: i.connectedAt } : { conectado: false };
  }

  /** Cliente do Avec do tenant (cache por processo). null = salão sem Avec conectado. */
  private async conexao(tenantId: string): Promise<Conexao | null> {
    const i = await this.prisma.withTenant(tenantId, (tx) =>
      tx.integration.findFirst({
        where: { provider: PROVIDER_AVEC, status: 'connected', credentialsEncrypted: { not: null } },
        select: { id: true, credentialsEncrypted: true, updatedAt: true, connectedAt: true },
      }),
    );
    if (!i?.credentialsEncrypted) {
      this.conexoes.delete(tenantId);
      return null;
    }
    const c = this.conexoes.get(tenantId);
    if (c && c.integrationId === i.id && c.versao === +i.updatedAt) return c;
    const nova: Conexao = {
      integrationId: i.id,
      versao: +i.updatedAt,
      cliente: new AvecCliente(this.crypto.decryptJson<CredenciaisAvec>(i.credentialsEncrypted)),
      corteLegado: +(i.connectedAt ?? i.updatedAt),
    };
    this.conexoes.set(tenantId, nova);
    return nova;
  }

  async temAvec(tenantId: string): Promise<boolean> {
    return (await this.conexao(tenantId)) !== null;
  }

  private async profissionaisAvec(c: Conexao): Promise<ProfissionalAvec[]> {
    if (c.profissionais && Date.now() - c.profissionais.em < CACHE_PROFISSIONAIS_MS) return c.profissionais.lista;
    const lista = await c.cliente.profissionais();
    c.profissionais = { em: Date.now(), lista };
    return lista;
  }

  /**
   * Profissional do Avec → id do KHUB; quem não existe no catálogo é criado
   * (mesmo desenho do importador: um nome por tenant). Sem isso a ocupação
   * dela ficaria invisível para a IA.
   */
  private async mapaProfissionais(tenantId: string, avec: ProfissionalAvec[]): Promise<Map<string, string | null>> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const khub = await tx.profissional.findMany({ select: { id: true, nome: true } });
      const mapa = mapearProfissionais(avec, khub);
      for (const p of avec) {
        if (mapa.get(p.id)) continue;
        const nome = (p.apelido || p.nome).replace(/\s+/g, ' ').trim().slice(0, 120);
        if (!nome) continue;
        const r = await tx.$queryRaw<{ id: string }[]>`INSERT INTO profissionais (tenant_id, nome) VALUES (${tenantId}::uuid, ${nome})
          ON CONFLICT (tenant_id, (lower(btrim(nome)))) DO UPDATE SET updated_at = profissionais.updated_at RETURNING id`;
        mapa.set(p.id, r[0].id);
      }
      return mapa;
    });
  }

  /**
   * Ao vivo, antes de oferecer ou reservar: relê o dia no Avec e grava.
   * 'sem_avec' = salão não usa Avec (segue só com a agenda do KHUB).
   * Lança ErroAvec se o Avec não respondeu (quem chama decide: oferecer com
   * aviso, nunca reservar às cegas).
   */
  async sincronizarDia(tenantId: string, data: string, opcoes: { forcar?: boolean } = {}): Promise<'ok' | 'sem_avec'> {
    const c = await this.conexao(tenantId);
    if (!c) return 'sem_avec';
    const k = `${tenantId}:${data}`;
    if (!opcoes.forcar && Date.now() - (this.frescor.get(k) ?? 0) < FRESCOR_DIA_MS) return 'ok';
    await this.sincronizar(tenantId, c, [data]);
    return 'ok';
  }

  /** Janela inteira (agendador): hoje + DIAS_JANELA no fuso do salão. */
  async sincronizarJanela(tenantId: string, dias = DIAS_JANELA): Promise<ResumoSync | null> {
    const c = await this.conexao(tenantId);
    if (!c) return null;
    const hoje = partesLocais(Date.now(), fusoPadrao()).data;
    return this.sincronizar(tenantId, c, Array.from({ length: dias + 1 }, (_, i) => somarDias(hoje, i)));
  }

  /** Todos os salões com Avec conectado (lista via SECURITY DEFINER da db/073). */
  async sincronizarTodos(): Promise<{ saloes: number; falhas: number }> {
    const lista = await this.prisma.$queryRaw<{ tenant_id: string }[]>`SELECT tenant_id FROM ads_integracoes_para_sync(${[PROVIDER_AVEC]}::text[])`;
    let falhas = 0;
    for (const { tenant_id } of lista) {
      try {
        const r = await this.sincronizarJanela(tenant_id);
        if (r?.falhas.length) falhas++;
      } catch (e) {
        falhas++;
        this.log.warn(`sync do Avec falhou (tenant ${tenant_id.slice(0, 8)}): ${(e as Error).message.slice(0, 200)}`);
      }
    }
    return { saloes: lista.length, falhas };
  }

  private async sincronizar(tenantId: string, c: Conexao, datas: string[]): Promise<ResumoSync> {
    const fuso = fusoPadrao();
    const resumo: ResumoSync = { dias: 0, criados: 0, atualizados: 0, adotados: 0, cancelados: 0, conflitosIa: 0, semProfissional: 0, falhas: [] };
    try {
      const avec = await this.profissionaisAvec(c);
      const mapa = await this.mapaProfissionais(tenantId, avec);
      const servicos = await this.prisma.withTenant(tenantId, (tx) => tx.servico.findMany({ select: { id: true, nome: true } }));
      const servicoPorNome = new Map(servicos.map((s) => [normalizarNome(s.nome), s.id]));
      const ids = avec.map((p) => p.id);
      for (const data of datas) {
        try {
          const dia = await c.cliente.agendaDoDia(data, ids);
          await this.aplicarDia(tenantId, data, dia, { mapa, servicoPorNome, fuso, corteLegado: c.corteLegado }, resumo);
          this.frescor.set(`${tenantId}:${data}`, Date.now());
          resumo.dias++;
        } catch (e) {
          if (e instanceof ErroAvec && e.tipo !== 'formato') throw e; // Avec fora/sem sessão: para a rodada
          resumo.falhas.push(`${data}: ${(e as Error).message.slice(0, 160)}`);
        }
      }
      await this.marcarSaude(tenantId, c.integrationId, resumo.falhas.length ? 'degraded' : 'ok', resumo.falhas[0] ?? null);
    } catch (e) {
      const msg = e instanceof ErroAvec ? e.message : `falha no sync: ${(e as Error).message.slice(0, 200)}`;
      await this.marcarSaude(tenantId, c.integrationId, 'down', msg);
      if (e instanceof ErroAvec && e.tipo === 'credencial') this.conexoes.delete(tenantId);
      throw e instanceof ErroAvec ? e : new ErroAvec(msg, 'rede');
    }
    if (resumo.criados + resumo.cancelados + resumo.adotados + resumo.atualizados > 0 || resumo.conflitosIa) {
      this.log.log(`avec ${tenantId.slice(0, 8)}: ${JSON.stringify({ ...resumo, falhas: resumo.falhas.length })}`);
    }
    return resumo;
  }

  private async marcarSaude(tenantId: string, id: string, health: string, erro: string | null) {
    await this.prisma
      .withTenant(tenantId, (tx) => tx.integration.update({ where: { id }, data: { health, erro, ...(health === 'down' ? {} : { lastSyncAt: new Date() }) } }))
      .catch(() => undefined);
  }

  private async aplicarDia(
    tenantId: string,
    data: string,
    dia: Awaited<ReturnType<AvecCliente['agendaDoDia']>>,
    ctx: { mapa: Map<string, string | null>; servicoPorNome: Map<string, string>; fuso: string; corteLegado: number },
    resumo: ResumoSync,
  ) {
    const ini = instanteNoFuso(data, 0, ctx.fuso);
    const fim = instanteNoFuso(somarDias(data, 1), 0, ctx.fuso);
    const itens = itensDoDia(data, dia);
    await this.prisma.withTenant(
      tenantId,
      async (tx) => {
        // Mesma trava da reserva da IA e da agenda manual: não cruzam com o sync.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`agenda:${tenantId}`}, 0))`;
        const linhas = await tx.agendaCompromisso.findMany({
          where: { inicio: { gte: new Date(ini), lt: new Date(fim) }, OR: [{ origem: 'avec' }, { origem: null, profissionalId: { not: null } }] },
          select: {
            id: true, origem: true, externoId: true, profissionalId: true, inicio: true, fim: true, status: true, titulo: true, servicoId: true, notas: true, createdAt: true, contactId: true,
          },
        });
        const idsContato = [...new Set(linhas.map((l) => l.contactId).filter((x): x is string => !!x))];
        const contatos = new Map(
          (idsContato.length ? await tx.contact.findMany({ where: { id: { in: idsContato } }, select: { id: true, telefone: true, nome: true } }) : []).map((x) => [x.id, x]),
        );
        const existentes: LinhaKhub[] = linhas.map((l) => ({
          id: l.id, origem: l.origem, externoId: l.externoId, profissionalId: l.profissionalId, inicio: +l.inicio, fim: +l.fim, status: l.status,
          titulo: l.titulo, servicoId: l.servicoId, notas: l.notas, createdAt: +l.createdAt,
          contatoTelefone: (l.contactId && contatos.get(l.contactId)?.telefone) || null, contatoNome: (l.contactId && contatos.get(l.contactId)?.nome) || null,
        }));
        const plano = planejarDia({ itens, existentes, profissional: ctx.mapa, servicoPorNome: ctx.servicoPorNome, instante: (m) => instanteNoFuso(data, m, ctx.fuso), corteLegado: ctx.corteLegado });
        await this.gravarPlano(tx, tenantId, plano);
        // Expediente real do dia (folga = NULL).
        const dataDb = new Date(`${data}T00:00:00Z`);
        for (const d of dia) {
          const profissionalId = ctx.mapa.get(String(d.idProf));
          if (!profissionalId) continue;
          const j = jornadaDoDia(d);
          await tx.agendaJornada.upsert({
            where: { tenantId_profissionalId_data: { tenantId, profissionalId, data: dataDb } },
            create: { tenantId, profissionalId, data: dataDb, iniMin: j?.iniMin ?? null, fimMin: j?.fimMin ?? null },
            update: { iniMin: j?.iniMin ?? null, fimMin: j?.fimMin ?? null, atualizadoEm: new Date() },
          });
        }
        // Sync não dispara automação (lembrete, confirmação, pós-atendimento): o Avec já cuida.
        await tx.$executeRaw`UPDATE outbox_events SET status = 'processed', processed_at = now(), last_error = 'avec_sync: não dispara automação'
          WHERE tenant_id = ${tenantId}::uuid AND status = 'pending' AND created_at = now() AND kind LIKE 'appointment.%'`;
        resumo.criados += plano.inserir.length;
        resumo.adotados += plano.atualizar.filter((a) => a.dados.origem).length;
        resumo.atualizados += plano.atualizar.filter((a) => !a.dados.origem).length;
        resumo.cancelados += plano.cancelar.length;
        resumo.conflitosIa += plano.conflitos.length;
        resumo.semProfissional += plano.semProfissional;
      },
      { timeout: 60_000, maxWait: 15_000 },
    );
  }

  private async gravarPlano(tx: Prisma.TransactionClient, tenantId: string, plano: PlanoDia) {
    const agora = new Date();
    for (const it of plano.inserir) {
      const contactId = it.clienteTel ? await acharContatoPorTelefone(tx, it.clienteTel) : null;
      const notas = it.bloqueio
        ? 'Bloqueio no Avec.'
        : contactId
          ? null
          : it.clienteNome
            ? `Cliente no Avec: ${it.clienteNome}${it.clienteTel ? ` (${it.clienteTel})` : ''}`.slice(0, 500)
            : null;
      await tx.agendaCompromisso.create({
        data: {
          tenantId, titulo: it.titulo, inicio: new Date(it.inicio), fim: new Date(it.fim), status: it.status, tipo: 'outro',
          contactId, profissionalId: it.profissionalId, servicoId: it.servicoId, notas, origem: 'avec', externoId: it.externoId, sincronizadoEm: agora,
        },
      });
    }
    for (const a of plano.atualizar) {
      const d = a.dados;
      await tx.agendaCompromisso.update({
        where: { id: a.id },
        data: {
          ...(d.inicio !== undefined ? { inicio: new Date(d.inicio), lembreteEnviadoEm: null } : {}),
          ...(d.fim !== undefined ? { fim: new Date(d.fim) } : {}),
          ...(d.status ? { status: d.status } : {}),
          ...(d.servicoId !== undefined ? { servicoId: d.servicoId } : {}),
          ...(d.titulo ? { titulo: d.titulo } : {}),
          ...(d.profissionalId ? { profissionalId: d.profissionalId } : {}),
          ...(d.origem ? { origem: d.origem, externoId: d.externoId } : {}),
          sincronizadoEm: agora,
        },
      });
    }
    for (const c of plano.cancelar) {
      await tx.agendaCompromisso.update({ where: { id: c.id }, data: { status: 'cancelado', sincronizadoEm: agora } });
    }
  }
}
