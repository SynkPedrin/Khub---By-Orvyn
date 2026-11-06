// Orquestração do Content Operations Lab — importa o núcleo de
// scripts/seed-content-demo.mjs e injeta os 3 roteiros de negócio.
//
//   node scripts/seed-content-demo-run.mjs
import { prisma, provisionarTenant, criarCampanha, seedInsights, timestampRealista, round2, dividirExato, jaSemeado, seedAgencia, DATASET_VERSION } from './seed-content-demo.mjs';

const pos = (x, y) => ({ x, y });
/** Senha de demonstração — só existe nos 3 tenants `is_demo:true` desta seed; não é segredo de produção. */
const SENHA_DEMO = process.env.CONTENT_DEMO_SENHA ?? 'ContentDemo2026!';

/**
 * Gera os contatos de um criativo a partir dos números do funil (que TÊM
 * que ser os mesmos números que aparecem em Campaigns/Analytics — é o
 * princípio de consistência do brief). `etapas` é a lista ordenada de
 * rótulos alcançados, do mais raso ("lead") ao mais fundo (fechamento);
 * cada contagem é um SUBCONJUNTO da anterior.
 */
function bucketsFunil(leads, etapas) {
  // etapas: [{label, count, tagAoParar}] — quem NÃO avança pra próxima etapa
  // fica marcado com `tagAoParar` daquela etapa (ex.: quem teve agendamento
  // mas não foi adiante fica "no_show", não simplesmente "lead").
  const buckets = [];
  let restante = leads;
  for (let i = 0; i < etapas.length; i++) {
    const atual = etapas[i];
    const proxima = etapas[i + 1];
    const avancam = proxima ? proxima.count : 0;
    const ficam = atual.count - avancam;
    if (ficam > 0) buckets.push({ tag: atual.tagAoParar, n: ficam, profundidade: i });
    restante -= atual.count;
  }
  if (restante > 0) buckets.push({ tag: 'novo', n: restante, profundidade: -1 });
  return buckets;
}

const PRIMEIROS_NOMES = ['Ana', 'Carolina', 'Juliana', 'Mariana', 'Fernanda', 'Beatriz', 'Camila', 'Rafaela', 'Larissa', 'Patrícia', 'Gabriela', 'Renata', 'Bruna', 'Tatiane', 'Débora', 'Aline', 'Priscila', 'Vanessa', 'Letícia', 'Amanda'];
const SOBRENOMES = ['Ferreira', 'Mendes', 'Rocha', 'Costa', 'Lima', 'Martins', 'Almeida', 'Nunes', 'Vieira', 'Souza', 'Pereira', 'Barros', 'Carvalho', 'Ribeiro', 'Teixeira', 'Cardoso', 'Moreira', 'Dias', 'Correia', 'Batista'];
function nomeAleatorio(usados) {
  let nome;
  do {
    nome = `${PRIMEIROS_NOMES[Math.floor(Math.random() * PRIMEIROS_NOMES.length)]} ${SOBRENOMES[Math.floor(Math.random() * SOBRENOMES.length)]}`;
  } while (usados.has(nome));
  usados.add(nome);
  return nome;
}

/** Cria os contatos de um criativo, distribuindo ricos (conversa completa) entre os "avançados". */
async function seedLeadsDoCreativo(tenantId, campaign, creative, owners, buckets, nomesRicos, usados) {
  let ownerIdx = 0;
  const criados = [];
  for (const b of buckets) {
    for (let i = 0; i < b.n; i++) {
      const diasAtras = Math.floor(Math.random() * 30);
      const nome = nomesRicos.length ? nomesRicos.shift() : nomeAleatorio(usados);
      const owner = owners[ownerIdx % owners.length];
      ownerIdx++;
      const contact = await prisma.contact.create({
        data: {
          tenantId, nome, telefone: `+5511${String(90000000 + Math.floor(Math.random() * 9000000))}`,
          tag: b.tag, origem: 'Meta Ads', ownerId: owner.id,
          adCampaignId: campaign.id, adCreativeId: creative.row.id,
          createdAt: timestampRealista(diasAtras), ultimoContatoAt: timestampRealista(Math.max(0, diasAtras - Math.floor(Math.random() * 3))),
        },
      });
      criados.push({ contact, profundidade: b.profundidade, diasAtras });
    }
  }
  return criados;
}

