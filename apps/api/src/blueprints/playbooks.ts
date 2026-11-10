/**
 * Camada de Conhecimento — Playbooks por nicho (os "Blueprints" do KHUB).
 *
 * Fato e regra DE NICHO, versionado — nunca dado de cliente (isso entra como
 * delta na aplicação). Separação de camadas: o playbook guarda a estrutura; o
 * `BlueprintService` provisiona; a Nyro customiza a linguagem. Cada playbook
 * carrega os **guardrails de compliance** do conselho (CFM/OAB/CFC) como
 * restrição — em nicho tier 3, o gerador NUNCA pode violar.
 *
 * Diferença vs. o modelo de snapshot+delta de CRMs de mercado: aqui o provisionamento é NATIVO
 * (cria pipeline/etapas/automações no próprio CRM), não injeção numa subconta.
 */

export type Familia = 'saude_regulada' | 'servico_regulado' | 'estetica' | 'varejo';

export interface Objecao {
  objecao: string;
  angulo1: string;
  angulo2: string;
  retirada: string;
}
export interface Guardrails {
  proibicoes: string[];
  termosBloqueados: string[];
  disclaimers: string[];
}
export interface CampoObrigatorio {
  chave: string;
  bloqueiaPublicacao: boolean;
}
export interface Playbook {
  id: string;                    // ex: saude.odontologia
  nome: string;
  familia: Familia;
  versao: number;
  cnae: string[];
  orgaoRegulador: string | null;
  tier: 1 | 2 | 3;               // 3 = crítico (conselho com poder de sanção)
  funilNome: string;
  etapas: string[];              // vira o pipeline no CRM
  qualificacao: string[];        // 1 pergunta por mensagem
  objecoes: Objecao[];           // sempre 2 ângulos + retirada
  automacoes: string[];          // termos de busca no marketplace (instalar no provisionamento)
  compliance: Guardrails;
  dadosObrigatorios: CampoObrigatorio[];
  tom: string;
}

