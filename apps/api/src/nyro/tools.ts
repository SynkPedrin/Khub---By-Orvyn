import { z } from 'zod';

/**
 * Conjunto **fechado** de tools da Nyro (ADR-0014 — fecha a LACUNA do PRD §5.1).
 *
 * Invariante do CLAUDE.md: *"Nyro é usuário, não deus"*. Ela nunca escreve no
 * banco: toda tool aqui vira chamada de serviço do CRM/automações, com as mesmas
 * validações, RLS e auditoria (`actor:'nyro'`). Tool que não está aqui não existe
 * — o modelo não a recebe e, se alucinar o nome, o executor recusa.
 */

/** Ações que mexem no mundo real pedem confirmação humana (PRD §5.1). */
export type Sensibilidade = 'leitura' | 'escrita' | 'sensivel';

export interface Tool {
  nome: string;
  descricao: string;
  schema: z.ZodTypeAny;
  sensibilidade: Sensibilidade;
  /** Como explicar ao humano o que será feito (tela de aprovação). */
  resumir: (args: Record<string, never>) => string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const t = <S extends z.ZodTypeAny>(
  nome: string,
  descricao: string,
  schema: S,
  sensibilidade: Sensibilidade,
  resumir: (a: z.infer<S>) => string,
): Tool => ({ nome, descricao, schema, sensibilidade, resumir: resumir as any });

export const TOOLS: Tool[] = [
  // ---------------- Leitura (livres: não mudam nada) ----------------
  t(
    'buscar_conhecimento',
    'Busca na base de conhecimento do nicho e da conta. Use SEMPRE antes de responder dúvida técnica, de preço, prazo ou protocolo.',
    z.object({ pergunta: z.string().min(3).max(400) }),
    'leitura',
    (a) => `buscar "${a.pergunta}" no conhecimento`,
  ),
  t(
    'resumo_do_funil',
    'Números atuais do CRM: contatos, negócios por etapa, valor no funil, taxa de conversão.',
    z.object({}),
    'leitura',
    () => 'ler o resumo do funil',
  ),
  t(
    'buscar_contatos',
    'Procura contatos por nome, e-mail, telefone, empresa ou tag.',
    z.object({ termo: z.string().min(2).max(80) }),
    'leitura',
    (a) => `procurar contatos com "${a.termo}"`,
  ),
  t(
    'ver_contato',
    'Perfil 360 de um contato: dados, negócios, conversas, tarefas e histórico.',
    z.object({ contactId: z.string().uuid() }),
    'leitura',
    () => 'abrir o perfil do contato',
  ),
  t(
    'listar_automacoes',
    'Lista as automações do tenant, com status e número de execuções/falhas.',
    z.object({}),
    'leitura',
    () => 'listar as automações',
  ),

  t(
    'resumo_financeiro',
    'Visão financeira da conta: recebido, a receber, vencido (valores em centavos), número de cobranças pagas/vencidas e, junto, o valor no funil. Use para qualquer pergunta de caixa, inadimplência, receita ou previsão.',
    z.object({}),
    'leitura',
    () => 'ler o resumo financeiro',
  ),
  t(
    'listar_cobrancas',
    'Lista as cobranças da conta (descrição, valor em centavos, vencimento, status). Filtre por status para achar inadimplentes ou o que falta receber.',
    z.object({ status: z.enum(['rascunho', 'enviada', 'paga', 'vencida', 'cancelada']).optional() }),
    'leitura',
    (a) => (a.status ? `listar cobranças ${a.status}s` : 'listar as cobranças'),
  ),
  t(
    'guia_do_sistema',
    'Mapa do KHUB: onde fica cada tela, o que ela faz e como fazer tarefas comuns (criar automação, conectar WhatsApp, ver campanhas, cobrar cliente...). Use quando perguntarem "onde fica", "como faço" ou "como configuro".',
    z.object({ assunto: z.string().max(120).optional() }),
    'leitura',
    (a) => (a.assunto ? `consultar o mapa do sistema: "${a.assunto}"` : 'consultar o mapa do sistema'),
  ),

  t(
    'pesquisar_web',
    'Pesquisa na web (Google-like) e devolve títulos, links e resumo. Com lerPaginas=true traz também o conteúdo dos resultados: use para benchmark de concorrentes, tendências, preços de mercado, referências de copy, notícias e dúvidas que a base interna não responde. Cite a URL de onde tirou cada informação.',
    z.object({ consulta: z.string().min(3).max(300), limite: z.number().int().min(1).max(8).default(5), lerPaginas: z.boolean().default(false) }),
    'leitura',
    (a) => `pesquisar na web: "${a.consulta}"`,
  ),
  t(
    'ler_pagina',
    'Lê uma página pública da web (site de concorrente, landing page, artigo, perfil) e devolve o texto em Markdown. Use para analisar a oferta, a copy e a estrutura de uma página específica.',
    z.object({ url: z.string().url().max(500) }),
    'leitura',
    (a) => `ler a página ${a.url.replace(/^https?:\/\//, '').slice(0, 60)}`,
  ),
  t(
    'atualizar_plano',
    'Registra e atualiza o PLANO de trabalho visível para o usuário. Chame no início de tarefas com 3 ou mais etapas (objetivo + passos) e de novo a cada etapa concluída, marcando o status. Não use em conversa simples.',
    z.object({
      objetivo: z.string().min(3).max(200),
      passos: z.array(z.object({ texto: z.string().min(2).max(160), status: z.enum(['pendente', 'fazendo', 'feito']) })).min(1).max(10),
    }),
    'leitura',
    (a) => `plano: ${a.objetivo}`,
  ),
  t(
    'insights_conversas',
    'Lê as mensagens recentes que os LEADS enviaram nas conversas (sem telefone nem e-mail) para você extrair dores, objeções, dúvidas e linguagem real do cliente. Use antes de escrever copy, roteiro, FAQ ou melhorar o prompt do agente. Resuma padrões; não cite dados pessoais.',
    z.object({ dias: z.number().int().min(1).max(90).default(30), termo: z.string().max(60).optional() }),
    'leitura',
    (a) => `ler o que os leads falaram nos últimos ${a.dias} dias`,
  ),
  t(
    'leads_sem_resposta',
    'Conversas em que a ÚLTIMA mensagem é do lead e ele está sem resposta há mais de N horas, com o número exato, a contagem por etapa do funil e os mais antigos (nome, canal, etapa, valor). Use para "quantos leads estão sem resposta há mais de 24h", gargalo de atendimento e priorização de follow-up.',
    z.object({ horas: z.number().int().min(1).max(720).default(24), etapa: z.string().max(60).optional() }),
    'leitura',
    (a) => `ver quem está sem resposta há mais de ${a.horas}h`,
  ),
  t(
    'listar_negocios',
    'Lista negócios do funil com valor, etapa, origem e HÁ QUANTOS DIAS estão parados, mais o total e o valor somado da seleção. Filtre por etapa (nome), status e "parados há X dias". Use para pipeline parado, negócios de maior valor em risco e previsão.',
    z.object({ etapa: z.string().max(60).optional(), status: z.enum(['aberto', 'ganho', 'perdido']).default('aberto'), paradosHaDias: z.number().int().min(1).max(3650).optional(), limite: z.number().int().min(1).max(100).default(30) }),
    'leitura',
    (a) => `listar negócios${a.etapa ? ` em "${a.etapa}"` : ''}${a.paradosHaDias ? ` parados há ${a.paradosHaDias}+ dias` : ''}`,
  ),
  t(
    'agenda_periodo',
    'Agenda de um período (datas AAAA-MM-DD, horário de Brasília): total, contagem por status, % de faltas, faturamento previsto/realizado e a lista de compromissos. Use para ocupação, no-show, "como foi a semana" e "o que tenho amanhã".',
    z.object({ de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
    'leitura',
    (a) => `ver a agenda de ${a.de} a ${a.ate}`,
  ),
  t(
    'metricas_atendimento',
    'Volume e velocidade do atendimento nos últimos N dias: conversas recebidas, quantas ficaram sem nenhuma resposta, mediana do tempo até a primeira resposta e mensagens por canal.',
    z.object({ dias: z.number().int().min(1).max(180).default(30) }),
    'leitura',
    (a) => `medir o atendimento dos últimos ${a.dias} dias`,
  ),
  t(
    'esquecer',
    'Apaga um fato da memória da conta (use quando o usuário corrigir ou disser que algo mudou).',
    z.object({ chave: z.string().min(2).max(60) }),
    'escrita',
    (a) => `esquecer "${a.chave}"`,
  ),

  // ---------------- Escrita (efeito interno, reversível) ----------------
  t(
    'criar_contato',
    'Cadastra um contato novo no CRM.',
    z.object({
      nome: z.string().min(1).max(160),
      email: z.string().email().optional(),
      telefone: z.string().max(40).optional(),
      empresa: z.string().max(160).optional(),
      tag: z.string().max(40).optional(),
    }),
    'escrita',
    (a) => `criar o contato "${a.nome}"`,
  ),
  t(
    'atualizar_contato',
    'Altera um campo do contato (nome, email, telefone, empresa, tag ou valor estimado).',
    z.object({
      contactId: z.string().uuid(),
      campo: z.enum(['nome', 'email', 'telefone', 'empresa', 'tag', 'valorEstimado']),
      valor: z.string().max(200),
    }),
    'escrita',
    (a) => `mudar ${a.campo} do contato para "${a.valor}"`,
  ),
  t(
    'criar_tarefa',
    'Abre uma tarefa para a equipe, opcionalmente ligada a um contato.',
    z.object({
      titulo: z.string().min(1).max(200),
      contactId: z.string().uuid().optional(),
      prioridade: z.enum(['baixa', 'media', 'alta']).default('media'),
      emDias: z.number().int().min(0).max(90).default(0),
    }),
    'escrita',
    (a) => `criar a tarefa "${a.titulo}"`,
  ),
  t(
    'adicionar_nota',
    'Registra uma nota no histórico do contato.',
    z.object({ contactId: z.string().uuid(), corpo: z.string().min(1).max(2000) }),
    'escrita',
    () => 'adicionar uma nota no contato',
  ),
  t(
    'criar_oportunidade',
    'Cria um negócio no funil para um contato.',
    z.object({
      titulo: z.string().min(1).max(200),
      contactId: z.string().uuid(),
      stageId: z.string().uuid(),
      valor: z.number().min(0).optional(),
    }),
    'escrita',
    (a) => `criar a oportunidade "${a.titulo}"`,
  ),
  t(
    'lembrar',
    'Guarda um fato do negócio na memória da conta (ticket médio, tom de voz, horário...). Use quando o usuário informar algo que vale para sempre.',
    z.object({ chave: z.string().min(2).max(60), valor: z.string().min(1).max(400) }),
    'escrita',
    (a) => `lembrar que ${a.chave} = "${a.valor}"`,
  ),

  // ---------------- Configuração do CRM (a Nyro monta) ----------------
  t(
    'criar_funil',
    'Cria um novo funil (pipeline) com as etapas informadas. Use na configuração inicial do CRM, adaptando as etapas ao processo comercial do cliente.',
    z.object({ nome: z.string().min(1).max(80), etapas: z.array(z.string().min(1).max(60)).min(2).max(12) }),
    'escrita',
    (a) => `criar o funil "${a.nome}" (${a.etapas.join(' → ')})`,
  ),
  t(
    'criar_etapa',
    'Adiciona uma etapa ao fim de um funil existente.',
    z.object({ pipelineId: z.string().uuid(), nome: z.string().min(1).max(60), cor: z.string().max(9).optional() }),
    'escrita',
    (a) => `adicionar a etapa "${a.nome}" ao funil`,
  ),

  // ---------------- Marketing e operação (ADR-0044) ----------------
  t(
    'analisar_campanhas',
    'Desempenho das campanhas de anúncios (Meta) no período: investimento, leads, CPL, CTR, CPC, CPM, ROAS, frequência, comparação com o período anterior e ALERTAS de diagnóstico. Use antes de opinar sobre tráfego pago.',
    z.object({ dias: z.number().int().min(3).max(90).default(7) }),
    'leitura',
    (a) => `analisar as campanhas dos últimos ${a.dias} dias`,
  ),
  t(
    'benchmark_biblioteca_anuncios',
    'Monta o benchmark de concorrentes na Biblioteca de Anúncios da Meta: links de busca prontos (anúncios ativos no Brasil) para cada concorrente/termo e o método de análise (tempo no ar, variações, gancho, oferta, CTA).',
    z.object({ termos: z.array(z.string().min(2).max(80)).min(1).max(8), pais: z.string().length(2).default('BR') }),
    'leitura',
    (a) => `montar benchmark na Biblioteca de Anúncios: ${a.termos.join(', ')}`,
  ),
  t(
    'analisar_prompt_agentes',
    'Avalia o prompt dos Agentes de IA de atendimento (WhatsApp) com uma rubrica 0 a 100 (papel, objetivo, tom, transferência para humano, limites, base de conhecimento, objeções, compliance) e devolve o texto para você sugerir reescrita.',
    z.object({ agentId: z.string().uuid().optional() }),
    'leitura',
    () => 'avaliar o prompt dos agentes de IA',
  ),
  t(
    'diagnosticar_automacoes',
    'Diagnostica as automações: taxa de falha por fluxo, erros mais comuns, execuções travadas, fluxos ativos que nunca disparam e esperas acumuladas. Use quando perguntarem se as automações estão funcionando ou para achar erro.',
    z.object({ workflowId: z.string().uuid().optional() }),
    'leitura',
    () => 'diagnosticar as automações',
  ),
  t(
    'gerar_relatorio',
    'Salva um relatório em Markdown (com títulos, tabelas e emojis) no painel da NICO, com download em .md e PDF. Escreva o relatório COMPLETO no campo conteudoMd, usando só números que vieram de tools.',
    z.object({ titulo: z.string().min(3).max(160), tipo: z.enum(['campanhas', 'benchmark', 'funil', 'automacoes', 'agentes', 'conteudo', 'financeiro', 'livre']).default('livre'), conteudoMd: z.string().min(20).max(60000) }),
    'escrita',
    (a) => `salvar o relatório "${a.titulo}"`,
  ),
  t(
    'agendar_rotina',
    'Cria uma rotina recorrente da NICO (ex.: toda segunda às 8h analisar as campanhas e gerar o relatório). A instrução é o que você fará em cada execução. diaSemana: 0=domingo … 6=sábado.',
    z.object({ titulo: z.string().min(3).max(120), instrucao: z.string().min(5).max(2000), frequencia: z.enum(['diaria', 'semanal', 'mensal']), hora: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('08:00'), diaSemana: z.number().int().min(0).max(6).optional(), diaMes: z.number().int().min(1).max(28).optional() }),
    'escrita',
    (a) => `criar a rotina "${a.titulo}" (${a.frequencia} às ${a.hora})`,
  ),
  t(
    'listar_rotinas',
    'Lista as rotinas agendadas da NICO, com próxima execução e status da última.',
    z.object({}),
    'leitura',
    () => 'listar as rotinas',
  ),
  t(
    'pausar_rotina',
    'Pausa (cancela) uma rotina agendada da NICO.',
    z.object({ id: z.string().uuid() }),
    'escrita',
    () => 'pausar uma rotina',
  ),

  // ---------------- Sensível (pede aprovação humana) ----------------
  t(
    'instalar_automacao',
    'Procura no marketplace um template de automação pela descrição e instala (cria e PUBLICA um fluxo ativo). Pede aprovação humana.',
    z.object({ busca: z.string().min(2).max(120) }),
    'sensivel',
    (a) => `instalar uma automação para: "${a.busca}"`,
  ),
  t(
    'aplicar_blueprint',
    'Configura o CRM INTEIRO a partir de um blueprint de nicho: cria o funil com as etapas certas e instala as automações recomendadas. Use no onboarding depois de descobrir o nicho. Chaves: saude.odontologia, juridico.advocacia, contabil.escritorio.',
    z.object({ blueprint: z.string().min(3).max(60) }),
    'sensivel',
    (a) => `configurar o CRM inteiro com o blueprint "${a.blueprint}"`,
  ),
  t(
    'enviar_mensagem',
    'Envia mensagem no WhatsApp para um contato. SEMPRE pede aprovação do humano antes.',
    z.object({ contactId: z.string().uuid(), texto: z.string().min(1).max(1000) }),
    'sensivel',
    (a) => `enviar WhatsApp: "${a.texto.slice(0, 80)}${a.texto.length > 80 ? '…' : ''}"`,
  ),
  t(
    'mover_etapa',
    'Move um negócio para outra etapa do funil.',
    z.object({ dealId: z.string().uuid(), stageId: z.string().uuid() }),
    'sensivel',
    () => 'mover o negócio de etapa',
  ),
  t(
    'mudar_status_automacao',
    'Ativa ou pausa uma automação. Mexer em automação ativa afeta todo mundo que está nela.',
    z.object({ workflowId: z.string().uuid(), status: z.enum(['ativo', 'pausado']) }),
    'sensivel',
    (a) => `${a.status === 'ativo' ? 'ATIVAR' : 'PAUSAR'} uma automação`,
  ),
];

export const TOOLS_POR_NOME = new Map(TOOLS.map((x) => [x.nome, x]));

/** Formato de tool que a API da Anthropic espera. */
export function paraAnthropic(tools: Tool[]): { name: string; description: string; input_schema: Record<string, unknown> }[] {
  return tools.map((x) => ({
    name: x.nome,
    description: x.descricao,
    input_schema: zodParaJsonSchema(x.schema),
  }));
}

/**
 * Zod → JSON Schema, só para o subconjunto que as tools usam (object de campos
 * planos). Suficiente e sem dependência nova; se uma tool precisar de estrutura
 * aninhada, isto aqui tem que crescer junto — por isso lança em vez de gerar
 * schema silenciosamente errado.
 */
export function zodParaJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = (schema as z.ZodObject<z.ZodRawShape>)._def;
  if (def.typeName !== z.ZodFirstPartyTypeKind.ZodObject) throw new Error('tool precisa ser um z.object');

  const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [chave, campoBruto] of Object.entries(shape)) {
    let campo = campoBruto as z.ZodTypeAny;
    let obrigatorio = true;

    // desembrulha optional/default até achar o tipo base
    for (;;) {
      const tn = (campo as z.ZodTypeAny)._def.typeName;
      if (tn === z.ZodFirstPartyTypeKind.ZodOptional || tn === z.ZodFirstPartyTypeKind.ZodDefault) {
        obrigatorio = false;
        campo = (campo._def as { innerType: z.ZodTypeAny }).innerType;
        continue;
      }
      break;
    }

    properties[chave] = tipoJson(campo);
    if (obrigatorio) required.push(chave);
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) };
}

function tipoJson(campo: z.ZodTypeAny): Record<string, unknown> {
  const tn = campo._def.typeName;
  if (tn === z.ZodFirstPartyTypeKind.ZodString) return { type: 'string' };
  if (tn === z.ZodFirstPartyTypeKind.ZodNumber) return { type: 'number' };
  if (tn === z.ZodFirstPartyTypeKind.ZodBoolean) return { type: 'boolean' };
  if (tn === z.ZodFirstPartyTypeKind.ZodEnum) return { type: 'string', enum: (campo._def as { values: string[] }).values };
  if (tn === z.ZodFirstPartyTypeKind.ZodArray) return { type: 'array', items: tipoJson((campo._def as { type: z.ZodTypeAny }).type) };
  if (tn === z.ZodFirstPartyTypeKind.ZodObject) return zodParaJsonSchema(campo);
  throw new Error(`tipo de campo não suportado nas tools: ${tn}`);
}
