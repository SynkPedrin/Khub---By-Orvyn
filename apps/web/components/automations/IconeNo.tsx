import type { ReactNode } from 'react';

/**
 * Logo própria de cada gatilho, controle e ação do construtor de automações.
 * Cada nó tem um símbolo desenhado (SVG 24×24, traço 2) sobre um bloco sólido
 * da cor da FAMÍLIA do passo (contato, tag, funil, agenda, mensagem…). O bloco
 * sólido com borda escura lê igual no tema claro e no escuro, sem depender do
 * fundo do canvas. Um lugar só: canvas, paleta, lista, modo simples.
 */

export type Familia =
  | 'contato' | 'tag' | 'funil' | 'agenda' | 'mensagem' | 'tempo' | 'logica'
  | 'ia' | 'integracao' | 'pagamento' | 'formulario' | 'equipe' | 'fim';

/** Cor base de cada família (bloco do ícone, acento do nó, faixa do topo). */
export const COR_FAMILIA: Record<Familia, { base: string; claro: string; nome: string }> = {
  contato: { base: '#2563eb', claro: '#60a5fa', nome: 'Contato' },
  tag: { base: '#d97706', claro: '#fbbf24', nome: 'Tags' },
  funil: { base: '#059669', claro: '#34d399', nome: 'Funil e negócios' },
  agenda: { base: '#7c3aed', claro: '#a78bfa', nome: 'Agenda' },
  mensagem: { base: '#16a34a', claro: '#4ade80', nome: 'Mensagens' },
  tempo: { base: '#475569', claro: '#94a3b8', nome: 'Tempo' },
  logica: { base: '#0891b2', claro: '#22d3ee', nome: 'Lógica' },
  ia: { base: '#7b2eff', claro: '#d946ef', nome: 'Inteligência' },
  integracao: { base: '#ea580c', claro: '#fb923c', nome: 'Integrações' },
  pagamento: { base: '#0d9488', claro: '#2dd4bf', nome: 'Pagamentos' },
  formulario: { base: '#db2777', claro: '#f472b6', nome: 'Formulários' },
  equipe: { base: '#4f46e5', claro: '#818cf8', nome: 'Equipe' },
  fim: { base: '#3f3f46', claro: '#a1a1aa', nome: 'Fim' },
};

// ---------------------------------------------------------------- símbolos
// Peças reaproveitadas (mesma linguagem visual em todos os ícones).
const pessoa = <><circle cx="10" cy="8" r="3.5" /><path d="M3.5 19.5c.8-3.4 3.4-5.5 6.5-5.5s5.7 2.1 6.5 5.5" /></>;
const etiqueta = <><path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.4 1.4 0 0 1 0 2l-6.5 6.5a1.4 1.4 0 0 1-2 0z" /><circle cx="8" cy="8" r="1.4" /></>;
const calendario = <><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>;
const balao = <path d="M20.5 11.5c0 4.1-3.8 7.5-8.5 7.5a9.6 9.6 0 0 1-3.6-.7L3.5 20l1.4-3.9A7 7 0 0 1 3.5 11.5C3.5 7.4 7.3 4 12 4s8.5 3.4 8.5 7.5z" />;
const relogio = <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>;
const maleta = <><rect x="3.5" y="7.5" width="17" height="12" rx="2.5" /><path d="M9 7.5V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8v1.7M3.5 12.5h17" /></>;
const raio = <path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" />;
const faisca = <path d="M12 3.5 13.9 9 19.5 11l-5.6 2-1.9 5.5-1.9-5.5L4.5 11l5.6-2zM19 3.5v3M17.5 5h3" />;