export const PLAYBOOKS: Record<string, Playbook> = {
  'saude.odontologia': {
    id: 'saude.odontologia',
    nome: 'Clínica Odontológica',
    familia: 'saude_regulada',
    versao: 1,
    cnae: ['8630-5/04'],
    orgaoRegulador: 'CFO/CRO',
    tier: 3,
    funilNome: 'Funil Odontológico',
    etapas: ['Novo lead', 'Qualificado', 'Aguardando pagamento', 'Agendado', 'Compareceu'],
    qualificacao: [
      'Você procura resolver algo pontual ou fazer um tratamento mais completo?',
      'Qual região fica melhor para você?',
    ],
    objecoes: [
      {
        objecao: 'preço / "está caro"',
        angulo1: 'valor do plano de tratamento e opções de parcelamento',
        angulo2: 'custo de adiar — o problema tende a agravar e o tratamento fica maior',
        retirada: 'Sem problema. Deixo o convite aberto para quando fizer sentido.',
      },
      {
        objecao: 'medo / receio',
        angulo1: 'acolhimento e explicação do passo a passo da avaliação',
        angulo2: 'reforço de que a avaliação não compromete a nada',
        retirada: 'Respeito totalmente. Fico à disposição quando quiser.',
      },
    ],
    automacoes: ['boas-vindas', 'follow-up', 'reativação'],
    compliance: {
      proibicoes: [
        'prometer resultado ou cura garantida',
        'antes/depois com apelo sensacionalista',
        'preço como chamariz sensacionalista ou falsa urgência',
        'comparação depreciativa com outros profissionais',
      ],
      termosBloqueados: ['garantido', 'sem dor', 'melhor dentista', 'imperdível', 'últimas vagas'],
      disclaimers: ['Resultados variam conforme avaliação individual.'],
    },
    dadosObrigatorios: [
      { chave: 'pix_key', bloqueiaPublicacao: true },
      { chave: 'endereco', bloqueiaPublicacao: true },
      { chave: 'horario_atendimento', bloqueiaPublicacao: true },
    ],
    tom: 'acolhedor, profissional, direto; tratar receio como hesitação, não recusa',
  },

  'juridico.advocacia': {
    id: 'juridico.advocacia',
    nome: 'Escritório de Advocacia',
    familia: 'servico_regulado',
    versao: 1,
    cnae: ['6911-7/01'],
    orgaoRegulador: 'OAB (Provimento 205/2021)',
    tier: 3,
    funilNome: 'Funil Jurídico',
    etapas: ['Novo lead', 'Triagem do caso', 'Consulta agendada', 'Proposta/contrato', 'Cliente'],
    qualificacao: [
      'Qual é, em uma frase, a situação que você precisa resolver?',
      'Isso já está em algum processo ou é a primeira orientação?',
    ],
    objecoes: [
      {
        objecao: 'preço dos honorários',
        angulo1: 'explicação do escopo e das etapas do trabalho',
        angulo2: 'risco de agir sem orientação adequada',
        retirada: 'Compreendo. A porta fica aberta se precisar de orientação depois.',
      },
      {
        objecao: 'insegurança / "será que resolve?"',
        angulo1: 'esclarecer o caminho possível, sem prometer desfecho',
        angulo2: 'reforço da análise individual do caso na consulta',
        retirada: 'Sem pressão. Estou à disposição quando decidir.',
      },
    ],
    automacoes: ['boas-vindas', 'follow-up'],
    compliance: {
      proibicoes: [
        'captação de clientela ou mercantilização da advocacia',
        'promessa de resultado ou de êxito',
        'sensacionalismo, urgência ou apelo comercial',
        'comparação com outros advogados',
      ],
      termosBloqueados: ['ganho garantido', 'êxito garantido', 'melhor advogado', 'promoção', 'desconto imperdível'],
      disclaimers: ['Cada caso é analisado individualmente; não há garantia de resultado.'],
    },
    dadosObrigatorios: [
      { chave: 'oab_numero', bloqueiaPublicacao: true },
      { chave: 'endereco', bloqueiaPublicacao: true },
      { chave: 'horario_atendimento', bloqueiaPublicacao: true },
    ],
    tom: 'sóbrio, informativo, discreto; nunca mercantilista',
  },

  'contabil.escritorio': {
    id: 'contabil.escritorio',
    nome: 'Escritório de Contabilidade',
    familia: 'servico_regulado',
    versao: 1,
    cnae: ['6920-6/01'],
    orgaoRegulador: 'CFC',
    tier: 2,
    funilNome: 'Funil Contábil',
    etapas: ['Novo lead', 'Diagnóstico', 'Proposta', 'Onboarding', 'Cliente ativo'],
    qualificacao: [
      'Sua empresa já está aberta ou você quer abrir agora?',
      'Qual o regime hoje (MEI, Simples, Presumido) ou ainda não sabe?',
    ],
    objecoes: [
      {
        objecao: 'preço da mensalidade',
        angulo1: 'o que está incluso e o custo de erro fiscal sem apoio',
        angulo2: 'economia real com enquadramento tributário correto',
        retirada: 'Tudo bem. Deixo o contato para quando quiser revisar.',
      },
      {
        objecao: '"já tenho contador"',
        angulo1: 'oferecer uma segunda análise sem compromisso',
        angulo2: 'pontos comuns de economia que passam despercebidos',
        retirada: 'Perfeito. Fico à disposição se precisar de uma segunda opinião.',
      },
    ],
    automacoes: ['boas-vindas', 'follow-up'],
    compliance: {
      proibicoes: [
        'prometer economia garantida de impostos',
        'publicidade enganosa sobre resultados fiscais',
      ],
      termosBloqueados: ['economia garantida', 'imposto zero', 'melhor contador'],
      disclaimers: ['A economia tributária depende da análise do caso concreto.'],
    },
    dadosObrigatorios: [
      { chave: 'crc_numero', bloqueiaPublicacao: false },
      { chave: 'endereco', bloqueiaPublicacao: true },
      { chave: 'horario_atendimento', bloqueiaPublicacao: true },
    ],
    tom: 'técnico, confiável, direto',
  },
};

/** Resolve o playbook pelo `nicho` do tenant (heurística simples por palavra). */
export function playbookPorNicho(nicho: string | null): Playbook | null {
  if (!nicho) return null;
  const n = nicho.toLowerCase();
  if (/(odonto|dent)/.test(n)) return PLAYBOOKS['saude.odontologia'];
  if (/(advoc|jur[íi]dic|direito)/.test(n)) return PLAYBOOKS['juridico.advocacia'];
  if (/(cont[áa]bil|contabilidade|contador)/.test(n)) return PLAYBOOKS['contabil.escritorio'];
  return null;
}
