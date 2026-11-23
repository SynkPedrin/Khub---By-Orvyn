import { BadRequestException } from '@nestjs/common';
import { z, type ZodError } from 'zod';

/**
 * Catálogo do Onboarding KROMA (db/078): seções de conhecimento, serviços de
 * escopo, checklist de homologação, templates de tarefas por papel, pauta de
 * imersão e cenários de teste do agente de IA. Puro e testável — sem Prisma,
 * sem Nest, sem IO (mesmo padrão de agency/daily/daily.catalogo.ts).
 */

// ───────────────────────────── escopo ─────────────────────────────

export const SERVICOS_ESCOPO = [
  { chave: 'trafego', rotulo: 'Tráfego pago' },
  { chave: 'social', rotulo: 'Social media' },
  { chave: 'audiovisual', rotulo: 'Audiovisual' },
  { chave: 'agente_ia', rotulo: 'Agente de IA' },
  { chave: 'branding', rotulo: 'Branding' },
] as const;

export type ServicoEscopo = (typeof SERVICOS_ESCOPO)[number]['chave'];

/** Escopo normalizado: só chaves conhecidas, sempre booleano. */
export type Escopo = Record<ServicoEscopo, boolean>;

export const ESCOPO_VAZIO: Escopo = { trafego: false, social: false, audiovisual: false, agente_ia: false, branding: false };

/** Lê o jsonb vindo do banco/cliente e devolve um Escopo completo e seguro. */
export function normalizarEscopo(bruto: unknown): Escopo {
  const obj = bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? (bruto as Record<string, unknown>) : {};
  const out = { ...ESCOPO_VAZIO };
  for (const s of SERVICOS_ESCOPO) out[s.chave] = obj[s.chave] === true;
  return out;
}

/**
 * `escopoKey` de um item (verificação/tarefa): null = sempre se aplica; uma
 * chave ou lista de chaves = aplica se QUALQUER serviço estiver no escopo.
 */
export type EscopoKey = ServicoEscopo | readonly ServicoEscopo[] | null;

export function aplicavelAoEscopo(escopoKey: EscopoKey, escopo: Escopo): boolean {
  if (escopoKey === null) return true;
  const chaves: readonly ServicoEscopo[] = Array.isArray(escopoKey) ? escopoKey : [escopoKey as ServicoEscopo];
  return chaves.some((k) => escopo[k] === true);
}

/** Forma gravada na coluna `escopo_key` (text): 'social|branding' para lista. */
export function escopoKeyParaTexto(escopoKey: EscopoKey): string | null {
  if (escopoKey === null) return null;
  return Array.isArray(escopoKey) ? (escopoKey as readonly ServicoEscopo[]).join('|') : (escopoKey as ServicoEscopo);
}

/** Inverso: lê a coluna `escopo_key` do banco. */
export function escopoKeyDoTexto(texto: string | null): string[] | null {
  if (!texto) return null;
  return texto.split('|').filter(Boolean);
}

// ───────────────────────────── conhecimento ─────────────────────────────

export const SECOES_CONHECIMENTO = [
  {
    chave: 'institucional',
    rotulo: 'Institucional',
    camposObrigatorios: ['nome_empresa', 'historia', 'contatos_principais'],
  },
  {
    chave: 'operacao',
    rotulo: 'Operação',
    camposObrigatorios: ['horarios', 'capacidade', 'processo_atendimento'],
  },
  {
    chave: 'produtos',
    rotulo: 'Produtos e serviços',
    camposObrigatorios: ['lista_produtos', 'precos', 'prioridades'],
  },
  {
    chave: 'comercial',
    rotulo: 'Comercial',
    camposObrigatorios: ['processo_comercial', 'objecoes_comuns', 'canais'],
  },
  {
    chave: 'marketing',
    rotulo: 'Marketing',
    camposObrigatorios: ['publico_alvo', 'diferenciais', 'concorrentes', 'campanhas_anteriores'],
  },
  {
    chave: 'identidade',
    rotulo: 'Identidade da marca',
    camposObrigatorios: ['logotipo', 'cores_tipografia', 'tom_de_voz'],
  },
  {
    chave: 'preferencias',
    rotulo: 'Preferências e expectativas',
    camposObrigatorios: ['o_que_evitar', 'expectativas', 'contatos_decisores'],
  },
] as const;