const S: Record<string, ReactNode> = {
  // ---- gatilhos
  'gatilho.contato_criado': <>{pessoa}<path d="M18.5 8v5M16 10.5h5" /></>,
  'gatilho.tag_adicionada': <>{etiqueta}<path d="M17.5 3v4M15.5 5h4" /></>,
  'gatilho.negocio_criado': <>{maleta}<path d="M12 10.5v4M10 12.5h4" /></>,
  'gatilho.etapa_mudou': <><rect x="3" y="5" width="5" height="14" rx="1.5" /><rect x="16" y="5" width="5" height="14" rx="1.5" /><path d="M9.5 12h5M12.5 9.5 15 12l-2.5 2.5" /></>,
  'gatilho.negocio_status': <><path d="M8 4h8v4a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 12v4M8.5 20h7M10 16h4v4h-4z" /></>,
  'gatilho.mensagem_recebida': <>{balao}<path d="M12 8v5M9.8 11l2.2 2.2 2.2-2.2" /></>,
  'gatilho.webhook': <><circle cx="7" cy="17" r="2.5" /><circle cx="17" cy="17" r="2.5" /><circle cx="12" cy="6.5" r="2.5" /><path d="M10.8 8.8 8.2 14.8M13.2 8.8l2.6 6M9.5 17h5" /></>,
  'gatilho.agendamento_criado': <>{calendario}<path d="M12 12.5v5M9.5 15h5" /></>,
  'gatilho.agendamento_confirmado': <>{calendario}<path d="m8.8 15.2 2.2 2.2 4.2-4.4" /></>,
  'gatilho.faltou': <>{calendario}<path d="M12 12.5v2.6M12 17.6v.1" /></>,
  'gatilho.agendamento_cancelado': <>{calendario}<path d="m9.8 13 4.4 4.4M14.2 13l-4.4 4.4" /></>,
  'gatilho.lembrete_agendamento': <><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2.2 2.2 0 0 0 4 0" /><path d="M12 2.5v2" /></>,
  'gatilho.agendado': <>{relogio}<path d="M19.5 3.5 21 5M4.5 3.5 3 5" /></>,
  'gatilho.data_contato': <><path d="M4 11.5h16v8.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM3 8h18v3.5H3zM12 8v13" /><path d="M12 8c-1.5-3.5-5.5-3.5-5.5-1.3S9.5 8 12 8zm0 0c1.5-3.5 5.5-3.5 5.5-1.3S14.5 8 12 8z" /></>,
  'gatilho.formulario_enviado': <><rect x="5" y="3.5" width="14" height="17" rx="2.5" /><path d="M8.5 8h7M8.5 11.5h7M8.5 15h3.5M14 15.5l1.5 1.5 2.5-3" /></>,
  'gatilho.pagamento_recebido': <><rect x="3" y="6" width="18" height="12.5" rx="2.5" /><path d="M3 10h18M7 14.5h3M14.5 14l1.4 1.4 2.6-2.6" /></>,

  // ---- controle
  'controle.esperar': <><path d="M6.5 3.5h11M6.5 20.5h11M7.5 3.5c0 4.5 4.5 5.5 4.5 8.5s-4.5 4-4.5 8.5M16.5 3.5c0 4.5-4.5 5.5-4.5 8.5s4.5 4 4.5 8.5" /><path d="M9.5 18h5" /></>,
  'controle.esperar_resposta': <>{balao}<path d="M8.5 11.5h.1M12 11.5h.1M15.5 11.5h.1" /></>,
  'controle.condicao': <><path d="M12 3.5 20.5 12 12 20.5 3.5 12z" /><path d="M10.2 9.8a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1v.6M12 15.4v.1" /></>,
  'controle.split': <><circle cx="5.5" cy="12" r="2" /><path d="M7.5 12h3.5c2.5 0 3-5.5 5.5-5.5H19M11 12c2.5 0 3 5.5 5.5 5.5H19M17 4.5l2 2-2 2M17 15.5l2 2-2 2" /></>,
  'controle.drip': <><path d="M12 3.5c3 3.7 5 6.5 5 9.2a5 5 0 0 1-10 0c0-2.7 2-5.5 5-9.2z" /><path d="M9.8 13.5a2.3 2.3 0 0 0 2.2 2" /></>,
  'controle.ir_para': <><path d="M4 18.5V12a5 5 0 0 1 5-5h11" /><path d="m16 3 4 4-4 4" /></>,
  'controle.encerrar': <><circle cx="12" cy="12" r="8.5" /><rect x="9" y="9" width="6" height="6" rx="1" /></>,
  'controle.esperar_ate': <>{relogio}<path d="M17 19.5h4M19 17.5v4" /></>,
  'controle.meta': <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.8" /><circle cx="12" cy="12" r="1.3" /></>,

  // ---- ações
  'acao.enviar_sms': <><path d="M21 3.5 10.5 14M21 3.5l-6.5 17-4-6.5-6.5-4z" /></>,
  'acao.enviar_email': <><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><path d="m3.8 7 8.2 6 8.2-6" /></>,
  'acao.notificar_equipe': <><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2.2 2.2 0 0 0 4 0" /><circle cx="18" cy="5.5" r="2" /></>,
  'acao.ia': <>{faisca}</>,
  'acao.definir_variavel': <><path d="M8 4.5C5.5 4.5 6 8 6 9.5S5 12 4 12c1 0 2 .8 2 2.5s-.5 5 2 5M16 4.5c2.5 0 2 3.5 2 5s1 2.5 2 2.5c-1 0-2 .8-2 2.5s.5 5-2 5M10 9.5l4 5M14 9.5l-4 5" /></>,
  'acao.formatar_texto': <><path d="M5 6.5V4.5h14v2M12 4.5v15M9.5 19.5h5" /></>,
  'acao.adicionar_tag': <>{etiqueta}<path d="M14 14.5h5M16.5 12v5" /></>,
  'acao.remover_tag': <>{etiqueta}<path d="M14 14.5h5" /></>,
  'acao.atualizar_contato': <>{pessoa}<path d="m15.5 14.5 4-4 1.5 1.5-4 4h-1.5z" /></>,
  'acao.criar_oportunidade': <><path d="M12 3.5v17M16.5 7c-.7-1.4-2.4-2.2-4.5-2.2-2.6 0-4.3 1.3-4.3 3.1 0 4.3 9 2.3 9 6.4 0 1.9-1.9 3.2-4.7 3.2-2.3 0-4-.9-4.7-2.4" /></>,
  'acao.mover_etapa': <><rect x="3" y="5" width="5" height="14" rx="1.5" /><path d="M10.5 12h8M15.5 8.5 19 12l-3.5 3.5" /></>,
  'acao.criar_tarefa': <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8.3 12.2 2.4 2.4 5-5.2" /></>,
  'acao.criar_nota': <><path d="M5 3.5h10l4 4v13H5z" /><path d="M14.5 3.5V8H19M8.5 12h7M8.5 15.5h5" /></>,
  'acao.chamar_workflow': <><rect x="3" y="4" width="7" height="6" rx="1.5" /><rect x="14" y="14" width="7" height="6" rx="1.5" /><path d="M6.5 10v4.5a2 2 0 0 0 2 2H14M11.5 14.5l2.5 2-2.5 2" /></>,
  'acao.webhook': <><path d="M9 7.5 4.5 12 9 16.5M15 7.5l4.5 4.5-4.5 4.5M13.2 5.5l-2.4 13" /></>,
  'acao.pedir_avaliacao': <><path d="m12 3.8 2.5 5.1 5.6.8-4 4 .9 5.6-5-2.7-5 2.7.9-5.6-4-4 5.6-.8z" /></>,
  'acao.remover_de_fluxo': <><path d="M10 4.5H5.5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1H10M14.5 8l4 4-4 4M18.5 12H9" /></>,
  'acao.atribuir_usuario': <>{pessoa}<path d="m16 13 2 2 3.5-3.5" /></>,
  'acao.ativar_ia': <><rect x="4.5" y="7.5" width="15" height="11.5" rx="3.5" /><path d="M12 7.5V4.5M9 12.5v1.5M15 12.5v1.5M2.5 13v2.5M21.5 13v2.5" /><circle cx="12" cy="3.5" r="1" /></>,
  'acao.passar_humano': <><circle cx="9" cy="7.5" r="3" /><path d="M3.5 18.5c.6-3 2.8-4.8 5.5-4.8 1.3 0 2.5.4 3.4 1.2M15 13.5h6M18.5 11l2.5 2.5-2.5 2.5" /></>,
  'acao.nao_perturbe': <><circle cx="12" cy="12" r="8.5" /><path d="M8 12h8" /></>,
  'acao.atualizar_negocio': <>{maleta}<path d="m14 15.5 3-3 1.3 1.3-3 3H14z" /></>,
};