/** Conversa + mensagens reais só pros leads "ricos" (não todo mundo — o brief pede ~10 no total). */
async function seedConversaRica(tenantId, contact, diasAtras, roteiro) {
  const conv = await prisma.conversation.create({
    data: { tenantId, contactId: contact.id, nome: contact.nome, canal: 'WhatsApp', status: roteiro.aberta ? 'aberta' : 'resolvida', ultimaPrevia: roteiro.mensagens.at(-1).corpo.slice(0, 60), naoLidas: roteiro.aberta ? 1 : 0 },
  });
  for (const m of roteiro.mensagens) {
    await prisma.message.create({
      data: { tenantId, conversationId: conv.id, autorTipo: m.de, corpo: m.corpo, createdAt: timestampRealista(diasAtras - m.offsetDias) },
    });
  }
  return conv;
}

async function seedDeal(tenantId, pipeline, stages, contact, titulo, valor, statusStage, statusDeal, origem, diasAtras) {
  const stage = stages.find((s) => s.nome === statusStage) ?? stages[0];
  return prisma.deal.create({
    data: {
      tenantId, titulo, contactId: contact?.id, pipelineId: pipeline.id, stageId: stage.id,
      valor, status: statusDeal, origem, createdAt: timestampRealista(diasAtras), updatedAt: timestampRealista(Math.max(0, diasAtras - 1)),
    },
  });
}

/** Cria Workflow + WorkflowVersion publicada — mesmo shape real usado pelo marketplace/produção. */
async function seedAutomacao(tenantId, ownerId, nome, descricao, nos, arestas) {
  const wf = await prisma.workflow.create({ data: { tenantId, nome, descricao, status: 'ativo', criadoPor: ownerId, tags: ['content-demo'] } });
  const versao = await prisma.workflowVersion.create({
    data: { tenantId, workflowId: wf.id, versao: 1, grafo: { nos, arestas }, publicadoEm: new Date(), publicadoPor: ownerId },
  });
  await prisma.workflow.update({ where: { id: wf.id }, data: { versaoAtivaId: versao.id } });
  return wf;
}

/* =====================================================================
   NEGÓCIO 1 — CLÍNICA VITTA PRIME
   ===================================================================== */