export type SecaoConhecimento = (typeof SECOES_CONHECIMENTO)[number]['chave'];
export const CHAVES_SECOES = SECOES_CONHECIMENTO.map((s) => s.chave) as SecaoConhecimento[];

// ───────────────────────────── homologação ─────────────────────────────

export const STATUS_VERIFICACAO = ['pendente', 'em_andamento', 'concluido', 'em_verificacao', 'verificado', 'bloqueado', 'aguardando_aprovacao'] as const;
export type StatusVerificacao = (typeof STATUS_VERIFICACAO)[number];

export interface VerificacaoTemplate {
  chave: string;
  rotulo: string;
  /** Agrupamento exibido no painel de conferência. */
  secao: string;
  obrigatorio: boolean;
  escopoKey: EscopoKey;
}

/** Checklist de homologação. `aprovacao_final` é concedida pela própria ação de finalizar. */
export const VERIFICACOES_TEMPLATE: readonly VerificacaoTemplate[] = [
  { chave: 'info_essenciais', rotulo: 'Informações essenciais coletadas', secao: 'coleta', obrigatorio: true, escopoKey: null },
  { chave: 'reuniao_imersao', rotulo: 'Reunião de imersão realizada ou dispensada', secao: 'imersao', obrigatorio: true, escopoKey: null },
  { chave: 'escopo_confirmado', rotulo: 'Escopo contratado confirmado', secao: 'coleta', obrigatorio: true, escopoKey: null },
  { chave: 'acessos_validados', rotulo: 'Acessos validados (contas de anúncio, redes, site)', secao: 'acessos', obrigatorio: true, escopoKey: null },
  { chave: 'verba_confirmada', rotulo: 'Verba de mídia confirmada', secao: 'trafego', obrigatorio: true, escopoKey: 'trafego' },
  { chave: 'estrategia_revisada', rotulo: 'Estratégia revisada pela equipe', secao: 'estrategia', obrigatorio: true, escopoKey: null },
  { chave: 'genna_analise', rotulo: 'Análise Genna realizada ou exceção aprovada', secao: 'analise', obrigatorio: true, escopoKey: null },
  { chave: 'identidade_organizada', rotulo: 'Identidade visual organizada', secao: 'identidade', obrigatorio: true, escopoKey: ['social', 'branding'] },
  { chave: 'midias_anexadas', rotulo: 'Mídias anexadas na área do cliente', secao: 'conteudo', obrigatorio: true, escopoKey: ['social', 'audiovisual'] },
  { chave: 'audiovisual_planejado', rotulo: 'Roteiros e captações planejados', secao: 'audiovisual', obrigatorio: true, escopoKey: 'audiovisual' },
  { chave: 'agente_ia_testado', rotulo: 'Agente de IA testado nos cenários', secao: 'agente_ia', obrigatorio: true, escopoKey: 'agente_ia' },
  { chave: 'tarefas_atribuidas', rotulo: 'Tarefas geradas e atribuídas', secao: 'tarefas', obrigatorio: true, escopoKey: null },
  { chave: 'responsaveis_cientes', rotulo: 'Responsáveis cientes das atribuições', secao: 'equipe', obrigatorio: true, escopoKey: null },
  { chave: 'pendencias_resolvidas', rotulo: 'Pendências críticas resolvidas', secao: 'qualidade', obrigatorio: true, escopoKey: null },
  { chave: 'revisao_qualidade', rotulo: 'Revisão de qualidade concluída', secao: 'qualidade', obrigatorio: true, escopoKey: null },
  { chave: 'aprovacao_final', rotulo: 'Aprovação humana final', secao: 'aprovacao', obrigatorio: true, escopoKey: null },
] as const;

export const CHAVE_APROVACAO_FINAL = 'aprovacao_final';
export const CHAVE_GENNA_ANALISE = 'genna_analise';
export const CHAVE_AGENTE_TESTADO = 'agente_ia_testado';

