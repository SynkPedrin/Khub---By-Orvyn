import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { instanteDe, horaLocal } from '../agents/config/horario';

/**
 * Análises da NICO (ADR-0044): campanhas, benchmark da Biblioteca de Anúncios,
 * prompt dos agentes, saúde das automações, relatórios e rotinas.
 *
 * Tudo aqui LÊ o banco do tenant (RLS) e devolve DADOS + diagnósticos por
 * regra. Quem escreve o texto final é o modelo, com esses dados na mão: a NICO
 * nunca inventa número (invariante "dado vem de tool").
 */

// ------------------------------------------------------------------ campanhas

export interface LinhaCampanha {
  campanha: string;
  status: string | null;
  objetivo: string | null;
  investimento: number;
  impressoes: number;
  cliques: number;
  leads: number;
  conversoes: number;
  receita: number;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  cpl: number | null;
  roas: number | null;
  frequencia: number | null;
  variacaoInvestimento: number | null;
  variacaoCpl: number | null;
  alertas: string[];
}

const div = (a: number, b: number) => (b > 0 ? a / b : null);
const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);
const variacao = (atual: number | null, anterior: number | null) => (atual !== null && anterior !== null && anterior > 0 ? r2(((atual - anterior) / anterior) * 100) : null);

/** Regras de diagnóstico (referências de mercado; ajustáveis por nicho). Pura, testável. */
export function alertasCampanha(c: Omit<LinhaCampanha, 'alertas'>, cplMediano: number | null): string[] {
  const a: string[] = [];
  if (c.investimento >= 30 && c.leads === 0 && c.conversoes === 0) a.push('🚨 investiu e não gerou nenhum lead: revisar oferta, público e formulário');
  if (c.ctr !== null && c.impressoes >= 1000 && c.ctr < 0.8) a.push('📉 CTR abaixo de 0,8%: criativo/gancho não está prendendo atenção');
  if (c.frequencia !== null && c.frequencia > 3.5) a.push('🔁 frequência acima de 3,5: público saturado, renovar criativo ou ampliar público');
  if (c.cpl !== null && cplMediano !== null && cplMediano > 0 && c.cpl > cplMediano * 1.5) a.push(`💸 CPL ${Math.round((c.cpl / cplMediano - 1) * 100)}% acima da mediana da conta`);
  if (c.variacaoCpl !== null && c.variacaoCpl > 30) a.push(`⚠️ CPL subiu ${c.variacaoCpl}% contra o período anterior`);
  if (c.roas !== null && c.receita > 0 && c.roas < 1) a.push('🔻 ROAS abaixo de 1: está pagando mais do que volta em receita registrada');
  if (c.cpl !== null && cplMediano !== null && c.cpl < cplMediano * 0.7 && c.leads >= 5) a.push('🚀 CPL bem abaixo da mediana: candidata a escalar (+20% de verba a cada 3 dias)');
  return a;
}

// ------------------------------------------------------------------ prompts

export interface AvaliacaoPrompt {
  agente: string;
  status: string;
  nota: number;
  criterios: { criterio: string; ok: boolean; peso: number; dica: string }[];
}

