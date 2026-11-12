'use client';

import { clienteApi } from './session-fetch';
import type { Ramo } from './automations';

/**
 * Nós e gatilhos da Q3.1/Q3.2 no editor: resumo do card, config inicial,
 * saídas e as listas que os painéis precisam (membros, formulários). Espelha
 * `apps/api/src/automations/catalogo.ts` — a validação que vale é a da API.
 */

const req = clienteApi('/api/v1/');

export interface Responsavel { identityId: string; nome: string | null; email: string }
export interface FormularioResumo { id: string; nome: string; ativo: boolean }

export const motorApi = {
  responsaveis: () => req<Responsavel[]>('automations/responsaveis'),
  formularios: () => req<FormularioResumo[]>('forms'),
};

export const rotuloResponsavel = (r: Responsavel) => r.nome?.trim() || r.email;

/** Eventos que "Esperar até" (modo evento) e "Meta" podem aguardar. */
export const EVENTOS_ESPERA = [
  { valor: 'mensagem_recebida', rotulo: 'Contato respondeu' },
  { valor: 'tag_adicionada', rotulo: 'Tag adicionada' },
  { valor: 'etapa_mudou', rotulo: 'Negócio mudou de etapa' },
  { valor: 'agendamento_criado', rotulo: 'Agendou um horário' },
  { valor: 'agendamento_confirmado', rotulo: 'Confirmou o agendamento' },
  { valor: 'negocio_status', rotulo: 'Negócio ganho ou perdido' },
  { valor: 'formulario_enviado', rotulo: 'Enviou um formulário' },
  { valor: 'pagamento_recebido', rotulo: 'Pagou uma cobrança' },
] as const;
export const rotuloEvento = (v: unknown) => EVENTOS_ESPERA.find((e) => e.valor === v)?.rotulo ?? 'evento';

export const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Operandos extras do If/Else (Q3.1). Campos personalizados entram dinamicamente. */
export const CAMPOS_CONDICAO_MOTOR = [
  { valor: 'contato.ownerId', rotulo: 'Contato · responsável (id)' },
  { valor: 'contato.naoPerturbe', rotulo: 'Contato · não perturbe (true ou false)' },
  { valor: 'contato.origem', rotulo: 'Contato · origem' },
  { valor: 'negocio.status', rotulo: 'Negócio · status' },
  { valor: 'negocio.ownerId', rotulo: 'Negócio · responsável (id)' },
  { valor: 'agora.diaSemana', rotulo: 'Agora · dia da semana (0 dom a 6 sáb)' },
  { valor: 'agora.hora', rotulo: 'Agora · hora (0 a 23)' },
  { valor: 'agora.data', rotulo: 'Agora · data (AAAA-MM-DD)' },
];

const RAMOS_EVENTO: Ramo[] = [
  { id: 'aconteceu', rotulo: 'Aconteceu', juncao: 'AND', regras: [] },
  { id: 'expirou', rotulo: 'Prazo expirou', juncao: 'AND', regras: [] },
];

/** Saídas dos nós novos. `undefined` = nó não é meu (o editor segue com a regra dele). */
export function ramosMotor(tipo: string, cfg: Record<string, unknown>): Ramo[] | null | undefined {
  if (tipo !== 'controle.esperar_ate') return undefined;
  return cfg.modo === 'evento' ? RAMOS_EVENTO : null;
}