/** Verificações que se aplicam a um escopo (para semear e para revalidar no finalizar). */
export function verificacoesParaEscopo(escopo: Escopo): VerificacaoTemplate[] {
  return VERIFICACOES_TEMPLATE.filter((v) => aplicavelAoEscopo(v.escopoKey, escopo));
}

// ───────────────────────────── tarefas ─────────────────────────────

export const PAPEIS_TAREFA = ['marcos', 'sofia', 'matheus', 'interno'] as const;
export type PapelTarefa = (typeof PAPEIS_TAREFA)[number];

/** Tipos válidos em agency_tasks (CHECK de db/074). */
export type TipoTarefa = 'post' | 'carrossel' | 'reel' | 'criativo' | 'copy' | 'trafego' | 'landing_page' | 'branding' | 'reuniao' | 'administrativo' | 'outro';

export interface TarefaTemplate {
  papel: PapelTarefa;
  titulo: string;
  tipo: TipoTarefa;
  escopoKey: EscopoKey;
  criterioAceite: string;
  secao: string;
}

export const TAREFAS_TEMPLATE: readonly TarefaTemplate[] = [
  // Marcos — gestor de tráfego.
  { papel: 'marcos', titulo: 'Agendar reunião de imersão com o cliente', tipo: 'reuniao', escopoKey: null, criterioAceite: 'Reunião agendada com data confirmada pelo cliente', secao: 'imersao' },
  { papel: 'marcos', titulo: 'Solicitar acessos (Business Manager, contas de anúncio, redes, site)', tipo: 'administrativo', escopoKey: null, criterioAceite: 'Lista de acessos enviada ao cliente', secao: 'acessos' },
  { papel: 'marcos', titulo: 'Conferir acessos concedidos e validar permissões', tipo: 'administrativo', escopoKey: null, criterioAceite: 'Cada acesso testado e permissão confirmada', secao: 'acessos' },
  { papel: 'marcos', titulo: 'Confirmar verba de mídia com o cliente', tipo: 'trafego', escopoKey: 'trafego', criterioAceite: 'Valor mensal e forma de pagamento registrados no conhecimento', secao: 'trafego' },
  { papel: 'marcos', titulo: 'Confirmar condições de mídia (conta, faturamento, pixels)', tipo: 'trafego', escopoKey: 'trafego', criterioAceite: 'Conta de anúncios ativa, faturamento ok e pixel instalado', secao: 'trafego' },
  { papel: 'marcos', titulo: 'Analisar estratégia de aquisição atual', tipo: 'trafego', escopoKey: 'trafego', criterioAceite: 'Diagnóstico escrito da estratégia atual do cliente', secao: 'estrategia' },
  { papel: 'marcos', titulo: 'Analisar campanhas anteriores e resultados', tipo: 'trafego', escopoKey: 'trafego', criterioAceite: 'Aprendizados das campanhas anteriores registrados', secao: 'estrategia' },
  { papel: 'marcos', titulo: 'Definir estrutura de campanhas', tipo: 'trafego', escopoKey: 'trafego', criterioAceite: 'Estrutura (campanhas, conjuntos, públicos) documentada', secao: 'trafego' },
  { papel: 'marcos', titulo: 'Revisar criativos das campanhas', tipo: 'criativo', escopoKey: null, criterioAceite: 'Criativos revisados contra a identidade e a estratégia', secao: 'conteudo' },
  { papel: 'marcos', titulo: 'Validar campanhas antes de publicar', tipo: 'trafego', escopoKey: 'trafego', criterioAceite: 'Checklist de publicação conferido item a item', secao: 'trafego' },
  { papel: 'marcos', titulo: 'Montar plano de lançamento', tipo: 'administrativo', escopoKey: null, criterioAceite: 'Plano com datas, responsáveis e entregáveis definidos', secao: 'estrategia' },
  { papel: 'marcos', titulo: 'Acompanhar primeiros resultados', tipo: 'administrativo', escopoKey: null, criterioAceite: 'Primeiros indicadores registrados e lidos com a equipe', secao: 'qualidade' },
  // Sofia — social media e branding.
  { papel: 'sofia', titulo: 'Solicitar identidade visual ao cliente', tipo: 'branding', escopoKey: ['social', 'branding'], criterioAceite: 'Pedido enviado com a lista de materiais necessários', secao: 'identidade' },
  { papel: 'sofia', titulo: 'Coletar manual da marca', tipo: 'branding', escopoKey: ['social', 'branding'], criterioAceite: 'Manual recebido e arquivado', secao: 'identidade' },
  { papel: 'sofia', titulo: 'Coletar logotipo em todos os formatos', tipo: 'branding', escopoKey: ['social', 'branding'], criterioAceite: 'Arquivos do logotipo organizados', secao: 'identidade' },
  { papel: 'sofia', titulo: 'Coletar cores e tipografia oficiais', tipo: 'branding', escopoKey: ['social', 'branding'], criterioAceite: 'Paleta e fontes registradas no conhecimento', secao: 'identidade' },
  { papel: 'sofia', titulo: 'Coletar referências visuais do cliente', tipo: 'branding', escopoKey: ['social', 'branding'], criterioAceite: 'Referências reunidas e comentadas', secao: 'identidade' },
  { papel: 'sofia', titulo: 'Organizar arquivos da marca', tipo: 'administrativo', escopoKey: ['social', 'branding'], criterioAceite: 'Pasta do cliente organizada com os arquivos nomeados', secao: 'identidade' },
  { papel: 'sofia', titulo: 'Anexar mídias na área do cliente', tipo: 'criativo', escopoKey: ['social', 'branding'], criterioAceite: 'Mídias disponíveis na área do cliente', secao: 'conteudo' },
  { papel: 'sofia', titulo: 'Analisar formatos com o Genna', tipo: 'criativo', escopoKey: ['social', 'branding'], criterioAceite: 'Relatório do Genna salvo no onboarding', secao: 'analise' },
  { papel: 'sofia', titulo: 'Analisar concorrentes com o Genna', tipo: 'criativo', escopoKey: ['social', 'branding'], criterioAceite: 'Relatório de concorrentes salvo no onboarding', secao: 'analise' },
  { papel: 'sofia', titulo: 'Identificar formatos e padrões do nicho', tipo: 'criativo', escopoKey: ['social', 'branding'], criterioAceite: 'Padrões de formato documentados', secao: 'conteudo' },
  { papel: 'sofia', titulo: 'Construir direção visual do cliente', tipo: 'branding', escopoKey: ['social', 'branding'], criterioAceite: 'Direção visual aprovada internamente', secao: 'identidade' },
  { papel: 'sofia', titulo: 'Revisar peças criativas produzidas', tipo: 'criativo', escopoKey: ['social', 'branding'], criterioAceite: 'Peças revisadas contra a direção visual', secao: 'conteudo' },
  // Matheus — audiovisual e copy.
  { papel: 'matheus', titulo: 'Agendar captações com o cliente', tipo: 'reuniao', escopoKey: 'audiovisual', criterioAceite: 'Datas e locais de captação confirmados', secao: 'audiovisual' },
  { papel: 'matheus', titulo: 'Planejar cronograma audiovisual', tipo: 'outro', escopoKey: 'audiovisual', criterioAceite: 'Cronograma de captação e edição definido', secao: 'audiovisual' },
  { papel: 'matheus', titulo: 'Organizar produção (equipe, equipamento, logística)', tipo: 'administrativo', escopoKey: 'audiovisual', criterioAceite: 'Produção das captações organizada', secao: 'audiovisual' },
  { papel: 'matheus', titulo: 'Produzir roteiros dos vídeos', tipo: 'copy', escopoKey: 'audiovisual', criterioAceite: 'Roteiros escritos e revisados', secao: 'audiovisual' },
  { papel: 'matheus', titulo: 'Analisar copies existentes do cliente', tipo: 'copy', escopoKey: null, criterioAceite: 'Diagnóstico das copies registrado', secao: 'conteudo' },
  { papel: 'matheus', titulo: 'Revisar copies novas', tipo: 'copy', escopoKey: null, criterioAceite: 'Copies revisadas contra o tom de voz da marca', secao: 'conteudo' },
  { papel: 'matheus', titulo: 'Analisar referências de conteúdo', tipo: 'outro', escopoKey: null, criterioAceite: 'Referências analisadas e comentadas', secao: 'conteudo' },
  { papel: 'matheus', titulo: 'Investigar formatos com o Genna', tipo: 'outro', escopoKey: null, criterioAceite: 'Relatório de formatos salvo no onboarding', secao: 'analise' },
  { papel: 'matheus', titulo: 'Investigar métricas disponíveis', tipo: 'outro', escopoKey: null, criterioAceite: 'Métricas disponíveis mapeadas e registradas', secao: 'analise' },
  { papel: 'matheus', titulo: 'Participar da análise estratégica com a Sofia', tipo: 'reuniao', escopoKey: null, criterioAceite: 'Análise conjunta registrada nas decisões', secao: 'estrategia' },
  { papel: 'matheus', titulo: 'Organizar edição dos vídeos', tipo: 'outro', escopoKey: 'audiovisual', criterioAceite: 'Fila de edição organizada com prazos', secao: 'audiovisual' },
  { papel: 'matheus', titulo: 'Validar qualidade dos vídeos entregues', tipo: 'reel', escopoKey: 'audiovisual', criterioAceite: 'Vídeos conferidos contra o roteiro e o padrão de qualidade', secao: 'audiovisual' },
  // Interno — orquestração do onboarding.
  { papel: 'interno', titulo: 'Validar informações coletadas', tipo: 'administrativo', escopoKey: null, criterioAceite: 'Seções de conhecimento revisadas contra o formulário', secao: 'coleta' },
  { papel: 'interno', titulo: 'Identificar dados ausentes e cobrar', tipo: 'administrativo', escopoKey: null, criterioAceite: 'Lista de ausências enviada ao responsável', secao: 'coleta' },
  { papel: 'interno', titulo: 'Construir especificação do agente de IA', tipo: 'outro', escopoKey: 'agente_ia', criterioAceite: 'Especificação salva no onboarding', secao: 'agente_ia' },
  { papel: 'interno', titulo: 'Validar prompt do agente', tipo: 'outro', escopoKey: 'agente_ia', criterioAceite: 'Prompt revisado contra a especificação', secao: 'agente_ia' },
  { papel: 'interno', titulo: 'Testar follow-ups do agente', tipo: 'outro', escopoKey: 'agente_ia', criterioAceite: 'Cenários de follow-up testados e registrados', secao: 'agente_ia' },
  { papel: 'interno', titulo: 'Conferir integração com o Genna', tipo: 'administrativo', escopoKey: null, criterioAceite: 'Conexão do Genna da subconta verificada ou exceção registrada', secao: 'analise' },
  { papel: 'interno', titulo: 'Conferir organização dos materiais', tipo: 'administrativo', escopoKey: null, criterioAceite: 'Materiais do cliente organizados e acessíveis', secao: 'conteudo' },
  { papel: 'interno', titulo: 'Verificar dependências entre tarefas', tipo: 'administrativo', escopoKey: null, criterioAceite: 'Bloqueios entre tarefas identificados e tratados', secao: 'tarefas' },
  { papel: 'interno', titulo: 'Validar tarefas geradas com os responsáveis', tipo: 'administrativo', escopoKey: null, criterioAceite: 'Responsáveis confirmaram ciência das tarefas', secao: 'equipe' },
  { papel: 'interno', titulo: 'Preparar relatório final do onboarding', tipo: 'administrativo', escopoKey: null, criterioAceite: 'Relatório final pronto para a homologação', secao: 'qualidade' },
] as const;

