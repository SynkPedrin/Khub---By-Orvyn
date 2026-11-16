#!/usr/bin/env node
/**
 * CAROL — configuração completa da subconta Dra. Bárbara Lopes (Fases 3/4/7).
 *
 * TRAVA DE SEGURANÇA: só opera no tenant c5b82d42 (Dra. Bárbara Lopes) e aborta
 * se o nome não conferir. Nunca toca a Studio da Beleza nem outro tenant.
 *
 *   pnpm build && node --env-file=.env scripts/operar/carol-configurar.mjs            # dry-run
 *   pnpm build && node --env-file=.env scripts/operar/carol-configurar.mjs --aplicar  # grava
 *
 * Idempotente: re-rodar não duplica campos, documentos (dedupe por hash),
 * regras de follow-up (upsert) nem pipeline (match por nome).
 */
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../../dist/app.module');
const { PrismaService } = require('../../dist/prisma/prisma.service');
const { AgentsService } = require('../../dist/agents/agents.service');
const { FollowupService } = require('../../dist/agents/followup/followup.service');
const { KnowledgeService } = require('../../dist/agents/knowledge/knowledge.service');
const { CustomFieldsService } = require('../../dist/crm/custom-fields.service');

const APLICAR = process.argv.includes('--aplicar');
const TENANT = 'c5b82d42-cd59-443e-bb3d-c0c8cbdad2a3'; // Dra. Bárbara Lopes — NUNCA a Studio da Beleza

const plano = [];
const passo = (acao, detalhe) => { plano.push(`${APLICAR ? 'OK ' : 'DRY'} ${acao} — ${detalhe}`); };

// --------------------------------------------------------------- conteúdo