async function seedClinica() {
  const nome = 'Clínica Vitta Prime (DEMO)';
  const existente = await jaSemeado(nome); if (existente) { console.log(`[skip] ${nome} já semeado`); return existente; }

  const { tenant, pipeline, stages, owners } = await provisionarTenant(nome, 'Clínica Médica / Estética', 'CLINIC', SENHA_DEMO);
  console.log(`[ok] tenant ${tenant.id} — ${nome}`);

  const spec = {
    slug: 'vitta', negocio: 'Clínica Vitta Prime', campanha: 'Vitta | Harmonização Facial | Setembro', objetivo: 'Leads / Messages', cor: '#B23A6B',
    criativos: [
      { slug: 'naturalidade', nome: 'Naturalidade sem exagero', formato: 'Reel', hook: 'Harmonização não deveria mudar seu rosto.', cta: 'Agende sua avaliação',
        spend: 620, impressions: 28400, clicks: 512, leads: 54, appointments: 19, shows: 15, sales: 7, revenue: 24500 },
      { slug: 'antes-depois', nome: 'Antes e depois', formato: 'Carousel', hook: 'Resultados reais de pacientes reais.', cta: 'Ver avaliação',
        spend: 410, impressions: 20600, clicks: 315, leads: 28, appointments: 8, shows: 6, sales: 2, revenue: 6400 },
      { slug: 'ultimas-vagas', nome: 'Últimas vagas', formato: 'Static', hook: 'Últimas vagas do mês para avaliação gratuita.', cta: 'Garantir vaga',
        spend: 265, impressions: 16900, clicks: 174, leads: 11, appointments: 2, shows: 1, sales: 0, revenue: 0 },
    ],
  };
  const { campaign, creatives } = await criarCampanha(tenant.id, owners[0].id, spec);
  await seedInsights(tenant.id, campaign, creatives);
  console.log(`[ok] campanha + ${creatives.length} criativos + insights de 30 dias`);

  const nomesRicos = ['Ana Ferreira', 'Carolina Mendes', 'Juliana Rocha', 'Mariana Costa', 'Fernanda Lima'];
  const usados = new Set(nomesRicos);
  let totalContatos = 0;
  let totalVendas = 0;

  for (const c of creatives) {
    const etapas = [
      { label: 'lead', count: c.leads, tagAoParar: 'NEW' },
      { label: 'appointment', count: c.appointments, tagAoParar: 'NO_SHOW' },
      { label: 'show', count: c.shows, tagAoParar: 'FOLLOW_UP' },
      { label: 'sale', count: c.sales, tagAoParar: 'CLOSED_WON' },
    ];
    const buckets = bucketsFunil(c.leads, etapas);
    const ricosDesteCreativo = c.slug === 'naturalidade' ? nomesRicos.splice(0, 5) : [];
    const criados = await seedLeadsDoCreativo(tenant.id, campaign, c, owners, buckets, ricosDesteCreativo, usados);
    totalContatos += criados.length;

    // Deals para quem chegou a "show" (avaliação realizada) — ganho pra quem virou venda.
    const showsOuMais = criados.filter((x) => x.profundidade >= 2);
    const valoresVenda = dividirExato(c.revenue, c.sales || 0, c.sales ? Math.floor((c.revenue / c.sales) * 0.6) : 0);
    let vendaIdx = 0;
    for (const x of showsOuMais) {
      const ehVenda = x.profundidade === 3;
      const valor = ehVenda ? valoresVenda[vendaIdx++] : round2(800 + Math.random() * 1200);
      await seedDeal(
        tenant.id, pipeline, stages, x.contact, `${x.contact.nome} — Harmonização Facial`, valor,
        ehVenda ? 'Fechado / Ganho' : 'Negociação', ehVenda ? 'ganho' : 'aberto', `Meta Ads · ${c.nome}`, x.diasAtras,
      );
      if (ehVenda) totalVendas++;
    }

    // Conversa rica só pra quem tem nome curado (os 5 da Vitta) — WhatsApp real, sem envio externo.
    for (const x of criados) {
      if (!nomesRicos.includes(x.contact.nome) && ['Ana Ferreira', 'Carolina Mendes', 'Juliana Rocha', 'Mariana Costa', 'Fernanda Lima'].includes(x.contact.nome)) {
        await seedConversaRica(tenant.id, x.contact, x.diasAtras, {
          aberta: x.profundidade < 3,
          mensagens: [
            { de: 'contato', corpo: `Oi! Vi o anúncio "${c.nome}" e queria saber mais sobre harmonização facial.`, offsetDias: 0 },
            { de: 'usuario', corpo: 'Olá! Que ótimo. Temos avaliação gratuita — posso te encaixar essa semana?', offsetDias: 0 },
            { de: 'contato', corpo: 'Pode ser sim, quais os horários?', offsetDias: 0 },
            ...(x.profundidade >= 1 ? [{ de: 'usuario', corpo: 'Perfeito, agendei sua avaliação. Te mando um lembrete no dia.', offsetDias: -1 }] : []),
            ...(x.profundidade >= 3 ? [{ de: 'contato', corpo: 'Amei o resultado, muito obrigada!', offsetDias: -3 }] : []),
          ],
        });
      }
    }
  }
  console.log(`[ok] ${totalContatos} contatos, ${totalVendas} vendas fechadas`);

  // ---- Automações reais (engine existente) ----
  await seedAutomacao(tenant.id, owners[0].id, 'Lead Meta → Atendimento', 'Novo lead do Meta Ads recebe responsável, tag e tarefa de contato imediato.', [
    { id: 'g', tipo: 'gatilho.contato_criado', posicao: pos(0, 0), config: {} },
    { id: 't1', tipo: 'acao.adicionar_tag', posicao: pos(260, 0), config: { tag: 'META' } },
    { id: 't2', tipo: 'acao.criar_tarefa', posicao: pos(520, 0), config: { titulo: 'Primeiro contato — lead Meta Ads', prazoHoras: 1 } },
    { id: 'n', tipo: 'acao.criar_nota', posicao: pos(780, 0), config: { corpo: 'Lead novo via Meta Ads — alerta interno para o time de atendimento.' } },
  ], [{ id: 'e1', de: 'g', para: 't1' }, { id: 'e2', de: 't1', para: 't2' }, { id: 'e3', de: 't2', para: 'n' }]);

  await seedAutomacao(tenant.id, owners[0].id, 'Sem resposta → Follow-up 2h', 'Se o lead não responder em 2h, dispara lembrete automático.', [
    { id: 'g', tipo: 'gatilho.mensagem_recebida', posicao: pos(0, 0), config: { direcao: 'saida' } },
    { id: 'w', tipo: 'controle.esperar_resposta', posicao: pos(260, 0), config: { duracao: 2, unidade: 'horas' } },
    { id: 's', tipo: 'acao.enviar_sms', posicao: pos(520, -60), config: { texto: 'Oi {{contato.nome}}, ainda tem interesse na avaliação? Posso te ajudar a agendar 🙂' } },
    { id: 'fim', tipo: 'controle.encerrar', posicao: pos(520, 60), config: {} },
  ], [{ id: 'e1', de: 'g', para: 'w' }, { id: 'e2', de: 'w', para: 's', ramo: 'timeout' }, { id: 'e3', de: 'w', para: 'fim', ramo: 'resposta' }]);

  await seedAutomacao(tenant.id, owners[1].id, 'Avaliação amanhã', 'Lembrete automático 24h antes da avaliação agendada.', [
    { id: 'g', tipo: 'gatilho.tag_adicionada', posicao: pos(0, 0), config: { tag: 'agendamento_confirmado' } },
    { id: 'w', tipo: 'controle.esperar', posicao: pos(260, 0), config: { duracao: 22, unidade: 'horas' } },
    { id: 's', tipo: 'acao.enviar_sms', posicao: pos(520, 0), config: { texto: 'Lembrete: sua avaliação na Vitta Prime é amanhã! Nos vemos lá 💜' } },
  ], [{ id: 'e1', de: 'g', para: 'w' }, { id: 'e2', de: 'w', para: 's' }]);

  await seedAutomacao(tenant.id, owners[1].id, 'No-show recovery', 'Recupera contato que faltou à avaliação com uma nova tentativa de reagendamento.', [
    { id: 'g', tipo: 'gatilho.tag_adicionada', posicao: pos(0, 0), config: { tag: 'NO_SHOW' } },
    { id: 'w', tipo: 'controle.esperar', posicao: pos(260, 0), config: { duracao: 2, unidade: 'horas' } },
    { id: 's', tipo: 'acao.enviar_sms', posicao: pos(520, 0), config: { texto: 'Sentimos sua falta! Quer reagendar sua avaliação gratuita?' } },
    { id: 't', tipo: 'acao.criar_tarefa', posicao: pos(780, 0), config: { titulo: 'Reagendar avaliação (no-show)', prazoHoras: 24 } },
  ], [{ id: 'e1', de: 'g', para: 'w' }, { id: 'e2', de: 'w', para: 's' }, { id: 'e3', de: 's', para: 't' }]);

  console.log('[ok] 4 automações reais criadas (workflow + versão publicada)');
  return tenant;
}