/** Templates de tarefa que se aplicam a um escopo. */
export function tarefasParaEscopo(escopo: Escopo): TarefaTemplate[] {
  return TAREFAS_TEMPLATE.filter((t) => aplicavelAoEscopo(t.escopoKey, escopo));
}

// ───────────────────────────── pauta da imersão ─────────────────────────────

export interface TopicoPauta {
  chave: string;
  titulo: string;
  /** Serviço que motiva o tópico extra; null = tópico base. */
  escopoKey: EscopoKey;
}

export const PAUTA_IMERSAO_BASE: readonly TopicoPauta[] = [
  { chave: 'apresentacao', titulo: 'Apresentação dos envolvidos', escopoKey: null },
  { chave: 'historia', titulo: 'História e contexto do negócio', escopoKey: null },
  { chave: 'produtos', titulo: 'Produtos e serviços prioritários', escopoKey: null },
  { chave: 'publico', titulo: 'Público e perfil de cliente ideal', escopoKey: null },
  { chave: 'diferenciais', titulo: 'Diferenciais competitivos', escopoKey: null },
  { chave: 'atendimento', titulo: 'Processo de atendimento', escopoKey: null },
  { chave: 'comercial', titulo: 'Processo comercial', escopoKey: null },
  { chave: 'horarios', titulo: 'Horários e capacidade de atendimento', escopoKey: null },
  { chave: 'objetivos', titulo: 'Objetivos e metas', escopoKey: null },
  { chave: 'campanhas', titulo: 'Campanhas anteriores e resultados', escopoKey: null },
  { chave: 'concorrentes', titulo: 'Concorrentes e referências', escopoKey: null },
  { chave: 'materiais', titulo: 'Materiais e acessos disponíveis', escopoKey: null },
  { chave: 'expectativas', titulo: 'Expectativas do cliente', escopoKey: null },
  { chave: 'proximos_passos', titulo: 'Próximas etapas do onboarding', escopoKey: null },
] as const;