/** Amanhã em AAAA-MM-DD (data inicial do modo "data"). */
export const amanha = () => {
  const d = new Date(Date.now() + 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Config inicial: o nó nasce publicável sempre que dá. */
export function configPadraoMotor(tipo: string): Record<string, unknown> | undefined {
  switch (tipo) {
    case 'controle.esperar_ate': return { modo: 'campo', campo: 'agendamento.inicio', deslocamento: 1, unidade: 'dias', direcao: 'antes', seJaPassou: 'seguir' };
    case 'controle.meta': return { evento: 'agendamento_criado', seNaoAtingida: 'seguir' };
    case 'acao.remover_de_fluxo': return { alvo: 'este', workflowIds: [] };
    case 'acao.atribuir_usuario': return { modo: 'rodizio', usuarios: [], soSemDono: true, negocio: false };
    case 'acao.nao_perturbe': return { ativar: true };
    case 'acao.atualizar_negocio': return { status: 'ganho', dono: 'manter', campos: [] };
    case 'gatilho.agendado': return { frequencia: 'diario', hora: '09:00', diasSemana: [1], diaMes: 1, alvo: 'sem_contato', tags: [] };
    case 'gatilho.data_contato': return { campo: 'contato.criadoEm', quando: 'no_dia', dias: 0, hora: '09:00', anual: true };
    case 'gatilho.formulario_enviado': return {};
    case 'gatilho.pagamento_recebido': return {};
    default: return undefined;
  }
}

/** Resumo no card do canvas. `undefined` = nó não é meu. */
export function resumirMotor(tipo: string, cfg: Record<string, any>): string | undefined {
  switch (tipo) {
    case 'controle.esperar_ate':
      if (cfg.modo === 'data') return cfg.data ? `até ${String(cfg.data).split('-').reverse().join('/')} ${cfg.hora ?? '09:00'}` : 'escolha a data';
      if (cfg.modo === 'evento') return `até: ${rotuloEvento(cfg.evento).toLowerCase()} (prazo ${cfg.duracao ?? '?'} ${cfg.unidade ?? ''})`;
      return cfg.campo ? `${cfg.deslocamento ?? 0} ${cfg.unidade ?? 'dias'} ${cfg.direcao === 'depois' ? 'depois' : 'antes'} de ${String(cfg.campo).replace('contato.campos.', '').replace('agendamento.inicio', 'agendamento')}` : 'escolha o campo';
    case 'controle.meta': return `meta: ${rotuloEvento(cfg.evento).toLowerCase()}`;
    case 'acao.remover_de_fluxo': return cfg.alvo === 'outros' ? `de ${(cfg.workflowIds ?? []).length} fluxo(s)` : cfg.alvo === 'todos' ? 'de todos os outros fluxos' : 'deste fluxo';
    case 'acao.atribuir_usuario': return cfg.modo === 'rodizio' ? `rodízio entre ${(cfg.usuarios ?? []).length}` : cfg.usuarioId ? 'responsável fixo' : 'escolha o responsável';
    case 'acao.nao_perturbe': return cfg.ativar === false ? 'desliga o não perturbe' : 'liga o não perturbe';
    case 'acao.atualizar_negocio': {
      const p = [cfg.status ? `status ${cfg.status}` : '', cfg.valor ? `valor ${cfg.valor}` : '', cfg.stageId ? 'etapa' : '', cfg.dono && cfg.dono !== 'manter' ? 'dono' : '', (cfg.campos ?? []).length ? 'campos' : ''].filter(Boolean);
      return p.join(' · ') || 'escolha o que mudar';
    }
    case 'acao.atualizar_contato': {
      const p = [cfg.campo ? `${cfg.campo} = ${cfg.valor ?? ''}` : '', (cfg.campos ?? []).length ? `${cfg.campos.length} campo(s)` : '', (cfg.tagsAdicionar ?? []).length ? `+${cfg.tagsAdicionar.length} tag` : '', (cfg.tagsRemover ?? []).length ? `-${cfg.tagsRemover.length} tag` : ''].filter(Boolean);
      return p.join(' · ') || 'escolha o que atualizar';
    }
    case 'gatilho.agendado': {
      const quando = cfg.frequencia === 'semanal' ? (cfg.diasSemana ?? []).map((d: number) => DIAS_SEMANA[d]).join(', ') : cfg.frequencia === 'mensal' ? `dia ${cfg.diaMes ?? 1}` : 'todo dia';
      return `${quando} às ${cfg.hora ?? '09:00'}${cfg.alvo === 'segmento' ? ' · segmento' : ''}`;
    }
    case 'gatilho.data_contato': {
      const campo = String(cfg.campo ?? '').replace('contato.campos.', '').replace('contato.criadoEm', 'cadastro');
      const quando = cfg.quando === 'no_dia' ? 'no dia' : `${cfg.dias ?? 0} dia(s) ${cfg.quando === 'antes' ? 'antes' : 'depois'}`;
      return `${quando} de ${campo || '?'} às ${cfg.hora ?? '09:00'}`;
    }
    case 'gatilho.formulario_enviado': return cfg.formId ? 'formulário específico' : 'qualquer formulário';
    case 'gatilho.pagamento_recebido': return cfg.valorMinimo ? `a partir de R$ ${cfg.valorMinimo}` : 'qualquer pagamento';
    default: return undefined;
  }
}