/** Rubrica 0–100 de prompt de agente de atendimento (heurística; o modelo aprofunda). Pura. */
export function avaliarPrompt(instrucoes: string, extra: { ferramentas: string[]; conhecimentoAtivo: boolean; nicho: string | null }): Omit<AvaliacaoPrompt, 'agente' | 'status'> {
  const t = instrucoes.toLowerCase();
  const tem = (...p: (string | RegExp)[]) => p.some((x) => (typeof x === 'string' ? t.includes(x) : x.test(t)));
  const saude = /medic|estet|odonto|clinic|saud/.test(extra.nicho ?? '') || tem('procedimento', 'paciente');
  const criterios = [
    { criterio: 'Papel e identidade claros', ok: tem('você é', 'voce é', 'seu nome', 'você atua'), peso: 12, dica: 'Comece dizendo quem o agente é, para quem trabalha e qual o objetivo da conversa.' },
    { criterio: 'Objetivo de conversão definido', ok: tem('agend', 'objetivo', 'meta', 'convert', 'fechar', 'qualific'), peso: 14, dica: 'Diga qual é o resultado esperado (ex.: agendar avaliação, qualificar e passar para o vendedor).' },
    { criterio: 'Tom de voz descrito', ok: tem('tom', 'linguagem', 'informal', 'formal', 'emoji', 'humaniz', 'acolhed'), peso: 8, dica: 'Descreva o tom (acolhedor, direto, usa ou não emojis) e dê 1 exemplo de frase.' },
    { criterio: 'Regras de transferência para humano', ok: tem('humano', 'atendente', 'equipe', 'transfer', 'encaminh'), peso: 12, dica: 'Liste quando passar para a equipe: reclamação, pedido explícito, assunto fora da base, negociação de preço.' },
    { criterio: 'Limites (o que NÃO fazer)', ok: tem('não ', 'nunca', 'proibido', 'evite'), peso: 10, dica: 'Liste proibições: não inventar preço, não prometer resultado, não falar de concorrente.' },
    { criterio: 'Preços/serviços ancorados na base', ok: extra.conhecimentoAtivo || tem('preço', 'valor', 'tabela'), peso: 10, dica: 'Preços e serviços devem vir da base de conhecimento, não do texto solto do prompt (fica desatualizado).' },
    { criterio: 'Coleta de dados do lead', ok: tem('nome', 'telefone', 'e-mail', 'email', 'horário', 'disponib'), peso: 8, dica: 'Diga quais dados coletar e em que ordem (no máximo 1 pergunta por mensagem).' },
    { criterio: 'Mensagens curtas e humanas', ok: tem('curt', 'breve', 'uma pergunta', '1 pergunta', 'frases'), peso: 8, dica: 'Peça mensagens curtas, uma ideia por mensagem, como uma pessoa no WhatsApp.' },
    { criterio: 'Tratamento de objeções', ok: tem('objeç', 'caro', 'pensar', 'depois', 'dúvida'), peso: 8, dica: 'Inclua como responder "tá caro", "vou pensar" e "depois eu vejo".' },
    { criterio: saude ? 'Compliance de saúde (CFM/CFO/Anvisa)' : 'Compliance e LGPD', ok: saude ? tem('diagnóst', 'resultado garantido', 'cfm', 'promet') : tem('lgpd', 'dados', 'privacidade', 'promet'), peso: 10, dica: saude ? 'Proíba diagnóstico, promessa de resultado e antes/depois sem autorização (CFM/CFO).' : 'Inclua cuidado com dados pessoais (LGPD) e proibição de promessas.' },
  ];
  const total = criterios.reduce((s, c) => s + c.peso, 0);
  let nota = Math.round((criterios.filter((c) => c.ok).reduce((s, c) => s + c.peso, 0) / total) * 100);
  if (instrucoes.trim().length < 300) nota = Math.min(nota, 45);
  if (instrucoes.length > 7000) nota = Math.max(0, nota - 5); // prompt gigante confunde modelo pequeno
  return { nota, criterios };
}

// ------------------------------------------------------------------ rotinas

export type Frequencia = 'diaria' | 'semanal' | 'mensal';

/** Próxima execução de uma rotina (no fuso do tenant). Pura, testável. */
export function proximaExecucao(f: { frequencia: Frequencia; hora: string; diaSemana?: number | null; diaMes?: number | null; fuso: string }, depoisDe: Date): Date {
  const [h, m] = f.hora.split(':').map(Number);
  const minuto = h * 60 + m;
  const base = horaLocal(depoisDe, f.fuso);
  for (let d = 0; d <= 62; d++) {
    const dia = horaLocal(new Date(instanteDe(base.ano, base.mes, base.dia, 12 * 60, f.fuso).getTime() + d * 86400000), f.fuso);
    if (f.frequencia === 'semanal' && dia.diaSemana !== (f.diaSemana ?? 1)) continue;
    if (f.frequencia === 'mensal' && dia.dia !== (f.diaMes ?? 1)) continue;
    const quando = instanteDe(dia.ano, dia.mes, dia.dia, minuto, f.fuso);
    if (quando.getTime() > depoisDe.getTime()) return quando;
  }
  throw new Error('não foi possível calcular a próxima execução');
}