/** Tópicos extras que entram na pauta conforme os serviços contratados. */
const PAUTA_IMERSAO_EXTRAS: readonly TopicoPauta[] = [
  { chave: 'verba_midia', titulo: 'Verba de mídia, conta de anúncios e pixels', escopoKey: 'trafego' },
  { chave: 'linha_editorial', titulo: 'Linha editorial, frequência e formatos', escopoKey: 'social' },
  { chave: 'captacoes', titulo: 'Captações: locais, datas e logística', escopoKey: 'audiovisual' },
  { chave: 'atendimento_ia', titulo: 'Atendimento por IA: tom, regras e encaminhamento humano', escopoKey: 'agente_ia' },
  { chave: 'identidade_visual', titulo: 'Identidade visual: estado atual e referências', escopoKey: 'branding' },
] as const;

/** Pauta da reunião de imersão adaptada ao escopo contratado. */
export function pautaParaEscopo(escopo: Escopo): TopicoPauta[] {
  return [...PAUTA_IMERSAO_BASE, ...PAUTA_IMERSAO_EXTRAS.filter((t) => aplicavelAoEscopo(t.escopoKey, escopo))];
}

// ───────────────────────────── cenários de teste do agente ─────────────────────────────

export interface CenarioTeste {
  cenario: string;
  descricao: string;
}