const RESERVA = <>{raio}</>;

/** Família de cada tipo: decide a cor do bloco e o acento do nó. */
export function familiaDoTipo(tipo: string): Familia {
  if (tipo === 'acao.ia' || tipo === 'acao.ativar_ia') return 'ia';
  if (/contato_criado|atualizar_contato/.test(tipo)) return 'contato';
  if (/tag/.test(tipo)) return 'tag';
  if (/negocio|etapa|oportunidade/.test(tipo)) return 'funil';
  if (/agendamento|faltou|data_contato/.test(tipo)) return 'agenda';
  if (/mensagem|enviar_sms|enviar_email|esperar_resposta|pedir_avaliacao/.test(tipo)) return 'mensagem';
  if (/pagamento/.test(tipo)) return 'pagamento';
  if (/formulario/.test(tipo)) return 'formulario';
  if (/webhook|chamar_workflow|definir_variavel|formatar_texto/.test(tipo)) return 'integracao';
  if (/notificar_equipe|atribuir_usuario|passar_humano|criar_tarefa|criar_nota|nao_perturbe/.test(tipo)) return 'equipe';
  if (/encerrar|remover_de_fluxo/.test(tipo)) return 'fim';
  if (/condicao|split|meta|ir_para/.test(tipo)) return 'logica';
  if (/esperar|agendado|drip|lembrete/.test(tipo)) return 'tempo';
  return 'integracao';
}

export function SimboloNo({ tipo, tamanho = 20, cor = 'currentColor' }: { tipo: string; tamanho?: number; cor?: string }) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke={cor}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      {S[tipo] ?? RESERVA}
    </svg>
  );
}

/** Todos os tipos com logo desenhada (para teste de cobertura). */
export const TIPOS_COM_SIMBOLO = Object.keys(S);
