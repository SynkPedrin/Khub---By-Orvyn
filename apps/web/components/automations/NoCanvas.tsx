'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { Icon, type IconName } from '@/components/icons';
import type { EstatisticaNo, Ramo } from '@/lib/automations';
import { SeloNo } from './marcas';

export interface DadosNo {
  tipo: string;
  nome: string;
  categoria: 'gatilho' | 'controle' | 'acao';
  resumo: string;
  ramos?: Ramo[];
  problema?: string;
  provider?: string;
  /** Contagem do período escolhido na barra (Q3.3). Ausente = estatística desligada. */
  stats?: EstatisticaNo;
  /** Config do nó: escolhe a logo real (canal, origem). */
  config?: Record<string, unknown>;
  /** O que o nó faz, em uma frase (catálogo) — aparece quando ainda não há resumo. */
  descricao?: string;
}

export const ICONE: Record<string, IconName> = {
  // gatilhos
  'gatilho.contato_criado': 'contacts',
  'gatilho.etapa_mudou': 'pipeline',
  'gatilho.negocio_criado': 'finance',
  'gatilho.negocio_status': 'trend',
  'gatilho.mensagem_recebida': 'inbox',
  'gatilho.tag_adicionada': 'sparkles',
  'gatilho.webhook': 'marketing',
  'gatilho.agendamento_criado': 'calendar',
  'gatilho.agendamento_confirmado': 'check',
  'gatilho.faltou': 'alert',
  'gatilho.agendamento_cancelado': 'close',
  'gatilho.lembrete_agendamento': 'bell',
  // controle
  'controle.esperar': 'calendar',
  'controle.esperar_resposta': 'inbox',
  'controle.condicao': 'filter',
  'controle.split': 'filter',
  'controle.drip': 'calendar',
  'controle.ir_para': 'arrowUp',
  'controle.encerrar': 'close',
  // ações
  'acao.enviar_sms': 'inbox',
  'acao.enviar_email': 'mail',
  'acao.notificar_equipe': 'bell',
  'acao.ia': 'sparkles',
  'acao.definir_variavel': 'settings',
  'acao.formatar_texto': 'settings',
  'acao.adicionar_tag': 'sparkles',
  'acao.remover_tag': 'close',
  'acao.atualizar_contato': 'user',
  'acao.criar_oportunidade': 'finance',
  'acao.mover_etapa': 'pipeline',
  'acao.criar_tarefa': 'check',
  'acao.criar_nota': 'knowledge',
  'acao.chamar_workflow': 'sparkles',
  'acao.webhook': 'marketing',
  'acao.pedir_avaliacao': 'star',
  // Q3.1 / Q3.2
  'gatilho.agendado': 'clock',
  'gatilho.data_contato': 'calendar',
  'gatilho.formulario_enviado': 'file',
  'gatilho.pagamento_recebido': 'dollar',
  'controle.esperar_ate': 'clock',
  'controle.meta': 'target',
  'acao.remover_de_fluxo': 'minus',
  'acao.atribuir_usuario': 'users',
  'acao.ativar_ia': 'ai',
  'acao.passar_humano': 'user',
  'acao.nao_perturbe': 'shield',
  'acao.atualizar_negocio': 'briefcase',
};

// Gatilho verde · controle roxo · ação azul, só como acento (o corpo é o card).
// Tokens semânticos do tema (ADR-0036): seguem claro/escuro sem cor literal.
export const ACENTO: Record<string, string> = { gatilho: 'var(--success)', controle: 'var(--brand)', acao: 'var(--info)' };

const HANDLE = '!h-2.5 !w-2.5 !border-2 !border-surface !bg-brand';

/** Resumo que ainda pede configuração ("defina a tag", "escolha a etapa"…). */
const PEDE_CONFIG = /^(defina|escolha|escreva|configure|informe)\b/i;

/**
 * Nó do canvas, fluxo da esquerda para a direita, como o construtor avançado
 * do GHL: entrada à esquerda, saída à direita. Gatilho não recebe conexão;
 * nó ramificado tem uma saída por ramo, empilhadas na lateral direita, na
 * ordem em que os ramos foram declarados (a de cima é o primeiro ramo).
 */