export const CENARIOS_TESTE_AGENTE: readonly CenarioTeste[] = [
  { cenario: 'primeiro_contato', descricao: 'Lead chega pela primeira vez e se apresenta' },
  { cenario: 'duvida_preco', descricao: 'Lead pergunta preço diretamente' },
  { cenario: 'interesse_comercial', descricao: 'Lead demonstra interesse e quer avançar' },
  { cenario: 'objecao', descricao: 'Lead levanta objeção (preço, tempo, confiança)' },
  { cenario: 'cliente_indeciso', descricao: 'Lead não decide e enrola a conversa' },
  { cenario: 'fora_do_escopo', descricao: 'Pedido fora do que o cliente oferece' },
  { cenario: 'pergunta_sem_resposta', descricao: 'Pergunta sem resposta na base de conhecimento' },
  { cenario: 'reclamacao', descricao: 'Cliente insatisfeito reclamando' },
  { cenario: 'escalacao_humana', descricao: 'Situação que exige atendimento humano' },
  { cenario: 'lead_sem_resposta', descricao: 'Lead que não respondeu (follow-up)' },
  { cenario: 'intencao_compra', descricao: 'Lead com intenção clara de compra' },
] as const;

export const STATUS_TESTE_AGENTE = ['pendente', 'aprovado', 'reprovado'] as const;
export type StatusTesteAgente = (typeof STATUS_TESTE_AGENTE)[number];