@Injectable()
export class NicoAnalisesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Desempenho das campanhas no período + comparação com o período anterior + alertas. */
  async analisarCampanhas(tenantId: string, dias: number) {
    const d = Math.max(3, Math.min(90, Math.trunc(dias || 7)));
    const linhas = await this.prisma.withTenant(tenantId, (tx) => tx.$queryRaw<{
      campanha: string; status: string | null; objetivo: string | null; periodo: 'atual' | 'anterior';
      spend: number; impressions: number; clicks: number; leads: number; conversions: number; revenue: number; reach: number; freq: number | null;
    }[]>`
      SELECT coalesce(c.name, i.external_ref_id) AS campanha, c.status, c.objective AS objetivo,
             CASE WHEN i.date > current_date - ${d}::int THEN 'atual' ELSE 'anterior' END AS periodo,
             coalesce(sum(i.spend),0)::float8 AS spend, coalesce(sum(i.impressions),0)::float8 AS impressions,
             coalesce(sum(i.clicks),0)::float8 AS clicks, coalesce(sum(i.leads),0)::float8 AS leads,
             coalesce(sum(i.conversions),0)::float8 AS conversions, coalesce(sum(i.revenue),0)::float8 AS revenue,
             coalesce(sum(i.reach),0)::float8 AS reach, avg(i.frequency)::float8 AS freq
      FROM ad_insights i
      LEFT JOIN ad_campaigns c ON c.external_id = i.external_ref_id
      WHERE i.level = 'campaign' AND i.date > current_date - ${d * 2}::int
      GROUP BY 1, 2, 3, 4`);
    if (!linhas.length) {
      const conectada = await this.prisma.withTenant(tenantId, (tx) => tx.integration.findFirst({ where: { provider: 'meta', status: 'connected' }, select: { lastSyncAt: true } }));
      return { vazio: true, aviso: conectada ? `A conta Meta está conectada, mas não há dados de campanha nos últimos ${d * 2} dias (último sync: ${conectada.lastSyncAt?.toISOString() ?? 'nunca'}).` : 'Nenhuma conta de anúncios conectada. Conecte a Meta em Marketing › Anúncios para eu analisar campanhas.' };
    }
    const porNome = new Map<string, { atual?: (typeof linhas)[number]; anterior?: (typeof linhas)[number] }>();
    for (const l of linhas) porNome.set(l.campanha, { ...porNome.get(l.campanha), [l.periodo]: l });
    const montar = (x: (typeof linhas)[number] | undefined) => {
      if (!x) return null;
      return { spend: x.spend, cpl: div(x.spend, x.leads), ctr: x.impressions ? (x.clicks / x.impressions) * 100 : null };
    };
    const base = [...porNome.entries()].filter(([, v]) => v.atual).map(([nome, v]) => {
      const a = v.atual!;
      const ant = montar(v.anterior);
      const cpl = div(a.spend, a.leads);
      return {
        campanha: nome, status: a.status, objetivo: a.objetivo,
        investimento: r2(a.spend)!, impressoes: a.impressions, cliques: a.clicks, leads: a.leads, conversoes: a.conversions, receita: r2(a.revenue)!,
        ctr: r2(a.impressions ? (a.clicks / a.impressions) * 100 : null), cpc: r2(div(a.spend, a.clicks)), cpm: r2(a.impressions ? (a.spend / a.impressions) * 1000 : null),
        cpl: r2(cpl), roas: r2(div(a.revenue, a.spend)), frequencia: r2(a.freq),
        variacaoInvestimento: variacao(a.spend, ant?.spend ?? null), variacaoCpl: variacao(cpl, ant?.cpl ?? null),
      };
    });
    const cpls = base.map((c) => c.cpl).filter((x): x is number => x !== null).sort((x, y) => x - y);
    const mediana = cpls.length ? cpls[Math.floor(cpls.length / 2)] : null;
    const campanhas: LinhaCampanha[] = base.map((c) => ({ ...c, alertas: alertasCampanha(c, mediana) })).sort((x, y) => y.investimento - x.investimento);
    const soma = (k: 'investimento' | 'leads' | 'cliques' | 'impressoes' | 'receita') => campanhas.reduce((s, c) => s + c[k], 0);
    return {
      periodo: `últimos ${d} dias (comparado aos ${d} anteriores)`,
      totais: { investimento: r2(soma('investimento')), leads: soma('leads'), cpl: r2(div(soma('investimento'), soma('leads'))), ctr: r2(soma('impressoes') ? (soma('cliques') / soma('impressoes')) * 100 : null), receita: r2(soma('receita')), roas: r2(div(soma('receita'), soma('investimento'))), cplMedianoDaConta: r2(mediana) },
      campanhas,
      leitura: 'Alertas são regras de referência de mercado; confirme com o histórico da conta antes de cortar verba.',
    };
  }

  /**
   * Benchmark na Biblioteca de Anúncios da Meta. A API oficial (`ads_archive`)
   * só devolve anúncios comerciais de países da UE/Reino Unido; no Brasil ela
   * cobre apenas anúncios políticos/temas sociais. Por isso a NICO monta as
   * buscas prontas na Biblioteca (link direto, país BR, só ativos) e o método
   * de análise, em vez de fingir que "puxou" anúncios que a Meta não expõe.
   */
  benchmarkBiblioteca(termos: string[], pais = 'BR') {
    const lista = [...new Set(termos.map((t) => t.trim()).filter(Boolean))].slice(0, 8);
    if (!lista.length) throw new BadRequestException('informe ao menos um concorrente ou termo de busca');
    const p = /^[A-Z]{2}$/.test(pais) ? pais : 'BR';
    return {
      buscas: lista.map((t) => ({
        termo: t,
        link: `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${p}&q=${encodeURIComponent(t)}&search_type=keyword_unordered&media_type=all`,
      })),
      limitacao: 'A API da Meta não entrega anúncios comerciais do Brasil; abra os links (já filtrados por anúncios ativos no país) para ver os criativos.',
      metodo: [
        'Anúncio ativo há 30+ dias costuma ser vencedor: o concorrente não paga por algo que não converte.',
        'Muitas variações do mesmo anúncio = teste de criativo em andamento; repare no gancho que se repete.',
        'Anote: gancho dos 3 primeiros segundos, oferta, prova social, CTA e para onde o anúncio leva (WhatsApp, formulário, site).',
        'Compare formato: vídeo curto vertical, carrossel ou imagem estática; o que domina no seu nicho.',
        'Transforme em 3 hipóteses de teste para a sua conta (não copie: adapte a sua oferta e a sua prova).',
      ],
    };
  }

  /** Avalia o prompt de um agente (ou de todos os ativos). */
  async analisarPromptAgentes(tenantId: string, agentId?: string) {
    const [agentes, tenant] = await this.prisma.withTenant(tenantId, (tx) => Promise.all([
      tx.agent.findMany({ where: { status: { not: 'arquivado' }, ...(agentId ? { id: agentId } : {}) }, select: { nome: true, status: true, instrucoes: true, ferramentas: true, conhecimentoAtivo: true }, take: 10 }),
      tx.tenant.findUnique({ where: { id: tenantId }, select: { nicho: true } }),
    ]));
    if (!agentes.length) throw new NotFoundException(agentId ? 'agente não encontrado' : 'esta conta ainda não tem agentes de IA');
    const avaliacoes: AvaliacaoPrompt[] = agentes.map((a) => ({ agente: a.nome, status: a.status, ...avaliarPrompt(a.instrucoes, { ferramentas: a.ferramentas, conhecimentoAtivo: a.conhecimentoAtivo, nicho: tenant?.nicho ?? null }) }));
    return { avaliacoes, instrucoesDoPrimeiro: agentes[0].instrucoes.slice(0, 6000), observacao: 'Nota heurística pela rubrica; leia o prompt e aprofunde com exemplos de reescrita.' };
  }

  /** Saúde das automações: falhas agrupadas, travadas, ativas sem execução, DLQ. */
  async diagnosticarAutomacoes(tenantId: string, workflowId?: string) {
    const filtro = workflowId ?? null;
    const [porFluxo, erros, travadas] = await this.prisma.withTenant(tenantId, (tx) => Promise.all([
      tx.$queryRaw<{ id: string; nome: string; status: string; concluidas: number; falhas: number; esperando: number; ultima: Date | null }[]>`
        SELECT w.id, w.nome, w.status,
               count(r.id) FILTER (WHERE r.status = 'concluido')::int AS concluidas,
               count(r.id) FILTER (WHERE r.status = 'falhou')::int AS falhas,
               count(r.id) FILTER (WHERE r.status = 'esperando')::int AS esperando,
               max(r.started_at) AS ultima
        FROM workflows w LEFT JOIN workflow_runs r ON r.workflow_id = w.id AND r.started_at > now() - interval '30 days'
        WHERE (${filtro}::uuid IS NULL OR w.id = ${filtro}::uuid)
        GROUP BY w.id, w.nome, w.status ORDER BY falhas DESC, w.nome`,
      tx.$queryRaw<{ nome: string; erro: string; vezes: number; ultima: Date }[]>`
        SELECT w.nome, left(coalesce(r.erro, 'sem mensagem'), 200) AS erro, count(*)::int AS vezes, max(r.finished_at) AS ultima
        FROM workflow_runs r JOIN workflows w ON w.id = r.workflow_id
        WHERE r.status = 'falhou' AND r.started_at > now() - interval '30 days' AND (${filtro}::uuid IS NULL OR w.id = ${filtro}::uuid)
        GROUP BY 1, 2 ORDER BY vezes DESC LIMIT 15`,
      tx.$queryRaw<{ nome: string; no: string | null; desde: Date }[]>`
        SELECT w.nome, r.no_atual AS no, r.started_at AS desde
        FROM workflow_runs r JOIN workflows w ON w.id = r.workflow_id
        WHERE r.status IN ('rodando') AND r.started_at < now() - interval '2 hours' AND (${filtro}::uuid IS NULL OR w.id = ${filtro}::uuid)
        ORDER BY r.started_at LIMIT 15`,
    ]));
    const achados: string[] = [];
    for (const f of porFluxo) {
      const total = f.concluidas + f.falhas;
      if (f.status === 'ativo' && !f.ultima) achados.push(`😴 "${f.nome}" está ATIVA e não rodou nos últimos 30 dias: o gatilho pode estar com filtro que nunca bate (origem, tag, etapa) ou o evento não acontece.`);
      if (total >= 5 && f.falhas / total > 0.2) achados.push(`🚨 "${f.nome}" falha em ${Math.round((f.falhas / total) * 100)}% das execuções.`);
      if (f.esperando > 20) achados.push(`⏳ "${f.nome}" tem ${f.esperando} execuções paradas esperando (resposta/tempo): confira se o "Esperar resposta" tem caminho de tempo esgotado.`);
    }
    for (const t of travadas) achados.push(`🧊 execução de "${t.nome}" presa no nó ${t.no ?? '?'} desde ${t.desde.toISOString()}: worker parado ou erro sem retry.`);
    return { fluxos: porFluxo, errosMaisComuns: erros, travadas, achados: achados.length ? achados : ['✅ Nenhum problema relevante nas automações nos últimos 30 dias.'] };
  }

  async gerarRelatorio(tenantId: string, identityId: string | null, d: { titulo: string; tipo?: string; conteudoMd: string; origem?: 'chat' | 'agendamento'; agendamentoId?: string | null; conversationId?: string | null }) {
    const titulo = d.titulo.trim().slice(0, 160);
    if (!titulo || !d.conteudoMd.trim()) throw new BadRequestException('relatório precisa de título e conteúdo');
    const tipos = ['campanhas', 'benchmark', 'funil', 'automacoes', 'agentes', 'conteudo', 'financeiro', 'livre'];
    const r = await this.prisma.withTenant(tenantId, (tx) => tx.nicoRelatorio.create({
      data: { tenantId, titulo, tipo: tipos.includes(d.tipo ?? '') ? d.tipo! : 'livre', conteudoMd: d.conteudoMd.slice(0, 200000), origem: d.origem ?? 'chat', agendamentoId: d.agendamentoId ?? null, conversationId: d.conversationId ?? null, criadoPor: identityId },
      select: { id: true, titulo: true },
    }));
    return { ...r, link: `/nyro?relatorio=${r.id}`, aviso: 'Relatório salvo. Ele aparece no painel de relatórios da NICO, com download em .md e PDF.' };
  }

  async listarRelatorios(tenantId: string) {
    return this.prisma.withTenant(tenantId, (tx) => tx.nicoRelatorio.findMany({ orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, titulo: true, tipo: true, origem: true, createdAt: true } }));
  }

  async obterRelatorio(tenantId: string, id: string) {
    const r = await this.prisma.withTenant(tenantId, (tx) => tx.nicoRelatorio.findUnique({ where: { id } }));
    if (!r) throw new NotFoundException('relatório não encontrado');
    return r;
  }

  async agendar(tenantId: string, identityId: string, d: { titulo: string; instrucao: string; frequencia: Frequencia; hora?: string; diaSemana?: number | null; diaMes?: number | null }) {
    const hora = d.hora ?? '08:00';
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) throw new BadRequestException('hora inválida (HH:MM)');
    if (d.frequencia === 'mensal' && d.diaMes && (d.diaMes < 1 || d.diaMes > 28)) throw new BadRequestException('dia do mês entre 1 e 28');
    const fuso = 'America/Sao_Paulo';
    const proximoEm = proximaExecucao({ frequencia: d.frequencia, hora, diaSemana: d.diaSemana, diaMes: d.diaMes, fuso }, new Date());
    const a = await this.prisma.withTenant(tenantId, async (tx) => {
      if ((await tx.nicoAgendamento.count({ where: { ativo: true } })) >= 20) throw new BadRequestException('limite de 20 rotinas ativas por conta');
      return tx.nicoAgendamento.create({
        data: { tenantId, titulo: d.titulo.trim().slice(0, 120), instrucao: d.instrucao.trim().slice(0, 2000), frequencia: d.frequencia, hora, diaSemana: d.frequencia === 'semanal' ? (d.diaSemana ?? 1) : null, diaMes: d.frequencia === 'mensal' ? (d.diaMes ?? 1) : null, fuso, proximoEm, destinatarioId: identityId, criadoPor: identityId },
        select: { id: true, titulo: true, proximoEm: true },
      });
    });
    return { ...a, aviso: `Rotina criada. A primeira execução é em ${a.proximoEm.toLocaleString('pt-BR', { timeZone: fuso })}; o relatório chega no sino de notificações e no painel da NICO.` };
  }

  async listarAgendamentos(tenantId: string) {
    return this.prisma.withTenant(tenantId, (tx) => tx.nicoAgendamento.findMany({ orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, titulo: true, instrucao: true, frequencia: true, hora: true, diaSemana: true, diaMes: true, ativo: true, proximoEm: true, ultimoEm: true, ultimoStatus: true, ultimoErro: true } }));
  }

  async cancelarAgendamento(tenantId: string, id: string) {
    const r = await this.prisma.withTenant(tenantId, (tx) => tx.nicoAgendamento.updateMany({ where: { id, ativo: true }, data: { ativo: false, updatedAt: new Date() } }));
    if (!r.count) throw new NotFoundException('rotina não encontrada ou já pausada');
    return { ok: true };
  }
}