export const NoCanvas = memo(({ data, selected }: NodeProps<DadosNo>) => {
  const ehGatilho = data.categoria === 'gatilho';
  const ramos = data.ramos ?? [];
  const acento = ACENTO[data.categoria] ?? 'var(--brand)';
  const s = data.stats;

  const categoria = data.categoria === 'gatilho' ? 'Quando' : data.categoria === 'controle' ? 'Fluxo' : 'Faz';
  const oQueFaz = data.resumo || data.descricao || '';
  const incompleto = !data.problema && PEDE_CONFIG.test(data.resumo);

  return (
    <div
      className="w-60 rounded-[18px] border bg-surface transition-shadow"
      title={data.descricao}
      style={{
        borderColor: data.problema ? 'var(--danger)' : selected ? 'var(--brand)' : incompleto ? 'var(--warning-border)' : 'var(--border)',
        boxShadow: data.problema
          ? '0 0 0 1px var(--danger), 0 8px 26px -12px color-mix(in srgb, var(--danger) 50%, transparent)'
          : selected
            ? '0 0 0 1px var(--brand), 0 12px 32px -12px color-mix(in srgb, var(--brand) 45%, transparent)'
            : 'var(--sh-sm)',
      }}
    >
      {!ehGatilho && <Handle type="target" position={Position.Left} className={HANDLE} />}

      <div className="flex items-start gap-3 p-3">
        <SeloNo tipo={data.tipo} config={data.config} icone={ICONE[data.tipo] ?? 'sparkles'} acento={acento} tamanho={38} />
        <div className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-faint">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: acento }} aria-hidden />
            {categoria}
          </span>
          <p className="truncate text-sm font-semibold leading-tight text-fg">{data.nome}</p>
          {oQueFaz && (
            <p className={`mt-1 line-clamp-2 text-2xs leading-snug ${data.resumo ? 'text-muted' : 'text-faint'}`}>{oQueFaz}</p>
          )}
        </div>
      </div>

      {data.problema && (
        <p className="border-t border-danger-border bg-danger-soft px-3 py-1.5 text-2xs font-medium text-danger">
          {data.problema}
        </p>
      )}
      {incompleto && (
        <p className="flex items-center gap-1.5 border-t border-warning-border bg-warning-soft px-3 py-1.5 text-2xs font-medium text-warning">
          <Icon name="alert" size={12} /> Falta configurar: clique para abrir
        </p>
      )}

      {s && (
        <div className="flex items-center gap-3 border-t border-line px-3 py-1.5 text-2xs tabular" aria-label={`${s.concluidos} concluídos, ${s.esperando} esperando, ${s.erros} com erro`}>
          <span className="inline-flex items-center gap-1 text-success" title="Passaram por aqui com sucesso no período">
            <Icon name="check" size={12} /> {s.concluidos}
          </span>
          <span className="inline-flex items-center gap-1 text-muted" title="Parados neste passo agora">
            <Icon name="clock" size={12} /> {s.esperando}
          </span>
          <span className={`inline-flex items-center gap-1 ${s.erros ? 'text-danger' : 'text-muted'}`} title="Falharam neste passo no período">
            <Icon name="alert" size={12} /> {s.erros}
          </span>
        </div>
      )}

      {/* Nó ramificado: uma saída por ramo, rotulada, empilhada na lateral direita */}
      {ramos.length > 0 ? (
        <div className="divide-y divide-line border-t border-line">
          {ramos.map((r, i) => (
            <div key={r.id} className="relative flex items-center justify-end gap-1.5 py-1.5 pl-3 pr-4 text-2xs">
              <span className="min-w-0 truncate font-medium text-fg">{r.rotulo || `Ramo ${i + 1}`}</span>
              <Icon name="arrowRight" size={11} className="shrink-0 text-faint" />
              <Handle id={r.id} type="source" position={Position.Right} className={HANDLE} />
            </div>
          ))}
        </div>
      ) : (
        <Handle type="source" position={Position.Right} className={HANDLE} />
      )}
    </div>
  );
});

NoCanvas.displayName = 'NoCanvas';