export const STATUS_APROVACAO_AGENTE = ['rascunho', 'em_testes', 'aprovado', 'publicado'] as const;
export type AprovacaoAgente = (typeof STATUS_APROVACAO_AGENTE)[number];

export interface ResultadoTesteAgente {
  cenario: string;
  status: StatusTesteAgente;
  observacao?: string;
}

/**
 * Status de aprovação derivado dos testes: `aprovado` só quando os 11
 * cenários base estão presentes e todos aprovados; qualquer teste registrado
 * sem completar isso é `em_testes`; nenhum teste = `rascunho`.
 */
export function aprovacaoDosTestes(testes: readonly ResultadoTesteAgente[]): AprovacaoAgente {
  if (!testes.length) return 'rascunho';
  const porCenario = new Map(testes.map((t) => [t.cenario, t.status]));
  const completo = CENARIOS_TESTE_AGENTE.every((c) => porCenario.get(c.cenario) === 'aprovado');
  return completo ? 'aprovado' : 'em_testes';
}

// ───────────────────────────── validação de entrada ─────────────────────────────

export const STATUS_ONBOARDING = ['coleta', 'imersao', 'implantacao', 'homologacao', 'pronto', 'bloqueado'] as const;

const id = z.string().uuid('id inválido');
const texto = (max: number) => z.string().trim().max(max, `máximo de ${max} caracteres`);
const data = z.string().datetime({ offset: true, message: 'data inválida' }).transform((v) => new Date(v));

const escopoSchema = z
  .object({ trafego: z.boolean(), social: z.boolean(), audiovisual: z.boolean(), agente_ia: z.boolean(), branding: z.boolean() })
  .partial()
  .strict();

export const IniciarSchema = z
  .object({
    clientAccountId: id,
    escopo: escopoSchema,
    responsavelId: id.nullable(),
  })
  .partial()
  .required({ clientAccountId: true })
  .strict();
export type IniciarInput = z.infer<typeof IniciarSchema>;