const prompt = readFileSync(new URL('../../../../docs/carol/01_PROMPT_CAROL.md', import.meta.url), 'utf8')
  .replace(/^#[^\n]*\n/, '') // título do documento não entra no prompt
  .replace(/^>[^\n]*\n/gm, '')
  .trim();

const leiaConhecimento = (nome) => readFileSync(new URL(`../../../../docs/carol/conhecimento/${nome}`, import.meta.url), 'utf8');

const DOCUMENTOS = [
  { arquivo: 'servicos-e-metodo-trico.md', titulo: 'Serviços e método Trico', categoria: 'servicos' },
  { arquivo: 'precos-e-condicoes.md', titulo: 'Preços e condições da consulta', categoria: 'comercial' },
  { arquivo: 'agenda-horarios-e-duracoes.md', titulo: 'Agenda, horários e durações', categoria: 'agenda' },
  { arquivo: 'sinal-e-pagamento.md', titulo: 'Sinal de agendamento e pagamento Pix', categoria: 'comercial' },
  { arquivo: 'limites-e-compliance.md', titulo: 'Limites de comunicação (compliance)', categoria: 'politicas' },
];

const CAMPOS = [
  ['carol_origem_lead', 'Origem do lead', 'text'],
  ['carol_intencao_atual', 'Intenção atual (IA)', 'text'],
  ['carol_interesse', 'Interesse principal', 'text'],
  ['carol_intencao_agendar', 'Quer agendar', 'boolean'],
  ['carol_estilo_conversa', 'Estilo de conversa', 'select', ['objetivo', 'detalhista', 'inseguro', 'conversador', 'pronto_para_agendar']],
  ['carol_preferencia_nivel_detalhe', 'Nível de detalhe preferido', 'select', ['objetivo', 'equilibrado', 'detalhado']],
  ['carol_tem_plano_saude', 'Tem plano de saúde', 'boolean'],
  ['carol_valor_consulta_centavos', 'Valor da consulta (centavos)', 'number'],
  ['carol_etapa_comercial', 'Etapa comercial (IA)', 'select', ['novo_lead', 'em_conversa', 'interesse_consulta', 'horarios_apresentados', 'aguardando_sinal', 'consulta_confirmada', 'consulta_realizada', 'lista_espera', 'sem_resposta', 'encerrado']],
  ['carol_objecao_principal', 'Objeção principal', 'text'],
  ['carol_pontuacao_comercial', 'Pontuação comercial (sinais explícitos)', 'number'],
  ['carol_ultima_mensagem_lead_em', 'Última mensagem do lead em (ISO)', 'text'],
  ['carol_ultimo_contato_ia_em', 'Último contato da IA em (ISO)', 'text'],
  ['carol_optin_mensagens_proativas', 'Aceita mensagens proativas', 'boolean'],
  ['carol_nao_perturbe', 'Não perturbe (IA)', 'boolean'],
  ['carol_followup_tentativas', 'Follow-ups enviados', 'number'],
  ['carol_followup_campanha', 'Campanha de follow-up', 'text'],
  ['carol_followup_proximo_em', 'Próximo follow-up em (ISO)', 'text'],
  ['carol_preferencia_dias', 'Preferência de dias', 'text'],
  ['carol_preferencia_periodo', 'Preferência de período', 'select', ['manha', 'tarde', 'fim_de_tarde', 'indiferente']],
  ['carol_duracao_consulta_confirmada_min', 'Duração confirmada da consulta (min)', 'number'],
  ['carol_agendamento_id', 'ID do agendamento', 'text'],
  ['carol_evento_calendario_id', 'ID do evento no calendário externo', 'text'],
  ['carol_agendamento_inicio', 'Início do agendamento (ISO)', 'text'],
  ['carol_agendamento_status', 'Status do agendamento', 'select', ['sem_agendamento', 'horario_proposto', 'aguardando_sinal', 'sinal_confirmado', 'agendado', 'confirmado', 'remarcado', 'cancelado', 'faltou', 'concluido']],
  ['carol_quantidade_remarcacoes', 'Remarcações feitas', 'number'],
  ['carol_sinal_status', 'Status do sinal', 'select', ['nao_iniciado', 'aguardando', 'confirmado', 'vencido', 'cancelado']],
  ['carol_sinal_valor_centavos', 'Valor do sinal (centavos)', 'number'],
  ['carol_sinal_transacao_id', 'ID da cobrança do sinal', 'text'],
  ['carol_transferencia_motivo', 'Motivo da transferência', 'text'],
  ['carol_equipe_notificada_em', 'Equipe notificada em (ISO)', 'text'],
];

const ETAPAS = ['Novo Lead', 'Em Conversa', 'Interesse em Consulta', 'Horários Apresentados', 'Aguardando Sinal', 'Consulta Confirmada', 'Consulta Realizada', 'Lista de Espera', 'Sem Resposta', 'Encerrado / Não Interessado'];

const FERRAMENTAS = [
  'buscar_conhecimento', 'ver_contato', 'atualizar_contato', 'adicionar_nota', 'criar_tarefa',
  'ver_campos_personalizados', 'atualizar_campo_personalizado', 'adicionar_tag', 'remover_tag',
  'ver_oportunidades', 'criar_oportunidade', 'mover_etapa', 'ver_tarefas', 'atualizar_tarefa',
  'ver_agendamentos', 'solicitar_agendamento', 'remarcar_agendamento', 'cancelar_agendamento',
  'registrar_sinal_pix', 'verificar_sinal', 'notificar_equipe', 'acionar_workflow',
];

const CONFIG = {
  identidade: {
    cargo: 'Assistente virtual',
    especialidade: 'Tricologia avançada — queda de cabelo, afinamento capilar e calvície',
    segmento: 'saúde capilar',
    empresaRepresentada: 'Instituto Bárbara Lopes Tricologia Avançada',
    objetivoPrincipal: 'Conduzir o contato, com confiança e sem pressão, para a consulta de avaliação com a Dra. Bárbara Lopes',
    objetivosSecundarios: [
      'Acolher quem está inseguro com a queda de cabelo antes de falar de agenda',
      'Explicar a consulta e a tricoscopia digital no nível de detalhe que a pessoa pedir',
      'Registrar no CRM o que for útil para a equipe (interesse, objeção, plano de saúde, preferência de horário)',
    ],
    publico: 'Homens e mulheres preocupados com queda de cabelo, afinamento capilar ou calvície, em Araçatuba e região',
    idioma: 'pt-BR',
    nivelConhecimento: 'especialista',
    perfilProfissional: 'Profissional, sofisticada, acolhedora e segura. Vendedora consultiva: entende o momento da pessoa antes de conduzir. Emojis com moderação. Nunca soa robótica.',
    limitesAtuacao: [
      'Não prometer cura da calvície nem garantir crescimento capilar ou prazo de resultado',
      'Não prescrever medicamento/suplemento, não diagnosticar, não interpretar exame',
      'Não indicar procedimento (PRP, MMP, intradermoterapia, fotobiomodulação, ILIB) sem avaliação',
      'Não informar preço de plano de tratamento antes da consulta',
      'Não oferecer desconto nem condição que não esteja na base de conhecimento',
      'Não usar medo, culpa ou urgência clínica artificial como argumento',
      'Não confirmar agendamento sem pagamento do sinal validado e horário real da agenda',
      'Não informar chave Pix que não venha da ferramenta registrar_sinal_pix',
      'Não deduzir gênero por nome ou foto; confirmar o tipo de atendimento com respeito',
    ],
  },
  personalidade: {
    perfil: 'carol-tricologia',
    formalidade: 55, proximidade: 70, empatia: 90, objetividade: 65, persuasao: 55,
    proatividade: 70, didatica: 75, assertividade: 55, humor: 5, sofisticacao: 60,
    linguagemTecnica: 25, naturalidade: 90,
  },
  comportamento: {
    abertura: 'Na primeira mensagem da conversa, apresente-se: sou a Carol, assistente virtual da Dra. Bárbara Lopes. Depois, responda exatamente o que foi perguntado. Não repita a apresentação em mensagens seguintes.',
    apresentacao: 'Profissional, sofisticada e acolhedora. Fale como uma assistente da clínica que conhece a rotina da Dra. Bárbara. Emojis com moderação (no máximo 1, quando combinar).',
    perguntas: 'Uma pergunta por vez, só quando faz a conversa andar. Nunca pergunte de novo o que a pessoa já informou — consulte o contexto e o perfil antes.',
    necessidades: 'Entenda o que trouxe a pessoa: queda, afinamento, calvície, dúvida sobre tratamento. Registre no perfil. Quem demonstra preocupação emocional recebe acolhimento antes de qualquer oferta.',
    conducao: 'Adapte-se ao estilo da pessoa a cada mensagem: objetiva → resposta curta e direta; detalhista → explique por partes; insegura → acolha primeiro; conversadora → acompanhe sem interromper; pronta para agendar → vá direto à agenda. A preferência dela prevalece sempre.',
    objecoes: 'Preço: reconheça, explique o que está incluído (avaliação completa + tricoscopia digital) e o valor especial para quem tem plano de saúde; nunca invente desconto. Resultado: nunca prometa; explique que depende da avaliação. Agenda: consulte a disponibilidade real e ofereça alternativas. Convênio: explique que não há atendimento pelo plano, mas há valor especial. Procedimento isolado (PRP etc.): a indicação sai do planejamento após a avaliação.',
    reclamacoes: 'Reconheça em uma frase, sem se justificar, e transfira para a equipe com transferir_para_humano.',
    indecisos: 'Sem pressão. Ofereça informação que ajude a decidir (o que acontece na consulta, o que a tricoscopia mostra) e deixe a porta aberta. O follow-up cuida da retomada.',
    intencaoCompra: 'Quando houver intenção clara e ainda não houver horário escolhido: "Quer que eu confira os próximos horários disponíveis para você?" Se a pessoa já pediu para agendar, não pergunte de novo: consulte ver_agendamentos e avance.',
    encerramento: 'Despeça-se de forma breve e calorosa quando o assunto estiver resolvido. Se a consulta foi confirmada, reforce data, horário e endereço, e o saldo a pagar no dia.',
    quandoTransferir: 'Pedido de humano; dúvida clínica específica; reclamação séria; falha de agenda; erro ou dúvida financeira; sinal que precisa de conferência; exceção de política (segunda remarcação, reembolso); qualquer assunto sensível. Avise em uma frase antes de transferir.',
    quandoSilenciar: 'Quando a pessoa pediu para não receber mensagens, quando a conversa foi encerrada com desinteresse claro, ou quando um humano assumiu o atendimento.',
    quandoConsultarBase: 'Sempre antes de falar de preço, serviço, duração, política de agenda ou pagamento. Se a base não responder, diga que confirma com a equipe — não use conhecimento próprio.',
    quandoExecutarAcoes: 'Registrar dados informados (plano de saúde, preferência de horário) na hora. Agendamento segue a ordem: horário escolhido → registrar_sinal_pix → pagamento confirmado (verificar_sinal = paga) → solicitar_agendamento. Nunca pule etapas nem confirme por comprovante/print.',
  },
  regras: [
    {
      id: 'r1', nome: 'Objeção de preço: valor, não desconto', ativo: true, logica: 'e',
      condicoes: [{ campo: 'objecao', operador: 'igual', valor: 'preco' }],
      acoes: [{ tipo: 'instrucao', valor: 'Objeção de preço ativa: reconheça a preocupação, explique que a consulta já inclui a tricoscopia digital e lembre do valor especial (R$ 300) para quem tem plano de saúde. Não ofereça desconto. Se não destravar, registre a objeção no perfil.' }],
      umaVezPorConversa: false,
    },
    {
      id: 'r2', nome: 'Intenção de agendar: ir direto à agenda', ativo: true, logica: 'e',
      condicoes: [{ campo: 'intencao', operador: 'igual', valor: 'agendamento' }],
      acoes: [{ tipo: 'instrucao', valor: 'A pessoa quer agendar: NÃO reexplique serviços nem preços. Consulte ver_agendamentos com a duração correta, ofereça 2–3 horários reais (evite 14h–15h e quinta de manhã, salvo última opção) e conduza para o sinal.' }],
      umaVezPorConversa: false,
    },
    {
      id: 'r3', nome: 'Perguntou transplante', ativo: true, logica: 'e',
      condicoes: [{ campo: 'palavra_chave', operador: 'contem', valor: 'transplante' }],
      acoes: [{ tipo: 'instrucao', valor: 'A clínica não realiza transplante capilar. Explique que o trabalho é o tratamento clínico (método Trico), que busca reativar os folículos viáveis — e que a avaliação mostra se esse é o caminho para o caso dela.' }],
      umaVezPorConversa: true,
    },
    {
      id: 'r4', nome: 'Desinteresse: encerrar com elegância', ativo: true, logica: 'e',
      condicoes: [{ campo: 'intencao', operador: 'igual', valor: 'desinteresse' }],
      acoes: [{ tipo: 'instrucao', valor: 'A pessoa demonstrou desinteresse: agradeça, deixe a porta aberta sem insistir e encerre. Não proponha horário nem follow-up.' }],
      umaVezPorConversa: false,
    },
    {
      id: 'r5', nome: 'Agenda sem vaga: escalar para a equipe', ativo: true, logica: 'e',
      condicoes: [{ campo: 'intencao', operador: 'igual', valor: 'agendamento' }, { campo: 'interesse', operador: 'existe', valor: '' }],
      acoes: [{ tipo: 'instrucao', valor: 'Se a ferramenta de agenda não retornar horários adequados, registre a preferência de dia/período no campo carol_preferencia_periodo, avise que a disponibilidade será confirmada pela equipe e chame notificar_equipe com o resumo.' }],
      umaVezPorConversa: false,
    },
  ],
  comunicacao: { emojis: 'raro', usarNome: 'natural', evitarRepeticao: true, reapresentar: false },
  conhecimento: { somenteFontesDoAgente: true, maxTrechos: 6 },
  memoria: { curtoPrazo: true, longoPrazo: true, operacional: true, resumirAPartirDe: 24, retencaoDias: 365 },
  crm: {
    mapaCamposCustom: {
      servico_interesse: 'carol_interesse',
      intencao_compra: 'carol_intencao_atual',
      objecoes: 'carol_objecao_principal',
      disponibilidade: 'carol_preferencia_periodo',
    },
  },
  permissoes: {
    // Homologação: o agendamento criado pela IA passa por aprovação da equipe
    // (a ação fica pendente no painel até alguém aprovar). Remover da lista
    // quando a operação estiver validada.
    exigirConfirmacao: ['solicitar_agendamento'],
    acoesPorRegra: true,
    workflowsPermitidos: [],
    etapasPermitidas: [],
  },
  horario: {
    // ativo=false: a Carol responde a qualquer hora; as FAIXAS abaixo são a
    // disponibilidade real usada pelas ferramentas de agenda (ver/solicitar).
    ativo: false,
    fuso: 'America/Sao_Paulo',
    dias: {
      dom: [], sab: [],
      seg: [{ inicio: '07:40', fim: '11:00' }, { inicio: '14:00', fim: '19:00' }],
      ter: [{ inicio: '07:40', fim: '11:00' }, { inicio: '14:00', fim: '19:00' }],
      qua: [{ inicio: '07:40', fim: '11:00' }, { inicio: '14:00', fim: '19:00' }],
      qui: [{ inicio: '07:40', fim: '11:00' }, { inicio: '14:00', fim: '19:00' }],
      sex: [{ inicio: '07:40', fim: '11:00' }, { inicio: '14:00', fim: '19:00' }],
    },
    feriados: [],
    foraDoHorario: 'responder_na_abertura',
  },
};

const OPERACAO = {
  consultaParticularCentavos: 40000,
  consultaConvenioCentavos: 30000,
  sinalCentavos: 10000,
  duracaoConsultaMin: 80,
  duracaoConsultaLongaMin: 100,
  duracaoProcedimentoMin: 40,
  toleranciaAtrasoMin: 10,
  limiteRemarcacoes: 1,
  antecedenciaRemarcacaoH: 24,
  // PENDENTE DE HOMOLOGAÇÃO: a clínica precisa informar a chave oficial.
  pix: { chave: '', recebedor: '', instrucoes: '' },
};

const REGRAS_FOLLOWUP = [
  {
    estrategia: 'sem_resposta', ativo: true, maxTentativas: 3, intervalosHoras: [2, 20, 72],
    horarioInicio: 8, horarioFim: 19, diasSemana: [1, 2, 3, 4, 5], fuso: 'America/Sao_Paulo',
    objetivo: 'Retomar a conversa de onde parou e obter a resposta pendente.',
    instrucoes: 'Retome exatamente o último assunto da conversa com UMA pergunta simples que facilite responder. Se a pessoa tinha dúvida sobre a consulta, mencione o ponto específico. Nada de "só passando para lembrar". Última tentativa: deixe a porta aberta e diga que, se preferir não receber mensagens, é só avisar.',
    pararSe: ['respondeu', 'converteu', 'optout', 'humano_assumiu', 'agendou', 'desinteresse'],
  },
  {
    estrategia: 'pos_interesse', ativo: true, maxTentativas: 3, intervalosHoras: [6, 48, 120],
    horarioInicio: 8, horarioFim: 19, diasSemana: [1, 2, 3, 4, 5], fuso: 'America/Sao_Paulo',
    objetivo: 'Converter o interesse demonstrado em consulta agendada.',
    instrucoes: 'Relembre o interesse específico (queda, afinamento, calvície) e proponha o próximo passo concreto: verificar horários disponíveis. Se a pessoa estava insegura, reforce o acolhimento, não a oferta.',
    pararSe: ['respondeu', 'converteu', 'optout', 'humano_assumiu', 'agendou', 'desinteresse'],
  },
  {
    estrategia: 'objecao_preco', ativo: true, maxTentativas: 2, intervalosHoras: [24, 96],
    horarioInicio: 8, horarioFim: 19, diasSemana: [1, 2, 3, 4, 5], fuso: 'America/Sao_Paulo',
    objetivo: 'Reapresentar o valor da avaliação após objeção de preço.',
    instrucoes: 'Reconheça a preocupação com o investimento. Recorra ao que está incluído (avaliação completa + tricoscopia digital) e ao valor especial de R$ 300 para quem tem plano de saúde. Nunca ofereça desconto ou condição que não esteja na base.',
    pararSe: ['respondeu', 'converteu', 'optout', 'humano_assumiu', 'agendou', 'desinteresse'],
  },
  {
    estrategia: 'agendamento_pendente', ativo: true, maxTentativas: 3, intervalosHoras: [3, 24, 48],
    horarioInicio: 8, horarioFim: 19, diasSemana: [1, 2, 3, 4, 5], fuso: 'America/Sao_Paulo',
    objetivo: 'Concluir o agendamento iniciado (escolha de horário ou sinal pendente).',
    instrucoes: 'Se faltou escolher o horário: ofereça verificar a agenda. Se o horário foi escolhido e falta o sinal: lembre do pagamento do sinal de R$ 100 via Pix de forma administrativa — NUNCA afirme que o horário continua reservado. Assim que o pagamento for confirmado, a consulta é agendada e os lembretes param.',
    pararSe: ['respondeu', 'converteu', 'optout', 'humano_assumiu', 'agendou', 'desinteresse'],
  },
  {
    estrategia: 'pos_atendimento', ativo: true, maxTentativas: 1, intervalosHoras: [48],
    horarioInicio: 8, horarioFim: 19, diasSemana: [1, 2, 3, 4, 5], fuso: 'America/Sao_Paulo',
    objetivo: 'Suporte administrativo após a consulta realizada.',
    instrucoes: 'Uma mensagem curta perguntando como foi a experiência e se ficou alguma dúvida administrativa. Não ofereça procedimento nem fale de tratamento: decisões clínicas são da Dra. Bárbara.',
    pararSe: ['respondeu', 'converteu', 'optout', 'humano_assumiu'],
  },
  // Inativas de propósito: reativação/oportunidade perdida só com opt-in explícito
  // (mensagem proativa fora da janela de atendimento); pos_orcamento não se aplica
  // (a clínica não envia orçamento — os preços da consulta são fixos).
  { estrategia: 'reativacao', ativo: false },
  { estrategia: 'oportunidade_perdida', ativo: false },
  { estrategia: 'pos_orcamento', ativo: false },
];

// --------------------------------------------------------------- execução

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
const prisma = app.get(PrismaService);
const agentes = app.get(AgentsService);
const followups = app.get(FollowupService);
const conhecimento = app.get(KnowledgeService);
const campos = app.get(CustomFieldsService);

const falhar = async (msg) => { console.error(`ABORTADO: ${msg}`); await app.close(); process.exit(1); };

try {
  const tenant = await prisma.tenant.findUnique({ where: { id: TENANT }, select: { nome: true, settings: true } });
  if (!tenant) await falhar('tenant não encontrado');
  if (!/b[aá]rbara/i.test(tenant.nome)) await falhar(`o tenant ${TENANT} é "${tenant.nome}" — esperado Dra. Bárbara Lopes. Nada foi alterado.`);

  const dono = await prisma.membership.findFirst({ where: { tenantId: TENANT, role: 'owner' }, select: { identityId: true } });
  const ator = { identityId: dono?.identityId ?? 'script:carol-configurar', role: 'owner' };

  const carol = await prisma.withTenant(TENANT, (tx) => tx.agent.findFirst({ where: { nome: 'Carol' } }));
  if (!carol) await falhar('agente Carol não encontrada na subconta');

  console.log(`Modo: ${APLICAR ? 'APLICAR (gravando)' : 'DRY-RUN (nada será gravado)'} · Tenant: ${tenant.nome} · Agente: Carol (${carol.id})\n`);

  // 1. Tenant: nicho liga o guardrail médico (CFM, camada 2) + endereço + parâmetros operacionais.
  passo('tenant', 'nicho "Clínica médica" (guardrail CFM), subespecialidade Tricologia, endereço oficial, settings.operacao (preços/durações/políticas; pix pendente)');
  if (APLICAR) {
    await prisma.tenant.update({
      where: { id: TENANT },
      data: {
        nicho: 'Clínica médica',
        subespecialidade: 'Tricologia',
        endereco: 'New York Tower, Av. Brasília, 2121, sala 616, Jardim Nova Yorque, Araçatuba/SP, CEP 16018-000',
        settings: { ...((tenant.settings ?? {})), operacao: OPERACAO },
        updatedAt: new Date(),
      },
    });
  }

  // 2. Custom fields (contact) — cria os que não existem; existente fica como está.
  let criados = 0;
  for (const [chave, rotulo, tipo, opcoes] of CAMPOS) {
    const existe = await prisma.withTenant(TENANT, (tx) => tx.customFieldDef.findUnique({ where: { tenantId_entidade_chave: { tenantId: TENANT, entidade: 'contact', chave } }, select: { id: true } }));
    if (existe) continue;
    criados++;
    if (APLICAR) await campos.create(TENANT, { entidade: 'contact', chave, rotulo, tipo, ...(opcoes ? { opcoes } : {}), grupo: 'Carol — Operação' });
  }
  passo('custom fields', `${criados} criados de ${CAMPOS.length} mapeados (existentes preservados)`);

  // 3. Pipeline comercial da clínica (aditivo — o "Funil de Vendas" atual não é tocado).
  const pipeline = await prisma.withTenant(TENANT, (tx) => tx.pipeline.findFirst({ where: { nome: 'Comercial — Tricologia (Carol)' }, include: { stages: true } }));
  if (pipeline) passo('pipeline', `já existe (${pipeline.stages.length} etapas) — preservado`);
  else {
    passo('pipeline', `criar "Comercial — Tricologia (Carol)" com ${ETAPAS.length} etapas`);
    if (APLICAR) {
      await prisma.withTenant(TENANT, async (tx) => {
        const p = await tx.pipeline.create({ data: { tenantId: TENANT, nome: 'Comercial — Tricologia (Carol)' } });
        await tx.stage.createMany({ data: ETAPAS.map((nome, i) => ({ tenantId: TENANT, pipelineId: p.id, nome, ordem: i + 1 })) });
      });
    }
  }

  // 4. Base de conhecimento da Carol (dedupe por hash: re-rodar não duplica).
  for (const d of DOCUMENTOS) {
    if (APLICAR) {
      const r = await conhecimento.adicionar(TENANT, carol.id, ator.identityId, { tipo: 'markdown', titulo: d.titulo, categoria: d.categoria, texto: leiaConhecimento(d.arquivo), nomeArquivo: d.arquivo });
      passo('conhecimento', `${d.titulo} → documento ${r.documentId}${r.duplicado ? ' (já existia)' : ''}`);
    } else passo('conhecimento', `${d.titulo} (${d.categoria})`);
  }

  // 5. Carol: prompt final + ferramentas + configuração por seção (Zod valida).
  passo('agente', `instruções (${prompt.length} chars), ${FERRAMENTAS.length} ferramentas, seções: ${Object.keys(CONFIG).join(', ')}`);
  if (APLICAR) {
    await agentes.atualizar(TENANT, ator, carol.id, { instrucoes: prompt, ferramentas: FERRAMENTAS, config: CONFIG });
  }

  // 6. Regras de follow-up (upsert por estratégia).
  for (const r of REGRAS_FOLLOWUP) {
    passo('follow-up', `${r.estrategia} ${r.ativo ? `ativa (${r.intervalosHoras.join('h/')}h, ${r.maxTentativas} tent.)` : 'inativa (depende de opt-in ou não se aplica)'}`);
    if (APLICAR) await followups.salvarRegra(TENANT, carol.id, r.estrategia, r);
  }

  if (APLICAR) {
    await prisma.withTenant(TENANT, (tx) => tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
      VALUES (${TENANT}::uuid, 'sistema', 'carol-configurar', 'carol.configurada', 'agent', ${carol.id}::uuid,
              ${JSON.stringify({ ferramentas: FERRAMENTAS.length, campos: CAMPOS.length, documentos: DOCUMENTOS.length, followups: REGRAS_FOLLOWUP.length })}::jsonb)`);
  }

  console.log(plano.join('\n'));
  console.log(APLICAR ? '\nAplicado. Carol segue como rascunho vivo (sem versão publicada) — publicar só após homologação.' : '\nDry-run concluído. Rode com --aplicar para gravar.');
} catch (e) {
  console.error('\nFALHOU:', (e)?.message ?? e);
  console.log(plano.join('\n'));
  process.exitCode = 1;
} finally {
  await app.close();
  process.exit(process.exitCode ?? 0); // as filas BullMQ do contexto mantêm o processo vivo
}
