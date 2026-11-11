/**
 * Tipos de visualização do KHUB.
 *
 * São os contratos que as TELAS consomem — deliberadamente separados dos
 * tipos de transporte de `lib/crm.ts`. Assim uma mudança no formato da API
 * não obriga a reescrever componentes, e o modo demo tem um alvo claro a
 * implementar.
 */

export type Canal = 'whatsapp' | 'instagram' | 'email' | 'linkedin' | 'site' | 'google' | 'indicacao' | 'forms' | 'parceria';

export type StatusLead = 'novo' | 'em_analise' | 'qualificado' | 'quente' | 'sem_resposta' | 'cliente' | 'perdido';

export type FaixaScore = 'quente' | 'morno' | 'frio' | 'sem_sinal';

export interface Responsavel {
  id: string;
  nome: string;
  avatarUrl?: string;
}

export interface Lead {
  id: string;
  nome: string;
  cargo?: string | null;
  empresa?: string | null;
  email?: string | null;
  telefone?: string | null;
  localizacao?: string | null;
  site?: string | null;
  linkedin?: string | null;
  avatarUrl?: string | null;
  origem: Canal;
  status: StatusLead;
  score: number | null;
  /** Versão do algoritmo que produziu o score — nunca exibir score sem saber a origem. */
  scoreVersao?: string;
  faixa?: FaixaScore;
  responsavel?: Responsavel | null;
  tags: string[];
  ultimaInteracaoAt: string | null;
  proximaAcao?: { rotulo: string; quando: string | null; tipo: 'responder' | 'abrir' | 'reengajar' | 'ligar' } | null;
  criadoEm: string;
  notas?: string | null;
  segmento?: string | null;
  tamanhoEmpresa?: string | null;
  primeiroContatoEm?: string | null;
}

export interface KpiLeads {
  novos: { valor: number; delta: number };
  qualificados: { valor: number; delta: number };
  semResposta: { valor: number; delta: number };
  quentes: { valor: number; delta: number };
}

export interface ItemTimeline {
  id: string;
  tipo: 'mensagem' | 'reuniao' | 'email' | 'campanha' | 'visita' | 'lead_criado' | 'nota' | 'tarefa' | 'etapa';
  canal?: Canal;
  titulo: string;
  descricao?: string;
  quando: string;
  link?: { rotulo: string; href: string };
}

export interface Negocio {
  id: string;
  titulo: string;
  valor: number;
  etapa: string;
  etapaIndice: number;
  etapas: string[];
  previsaoFechamento?: string | null;
  empresa?: string | null;
  contatoPrincipal?: { nome: string; cargo?: string | null } | null;
  responsavel?: Responsavel | null;
  origem?: string | null;
  tags?: string[];
  observacoes?: string | null;
}

export interface Tarefa {
  id: string;
  titulo: string;
  quando: string | null;
  concluida: boolean;
  responsavel?: Responsavel | null;
  urgente?: boolean;
  contexto?: string | null;
}

export interface EtapaPipeline {
  id: string;
  nome: string;
  cor: string;
  totalLeads: number;
  valor: number;
  negocios: CardNegocio[];
}

export interface CardNegocio {
  id: string;
  empresa: string;
  titulo: string;
  valor: number;
  tags: string[];
  responsavel?: Responsavel | null;
  atualizadoEm: string;
}

export interface ResumoConversa {
  id: string;
  nome: string;
  empresa?: string | null;
  avatarUrl?: string | null;
  canal: Canal;
  previa: string;
  quando: string;
  naoLidas: number;
  status: 'nao_lida' | 'em_atendimento' | 'aguardando' | 'resolvida';
  etiquetas: string[];
}

export interface Mensagem {
  id: string;
  de: 'lead' | 'equipe';
  texto: string;
  quando: string;
  lida?: boolean;
  autor?: string;
}

export interface Campanha {
  id: string;
  nome: string;
  subtitulo?: string;
  status: 'ativa' | 'pausada' | 'rascunho' | 'arquivada';
  canais: Canal[];
  publico: { rotulo: string; detalhe?: string };
  envios: number | null;
  respostas: number | null;
  reunioes: number | null;
  conversao: number | null;
  descricao?: string;
  sequencia: EtapaCampanha[];
}

export interface EtapaCampanha {
  ordem: number;
  canal: Canal;
  titulo: string;
  descricao: string;
  dia: number;
}

export interface Compromisso {
  id: string;
  titulo: string;
  subtitulo?: string;
  tipo: 'reuniao' | 'call' | 'demo' | 'followup' | 'tarefa' | 'interno' | 'pessoal';
  inicio: string;
  fim: string;
  participantes?: { nome: string; empresa?: string; papel?: string }[];
  local?: { tipo: 'meet' | 'presencial' | 'telefone'; valor: string } | null;
  descricao?: string;
  tags?: string[];
}

export interface InsightIA {
  id: string;
  titulo: string;
  descricao: string;
  acao?: { rotulo: string; href?: string };
}

export interface SerieTemporal {
  rotulo: string;
  valor: number;
}