export const AtualizarOnboardingSchema = z
  .object({
    status: z.enum(STATUS_ONBOARDING),
    etapaAtual: texto(120).nullable(),
    responsavelId: id.nullable(),
    escopo: escopoSchema,
    justificativa: texto(500),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'nada para alterar');
export type AtualizarOnboardingInput = z.infer<typeof AtualizarOnboardingSchema>;

export const ConhecimentoSchema = z
  .object({
    dados: z.record(z.unknown()),
    pendente: z.boolean(),
  })
  .partial()
  .required({ dados: true })
  .strict();
export type ConhecimentoInput = z.infer<typeof ConhecimentoSchema>;

const listaTexto = (max: number, itens: number) => z.array(texto(max).min(1)).max(itens);

const camposReuniao = {
  tipo: texto(40).min(1),
  data: data.nullable(),
  participantes: listaTexto(200, 50),
  pauta: listaTexto(300, 50),
  resumo: texto(20000).nullable(),
  decisoes: listaTexto(500, 100),
  pendencias: listaTexto(500, 100),
};

export const ReuniaoSchema = z.object(camposReuniao).partial().strict();
export type ReuniaoInput = z.infer<typeof ReuniaoSchema>;

export const GerarTarefasSchema = z
  .object({
    /** Papel do template → membro da equipe que recebe as tarefas dele. */
    atribuicoes: z.record(z.enum(PAPEIS_TAREFA), id),
  })
  .partial()
  .strict();
export type GerarTarefasInput = z.infer<typeof GerarTarefasSchema>;

const NOME_FERRAMENTA = /^[A-Za-z0-9_.-]{1,120}$/;

export const RelatorioGennaSchema = z
  .object({
    perfil: texto(200).min(1, 'informe o perfil analisado'),
    ferramenta: z.string().regex(NOME_FERRAMENTA, 'nome de ferramenta inválido'),
    argumentos: z.record(z.unknown()).optional(),
  })
  .strict()
  .required({ perfil: true, ferramenta: true });
export type RelatorioGennaInput = z.infer<typeof RelatorioGennaSchema>;

export const SpecAgenteSchema = z
  .object({
    nome: texto(120).nullable(),
    especificacao: z.record(z.unknown()),
    systemPrompt: texto(20000).nullable(),
  })
  .partial()
  .required({ especificacao: true })
  .strict();
export type SpecAgenteInput = z.infer<typeof SpecAgenteSchema>;

export const TesteAgenteSchema = z
  .object({
    cenario: z.enum(CENARIOS_TESTE_AGENTE.map((c) => c.cenario) as [string, ...string[]]),
    status: z.enum(STATUS_TESTE_AGENTE),
    observacao: texto(1000),
  })
  .partial()
  .required({ cenario: true, status: true })
  .strict();
export type TesteAgenteInput = z.infer<typeof TesteAgenteSchema>;

const evidencia = z.object({ tipo: texto(60), referencia: texto(500), observacao: texto(1000) }).partial().strict();

export const VerificarSchema = z
  .object({
    status: z.enum(STATUS_VERIFICACAO),
    evidencias: z.array(evidencia).max(50),
    /** Confirmação explícita de que o item foi verificado sem evidência anexada. */
    semEvidencia: z.boolean(),
    motivo: texto(500),
  })
  .partial()
  .required({ status: true })
  .strict();
export type VerificarInput = z.infer<typeof VerificarSchema>;

export const SolicitarAprovacaoSchema = z
  .object({
    acao: texto(80).min(1, 'informe a ação'),
    payload: z.record(z.unknown()),
  })
  .partial()
  .required({ acao: true })
  .strict();
export type SolicitarAprovacaoInput = z.infer<typeof SolicitarAprovacaoSchema>;

export const DecisaoAprovacaoSchema = z
  .object({
    aprovar: z.boolean(),
    justificativa: texto(1000),
  })
  .partial()
  .required({ aprovar: true })
  .strict();
export type DecisaoAprovacaoInput = z.infer<typeof DecisaoAprovacaoSchema>;

export function validar<S extends z.ZodTypeAny>(schema: S, bruto: unknown): z.infer<S> {
  const r = schema.safeParse(bruto ?? {});
  if (!r.success) throw erroZod(r.error);
  return r.data;
}

function erroZod(e: ZodError): BadRequestException {
  const problemas = e.issues.map((i) => i.message);
  return new BadRequestException({ message: problemas[0] ?? 'dados inválidos', code: 'onboarding_invalido', problemas });
}

// ───────────────────────────── filtros da visão executiva ─────────────────────────────

/** Filtros da listagem vindos da query string. Valores desconhecidos são ignorados (nunca 400 por filtro). */
export interface FiltrosVisao {
  status: string[];
  etapa?: string;
  responsavel?: string;
  cliente?: string;
  de?: Date;
  ate?: Date;
  prioridade: string[];
}

const lista = <T extends string>(v: unknown, validos: readonly T[]): T[] =>
  typeof v === 'string' ? v.split(',').filter((x): x is T => (validos as readonly string[]).includes(x)) : [];
const uuid = (v: unknown): string | undefined => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
const dataFiltro = (v: unknown): Date | undefined => {
  if (typeof v !== 'string') return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
};
const PRIORIDADES_TAREFA = ['baixa', 'normal', 'alta', 'urgente'] as const;

export function lerFiltrosVisao(q: Record<string, unknown>): FiltrosVisao {
  return {
    status: lista(q.status, STATUS_ONBOARDING),
    etapa: typeof q.etapa === 'string' && q.etapa.trim() ? q.etapa.trim().slice(0, 120) : undefined,
    responsavel: uuid(q.responsavel),
    cliente: uuid(q.cliente),
    de: dataFiltro(q.de),
    ate: dataFiltro(q.ate),
    prioridade: lista(q.prioridade, PRIORIDADES_TAREFA),
  };
}