/* =====================================================================
   NEGÓCIO 2 — HELIOS ENERGIA (solar)
   ===================================================================== */
const STAGES_SOLAR = [
  ['Entrada', 0, '#0284C7'], ['Qualificação', 1, '#0EA5E9'], ['Reunião', 2, '#7B2FBE'],
  ['Proposta', 3, '#B7791F'], ['Negociação', 4, '#C2410C'], ['Fechamento', 5, '#1E8449'],
];

async function seedSolar() {
  const nome = 'Helios Energia (DEMO)';
  const existente = await jaSemeado(nome); if (existente) { console.log(`[skip] ${nome} já semeado`); return existente; }

  const { tenant, pipeline, stages, owners } = await provisionarTenant(nome, 'Energia Solar', 'SOLAR', SENHA_DEMO, STAGES_SOLAR);
  console.log(`[ok] tenant ${tenant.id} — ${nome}`);

  const spec = {
    slug: 'helios', negocio: 'Helios Energia', campanha: 'Helios | Solar Empresarial | Setembro', objetivo: 'Leads', cor: '#0284C7',
    criativos: [
      { slug: 'quanto-paga', nome: 'Quanto sua empresa paga de energia?', formato: 'Video', hook: 'Quanto sua empresa paga de energia?', cta: 'Fazer diagnóstico gratuito',
        spend: 980, impressions: 34200, clicks: 690, leads: 46, qualified: 28, proposals: 14, sales: 3, revenue: 186000 },
      { slug: 'reduza-custo', nome: 'Economize até X', formato: 'Static', hook: 'Reduza seu custo de energia.', cta: 'Saiba mais',
        spend: 720, impressions: 31400, clicks: 515, leads: 30, qualified: 15, proposals: 7, sales: 1, revenue: 58000 },
      { slug: 'projeto-fotovoltaico', nome: 'Projeto Fotovoltaico', formato: 'Carousel', hook: 'Projeto fotovoltaico sob medida para sua empresa.', cta: 'Solicitar orçamento',
        spend: 450, impressions: 23100, clicks: 288, leads: 13, qualified: 5, proposals: 2, sales: 0, revenue: 0 },
    ],
  };
  const { campaign, creatives } = await criarCampanha(tenant.id, owners[0].id, spec);
  await seedInsights(tenant.id, campaign, creatives);
  console.log(`[ok] campanha + ${creatives.length} criativos + insights de 30 dias`);

  const usados = new Set();
  let totalContatos = 0;

  for (const c of creatives) {
    const etapas = [
      { label: 'lead', count: c.leads, tagAoParar: 'NEW' },
      { label: 'qualified', count: c.qualified, tagAoParar: 'LOST' },
      { label: 'proposal', count: c.proposals, tagAoParar: 'FOLLOW_UP' },
      { label: 'sale', count: c.sales, tagAoParar: 'CLOSED_WON' },
    ];
    const buckets = bucketsFunil(c.leads, etapas);
    const criados = await seedLeadsDoCreativo(tenant.id, campaign, c, owners, buckets, [], usados);
    totalContatos += criados.length;

    const propostaOuMais = criados.filter((x) => x.profundidade >= 2);
    const valoresVenda = dividirExato(c.revenue, c.sales || 0, c.sales ? Math.floor((c.revenue / c.sales) * 0.6) : 0);
    let vendaIdx = 0;
    for (const x of propostaOuMais) {
      const ehVenda = x.profundidade === 3;
      const valor = ehVenda ? valoresVenda[vendaIdx++] : round2(15000 + Math.random() * 40000);
      await seedDeal(
        tenant.id, pipeline, stages, x.contact, `${x.contact.nome} — Projeto Solar`, valor,
        ehVenda ? 'Fechamento' : 'Negociação', ehVenda ? 'ganho' : 'aberto', `Meta Ads · ${c.nome}`, x.diasAtras,
      );
    }
  }
  console.log(`[ok] ${totalContatos} contatos (funil da campanha)`);

  // ---- Deals nomeados do pipeline (seção 11 do brief) — curadoria qualitativa, além do funil da campanha ----
  const nomeados = [
    { nome: 'Marcos Vieira', empresa: 'Indústria NovaSul', valor: 82000, etapa: 'Proposta', status: 'aberto', diasAtras: 3 },
    { nome: 'Carla Mendes', empresa: 'Mercado Horizonte', valor: 64000, etapa: 'Negociação', status: 'aberto', diasAtras: 5 },
    { nome: 'Rafael Nunes', empresa: 'LogTech', valor: 58000, etapa: 'Fechamento', status: 'ganho', diasAtras: 10 },
    { nome: 'Bruno Martins', empresa: 'AgroVale', valor: 96000, etapa: 'Negociação', status: 'aberto', diasAtras: 5 },
  ];
  for (const n of nomeados) {
    const contact = await prisma.contact.create({
      data: { tenantId: tenant.id, nome: n.nome, empresa: n.empresa, telefone: `+5511${String(90000000 + Math.floor(Math.random() * 9000000))}`, tag: n.status === 'ganho' ? 'CLOSED_WON' : 'NEGOCIACAO', origem: 'Meta Ads', ownerId: owners[Math.floor(Math.random() * owners.length)].id, createdAt: timestampRealista(n.diasAtras + 10) },
    });
    await seedDeal(tenant.id, pipeline, stages, contact, `${n.nome} — ${n.empresa}`, n.valor, n.etapa, n.status, 'Meta Ads', n.diasAtras);
    if (n.nome === 'Bruno Martins') {
      await prisma.task.create({
        data: { tenantId: tenant.id, titulo: `Revisar proposta parada — ${n.empresa}`, descricao: 'Proposta enviada há 5 dias sem retorno.', status: 'aberta', prioridade: 'alta', assigneeId: owners[0].id, contactId: contact.id, dueAt: timestampRealista(-1) },
      });
    }
  }
  console.log('[ok] 4 negócios nomeados do pipeline (Marcos, Carla, Rafael, Bruno)');

  await seedAutomacao(tenant.id, owners[0].id, 'Lead Solar Qualification', 'Novo lead solar registra consumo, é qualificado e recebe vendedor responsável.', [
    { id: 'g', tipo: 'gatilho.contato_criado', posicao: pos(0, 0), config: {} },
    { id: 't1', tipo: 'acao.criar_tarefa', posicao: pos(260, 0), config: { titulo: 'Registrar consumo de energia do lead', prazoHoras: 2 } },
    { id: 't2', tipo: 'acao.adicionar_tag', posicao: pos(520, 0), config: { tag: 'qualificacao_solar' } },
  ], [{ id: 'e1', de: 'g', para: 't1' }, { id: 'e2', de: 't1', para: 't2' }]);

  await seedAutomacao(tenant.id, owners[1].id, 'Proposal Follow-up', 'Proposta enviada sem resposta em 48h dispara follow-up; sem resposta em 72h vira tarefa pro vendedor.', [
    { id: 'g', tipo: 'gatilho.tag_adicionada', posicao: pos(0, 0), config: { tag: 'proposta_enviada' } },
    { id: 'w1', tipo: 'controle.esperar_resposta', posicao: pos(260, 0), config: { duracao: 48, unidade: 'horas' } },
    { id: 's', tipo: 'acao.enviar_sms', posicao: pos(520, -60), config: { texto: 'Oi {{contato.nome}}, conseguiu ver a proposta? Fico à disposição para tirar dúvidas.' } },
    { id: 'w2', tipo: 'controle.esperar', posicao: pos(780, -60), config: { duracao: 72, unidade: 'horas' } },
    { id: 't', tipo: 'acao.criar_tarefa', posicao: pos(1040, -60), config: { titulo: 'Ligar — proposta sem resposta há 72h', prazoHoras: 4 } },
    { id: 'fim', tipo: 'controle.encerrar', posicao: pos(520, 60), config: {} },
  ], [{ id: 'e1', de: 'g', para: 'w1' }, { id: 'e2', de: 'w1', para: 's', ramo: 'timeout' }, { id: 'e3', de: 'w1', para: 'fim', ramo: 'resposta' }, { id: 'e4', de: 's', para: 'w2' }, { id: 'e5', de: 'w2', para: 't' }]);

  await seedAutomacao(tenant.id, owners[1].id, 'Hot Opportunity', 'Oportunidade qualificada, de alto valor e com conversa ativa recebe tag HOT e alerta o responsável.', [
    { id: 'g', tipo: 'gatilho.tag_adicionada', posicao: pos(0, 0), config: { tag: 'qualificacao_solar' } },
    { id: 'c', tipo: 'controle.condicao', posicao: pos(260, 0), config: { ramos: [{ id: 'alto', rotulo: 'Valor alto', juncao: 'AND', regras: [{ campo: 'contato.valor', operador: 'maior', valor: '50000' }] }] } },
    { id: 't', tipo: 'acao.adicionar_tag', posicao: pos(520, -60), config: { tag: 'HOT' } },
    { id: 'n', tipo: 'acao.criar_nota', posicao: pos(780, -60), config: { corpo: 'Oportunidade quente — valor alto, priorizar contato.' } },
  ], [{ id: 'e1', de: 'g', para: 'c' }, { id: 'e2', de: 'c', para: 't', ramo: 'alto' }, { id: 'e3', de: 't', para: 'n' }]);

  await seedAutomacao(tenant.id, owners[0].id, 'Stalled Proposal', 'Proposta sem atividade há mais de 4 dias é sinalizada e vira próxima ação para o responsável.', [
    { id: 'g', tipo: 'gatilho.tag_adicionada', posicao: pos(0, 0), config: { tag: 'proposta_enviada' } },
    { id: 'w', tipo: 'controle.esperar', posicao: pos(260, 0), config: { duracao: 96, unidade: 'horas' } },
    { id: 't1', tipo: 'acao.adicionar_tag', posicao: pos(520, 0), config: { tag: 'PROPOSTA_PARADA' } },
    { id: 't2', tipo: 'acao.criar_tarefa', posicao: pos(780, 0), config: { titulo: 'Proposta parada — retomar contato', prazoHoras: 24 } },
  ], [{ id: 'e1', de: 'g', para: 'w' }, { id: 'e2', de: 'w', para: 't1' }, { id: 'e3', de: 't1', para: 't2' }]);

  console.log('[ok] 4 automações reais criadas (workflow + versão publicada)');
  return tenant;
}

