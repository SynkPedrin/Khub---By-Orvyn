import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Consultas de leitura da NICO sobre a operação (ADR-0046): o que o funil, as
 * conversas e a agenda dizem DE VERDADE, para ela parar de responder "só tenho a
 * contagem por etapa". Tudo roda dentro de `withTenant` (RLS) e devolve só o que
 * a análise precisa: nome do contato sim; telefone, e-mail e texto de mensagem não.
 */

const FUSO = 'America/Sao_Paulo';
const arred = (n: number | null | undefined, casas = 1) => (n == null ? null : Math.round(n * 10 ** casas) / 10 ** casas);
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export interface LinhaSemResposta {
  nome: string;
  canal: string;
  etapa: string | null;
  horasSemResposta: number;
  valor: number | null;
}

@Injectable()
export class NicoConsultasService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Conversas em que a ÚLTIMA mensagem é do contato e está sem resposta há mais
   * de `horas`. Responde "quantos leads estão sem resposta há mais de 24h" com o
   * número exato e quem são, por etapa do funil.
   */
  async leadsSemResposta(tenantId: string, horas: number, etapa?: string) {
    const h = Math.max(1, Math.min(720, Math.trunc(horas || 24)));
    const linhas = await this.prisma.withTenant(tenantId, (tx) =>
      tx.$queryRaw<{ nome: string; canal: string; horas: number; etapa: string | null; valor: number | null }[]>`
        WITH ult AS (
          SELECT DISTINCT ON (m.conversation_id) m.conversation_id, m.autor_tipo, m.created_at
          FROM messages m WHERE m.created_at > now() - interval '90 days'
          ORDER BY m.conversation_id, m.created_at DESC
        )
        SELECT c.nome, c.canal, (EXTRACT(EPOCH FROM (now() - u.created_at)) / 3600)::float8 AS horas,
               s.nome AS etapa, d.valor::float8 AS valor
        FROM ult u
        JOIN conversations c ON c.id = u.conversation_id
        LEFT JOIN LATERAL (
          SELECT d2.stage_id, d2.valor FROM deals d2
          WHERE d2.contact_id = c.contact_id AND d2.status = 'aberto' ORDER BY d2.updated_at DESC LIMIT 1
        ) d ON true
        LEFT JOIN stages s ON s.id = d.stage_id
        WHERE u.autor_tipo = 'contato' AND c.status = 'aberta' AND u.created_at < now() - make_interval(hours => ${h}::int)
        ORDER BY u.created_at ASC LIMIT 500`,
    );
    const alvo = etapa ? norm(etapa) : null;
    const filtradas = linhas.filter((l) => !alvo || norm(l.etapa ?? 'sem negocio aberto').includes(alvo));
    const porEtapa = new Map<string, number>();
    for (const l of filtradas) porEtapa.set(l.etapa ?? 'Sem negócio aberto', (porEtapa.get(l.etapa ?? 'Sem negócio aberto') ?? 0) + 1);
    const maisAntigos: LinhaSemResposta[] = filtradas.slice(0, 25).map((l) => ({ nome: l.nome, canal: l.canal, etapa: l.etapa, horasSemResposta: Math.round(l.horas), valor: l.valor }));
    return {
      criterio: `última mensagem é do contato e está sem resposta há mais de ${h}h (conversas abertas, últimos 90 dias)`,
      total: filtradas.length,
      porEtapa: [...porEtapa].map(([e, qtd]) => ({ etapa: e, qtd })).sort((a, b) => b.qtd - a.qtd),
      maisAntigos,
      limite: linhas.length >= 500 ? 'lista cortada em 500 conversas' : undefined,
    };
  }

  /** Negócios por etapa/status, com quanto tempo estão parados (sem atualização). */
  async negocios(tenantId: string, f: { etapa?: string; status: 'aberto' | 'ganho' | 'perdido'; paradosHaDias?: number; limite: number }) {
    const etapa = f.etapa?.trim() || null;
    const dias = f.paradosHaDias && f.paradosHaDias > 0 ? Math.min(Math.trunc(f.paradosHaDias), 3650) : null;
    const lim = Math.max(1, Math.min(100, Math.trunc(f.limite || 30)));
    return this.prisma.withTenant(tenantId, async (tx) => {
      const [lista, total] = await Promise.all([
        tx.$queryRaw<{ titulo: string; contato: string | null; etapa: string; valor: number; origem: string | null; dias: number }[]>`
          SELECT d.titulo, c.nome AS contato, s.nome AS etapa, d.valor::float8 AS valor, d.origem,
                 (EXTRACT(EPOCH FROM (now() - d.updated_at)) / 86400)::float8 AS dias
          FROM deals d LEFT JOIN contacts c ON c.id = d.contact_id JOIN stages s ON s.id = d.stage_id
          WHERE d.status = ${f.status}
            AND (${etapa}::text IS NULL OR s.nome ILIKE '%' || ${etapa}::text || '%')
            AND (${dias}::int IS NULL OR d.updated_at < now() - make_interval(days => ${dias}::int))
          ORDER BY d.valor DESC, d.updated_at ASC LIMIT ${lim}::int`,
        tx.$queryRaw<{ n: number; total: number }[]>`
          SELECT count(*)::int AS n, coalesce(sum(d.valor), 0)::float8 AS total
          FROM deals d JOIN stages s ON s.id = d.stage_id
          WHERE d.status = ${f.status}
            AND (${etapa}::text IS NULL OR s.nome ILIKE '%' || ${etapa}::text || '%')
            AND (${dias}::int IS NULL OR d.updated_at < now() - make_interval(days => ${dias}::int))`,
      ]);
      return {
        filtro: { etapa, status: f.status, paradosHaDias: dias },
        total: total[0]?.n ?? 0,
        valorTotal: arred(total[0]?.total, 2),
        negocios: lista.map((n) => ({ titulo: n.titulo, contato: n.contato, etapa: n.etapa, valor: arred(n.valor, 2), origem: n.origem, diasParado: Math.floor(n.dias) })),
        mostrando: lista.length,
      };
    });
  }

  /** Agenda de um período: contagem por status, faturamento, faltas e os próximos compromissos. */
  async agendaPeriodo(tenantId: string, de: string, ate: string) {
    const ok = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (!ok(de) || !ok(ate) || de > ate) throw new Error('período inválido: use datas AAAA-MM-DD e início <= fim');
    return this.prisma.withTenant(tenantId, async (tx) => {
      const [porStatus, proximos] = await Promise.all([
        tx.$queryRaw<{ status: string; n: number; centavos: number }[]>`
          SELECT a.status, count(*)::int AS n, coalesce(sum(a.valor_centavos), 0)::int AS centavos
          FROM agenda_compromissos a
          WHERE a.inicio >= (${de}::date)::timestamp AT TIME ZONE ${FUSO}
            AND a.inicio < ((${ate}::date + 1))::timestamp AT TIME ZONE ${FUSO}
          GROUP BY a.status`,
        tx.$queryRaw<{ titulo: string; inicio: Date; status: string; contato: string | null }[]>`
          SELECT a.titulo, a.inicio, a.status, c.nome AS contato
          FROM agenda_compromissos a LEFT JOIN contacts c ON c.id = a.contact_id
          WHERE a.inicio >= (${de}::date)::timestamp AT TIME ZONE ${FUSO}
            AND a.inicio < ((${ate}::date + 1))::timestamp AT TIME ZONE ${FUSO}
          ORDER BY a.inicio ASC LIMIT 40`,
      ]);
      const n = (s: string) => porStatus.find((x) => x.status === s)?.n ?? 0;
      const total = porStatus.reduce((acc, x) => acc + x.n, 0);
      const realizados = n('concluido') + n('faltou') + n('nao_compareceu');
      const faltas = n('faltou') + n('nao_compareceu');
      return {
        periodo: { de, ate },
        total,
        porStatus: porStatus.map((x) => ({ status: x.status, qtd: x.n, valorCentavos: x.centavos })),
        faltasPercentual: realizados ? arred((faltas / realizados) * 100) : null,
        valorTotalCentavos: porStatus.reduce((acc, x) => acc + x.centavos, 0),
        compromissos: proximos.map((p) => ({ titulo: p.titulo, inicio: p.inicio.toISOString(), status: p.status, contato: p.contato })),
        aviso: 'valores em centavos; compromissos sem valor informado não entram na soma',
      };
    });
  }

  /** Volume e velocidade do atendimento: quanto entra, quanto fica sem resposta e em quanto tempo respondem. */
  async metricasAtendimento(tenantId: string, dias: number) {
    const d = Math.max(1, Math.min(180, Math.trunc(dias || 30)));
    return this.prisma.withTenant(tenantId, async (tx) => {
      const [resumo, canais] = await Promise.all([
        tx.$queryRaw<{ com_entrada: number; sem_resposta: number; mediana_min: number | null }[]>`
          WITH base AS (SELECT m.conversation_id, m.autor_tipo, m.created_at FROM messages m WHERE m.created_at > now() - make_interval(days => ${d}::int)),
          primeira AS (
            SELECT conversation_id,
                   min(created_at) FILTER (WHERE autor_tipo = 'contato') AS recebida,
                   min(created_at) FILTER (WHERE autor_tipo <> 'contato') AS respondida
            FROM base GROUP BY conversation_id)
          SELECT count(*) FILTER (WHERE recebida IS NOT NULL)::int AS com_entrada,
                 count(*) FILTER (WHERE recebida IS NOT NULL AND respondida IS NULL)::int AS sem_resposta,
                 (percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (respondida - recebida)) / 60)
                   FILTER (WHERE respondida > recebida))::float8 AS mediana_min
          FROM primeira`,
        tx.$queryRaw<{ canal: string; autor_tipo: string; n: number }[]>`
          SELECT coalesce(c.canal, 'desconhecido') AS canal, m.autor_tipo, count(*)::int AS n
          FROM messages m JOIN conversations c ON c.id = m.conversation_id
          WHERE m.created_at > now() - make_interval(days => ${d}::int) GROUP BY 1, 2`,
      ]);
      const porCanal = new Map<string, { recebidas: number; enviadas: number }>();
      for (const c of canais) {
        const x = porCanal.get(c.canal) ?? { recebidas: 0, enviadas: 0 };
        if (c.autor_tipo === 'contato') x.recebidas += c.n;
        else x.enviadas += c.n;
        porCanal.set(c.canal, x);
      }
      const r = resumo[0];
      return {
        periodoDias: d,
        conversasComMensagemRecebida: r?.com_entrada ?? 0,
        semNenhumaResposta: r?.sem_resposta ?? 0,
        medianaAtePrimeiraRespostaMinutos: arred(r?.mediana_min),
        porCanal: [...porCanal].map(([canal, v]) => ({ canal, ...v })),
        leitura: 'a primeira resposta conta qualquer mensagem enviada (humano, IA ou automação) depois da primeira mensagem do contato',
      };
    });
  }
}