/* =====================================================================
   NEGÓCIO 3 — FORMA CASA PLANEJADOS
   ===================================================================== */
async function seedPlanejados() {
  const nome = 'Forma Casa Planejados (DEMO)';
  const existente = await jaSemeado(nome); if (existente) { console.log(`[skip] ${nome} já semeado`); return existente; }

  const { tenant, pipeline, stages, owners } = await provisionarTenant(nome, 'Móveis Planejados', 'PLANNED_FURNITURE', SENHA_DEMO);
  console.log(`[ok] tenant ${tenant.id} — ${nome}`);

  const spec = {
    slug: 'forma', negocio: 'Forma Casa Planejados', campanha: 'Forma Casa | Projetos Sob Medida', objetivo: 'Leads / Messages', cor: '#B7791F',
    criativos: [
      { slug: 'antes-de-comprar', nome: 'Antes de comprar móveis...', formato: 'Reel', hook: 'Antes de comprar móveis, veja isso.', cta: 'Agendar visita',
        spend: 540, impressions: 31800, clicks: 585, leads: 62, qualified: 31, visits: 14, proposals: 9, sales: 3, revenue: 74000 },
      { slug: 'cozinha-premium', nome: 'Projeto cozinha premium', formato: 'Carousel', hook: 'Sua cozinha planejada, do jeito que você imaginou.', cta: 'Ver projetos',
        spend: 390, impressions: 24000, clicks: 350, leads: 30, qualified: 14, visits: 5, proposals: 3, sales: 1, revenue: 21000 },
      { slug: 'ambientes-planejados', nome: 'Ambientes planejados', formato: 'Static', hook: 'Cada ambiente planejado para o seu jeito de viver.', cta: 'Solicitar orçamento',
        spend: 290, impressions: 18700, clicks: 201, leads: 14, qualified: 5, visits: 1, proposals: 0, sales: 0, revenue: 0 },
    ],
  };
  const { campaign, creatives } = await criarCampanha(tenant.id, owners[0].id, spec);
  await seedInsights(tenant.id, campaign, creatives);
  console.log(`[ok] campanha + ${creatives.length} criativos + insights de 30 dias`);

  const usados = new Set();
  let totalContatos = 0;

  for (const c of creatives) {
    const etapas = [
      { label: 'lead', count: c.leads, tagAoParar: 'NEW' },
      { label: 'qualified', count: c.qualified, tagAoParar: 'LOST' },
      { label: 'visit', count: c.visits, tagAoParar: 'FOLLOW_UP' },
      { label: 'proposal', count: c.proposals, tagAoParar: 'FOLLOW_UP' },
      { label: 'sale', count: c.sales, tagAoParar: 'CLOSED_WON' },
    ];
    const buckets = bucketsFunil(c.leads, etapas);
    const criados = await seedLeadsDoCreativo(tenant.id, campaign, c, owners, buckets, [], usados);
    totalContatos += criados.length;

    const propostaOuMais = criados.filter((x) => x.profundidade >= 3);
    const valoresVenda = dividirExato(c.revenue, c.sales || 0, c.sales ? Math.floor((c.revenue / c.sales) * 0.6) : 0);
    let vendaIdx = 0;
    for (const x of propostaOuMais) {
      const ehVenda = x.profundidade === 4;
      const valor = ehVenda ? valoresVenda[vendaIdx++] : round2(8000 + Math.random() * 15000);
      await seedDeal(
        tenant.id, pipeline, stages, x.contact, `${x.contact.nome} — Projeto Planejado`, valor,
        ehVenda ? 'Fechado / Ganho' : 'Negociação', ehVenda ? 'ganho' : 'aberto', `Meta Ads · ${c.nome}`, x.diasAtras,
      );
    }
  }
  console.log(`[ok] ${totalContatos} contatos (funil da campanha)`);

  // ---- Deals nomeados do pipeline (seção 15 do brief) ----
  const nomeados = [
    { nome: 'Camila Rocha', projeto: 'Projeto cozinha + lavanderia', valor: 28500, etapa: 'Proposta', status: 'aberto', diasAtras: 4 },
    { nome: 'Lucas Almeida', projeto: 'Apartamento completo', valor: 47000, etapa: 'Negociação', status: 'aberto', diasAtras: 6 },
    { nome: 'Beatriz Martins', projeto: 'Dormitório', valor: 16500, etapa: 'Negociação', status: 'aberto', diasAtras: 8 },
    { nome: 'Fernando Costa', projeto: 'Sala + cozinha', valor: 31000, etapa: 'Fechado / Ganho', status: 'ganho', diasAtras: 12 },
  ];
  for (const n of nomeados) {
    const contact = await prisma.contact.create({
      data: { tenantId: tenant.id, nome: n.nome, telefone: `+5511${String(90000000 + Math.floor(Math.random() * 9000000))}`, tag: n.status === 'ganho' ? 'CLOSED_WON' : 'FOLLOW_UP', origem: 'Meta Ads', ownerId: owners[Math.floor(Math.random() * owners.length)].id, createdAt: timestampRealista(n.diasAtras + 8) },
    });
    await seedDeal(tenant.id, pipeline, stages, contact, `${n.nome} — ${n.projeto}`, n.valor, n.etapa, n.status, 'Meta Ads', n.diasAtras);
  }
  console.log('[ok] 4 negócios nomeados do pipeline (Camila, Lucas, Beatriz, Fernando)');

  await seedAutomacao(tenant.id, owners[0].id, 'Novo orçamento', 'Lead qualificado recebe briefing e designer responsável.', [
    { id: 'g', tipo: 'gatilho.tag_adicionada', posicao: pos(0, 0), config: { tag: 'qualificado' } },
    { id: 't1', tipo: 'acao.criar_tarefa', posicao: pos(260, 0), config: { titulo: 'Briefing do projeto', prazoHoras: 4 } },
    { id: 't2', tipo: 'acao.criar_nota', posicao: pos(520, 0), config: { corpo: 'Designer atribuído para este projeto.' } },
  ], [{ id: 'e1', de: 'g', para: 't1' }, { id: 'e2', de: 't1', para: 't2' }]);

  await seedAutomacao(tenant.id, owners[1].id, 'Projeto enviado', 'Projeto/proposta sem resposta em 24h recebe follow-up automático.', [
    { id: 'g', tipo: 'gatilho.tag_adicionada', posicao: pos(0, 0), config: { tag: 'projeto_enviado' } },
    { id: 'w', tipo: 'controle.esperar_resposta', posicao: pos(260, 0), config: { duracao: 24, unidade: 'horas' } },
    { id: 's', tipo: 'acao.enviar_sms', posicao: pos(520, -60), config: { texto: 'Oi {{contato.nome}}, o que achou do projeto? Posso ajustar algo.' } },
    { id: 'fim', tipo: 'controle.encerrar', posicao: pos(520, 60), config: {} },
  ], [{ id: 'e1', de: 'g', para: 'w' }, { id: 'e2', de: 'w', para: 's', ramo: 'timeout' }, { id: 'e3', de: 'w', para: 'fim', ramo: 'resposta' }]);

  await seedAutomacao(tenant.id, owners[1].id, 'Orçamento parado', 'Proposta sem atividade há mais de 3 dias recebe tag e vira tarefa para o responsável.', [
    { id: 'g', tipo: 'gatilho.tag_adicionada', posicao: pos(0, 0), config: { tag: 'projeto_enviado' } },
    { id: 'w', tipo: 'controle.esperar', posicao: pos(260, 0), config: { duracao: 72, unidade: 'horas' } },
    { id: 't1', tipo: 'acao.adicionar_tag', posicao: pos(520, 0), config: { tag: 'PROPOSTA_PARADA' } },
    { id: 't2', tipo: 'acao.criar_tarefa', posicao: pos(780, 0), config: { titulo: 'Orçamento parado — retomar contato', prazoHoras: 24 } },
  ], [{ id: 'e1', de: 'g', para: 'w' }, { id: 'e2', de: 'w', para: 't1' }, { id: 'e3', de: 't1', para: 't2' }]);

  await seedAutomacao(tenant.id, owners[0].id, 'Visita agendada', 'Confirmação de visita ao showroom recebe lembrete automático.', [
    { id: 'g', tipo: 'gatilho.tag_adicionada', posicao: pos(0, 0), config: { tag: 'visita_agendada' } },
    { id: 'w', tipo: 'controle.esperar', posicao: pos(260, 0), config: { duracao: 22, unidade: 'horas' } },
    { id: 's', tipo: 'acao.enviar_sms', posicao: pos(520, 0), config: { texto: 'Lembrete: sua visita à Forma Casa é amanhã!' } },
  ], [{ id: 'e1', de: 'g', para: 'w' }, { id: 'e2', de: 'w', para: 's' }]);

  console.log('[ok] 5 automações reais criadas (workflow + versão publicada)');
  return tenant;
}

async function main() {
  console.log(`=== Content Operations Lab — dataset ${DATASET_VERSION} ===`);
  const clinic = await seedClinica();
  const solar = await seedSolar();
  const furniture = await seedPlanejados();
  await seedAgencia(SENHA_DEMO, { 'Clínica Vitta Prime': clinic, 'Helios Energia': solar, 'Forma Casa Planejados': furniture });
  console.log('=== Concluído ===');
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
