'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { Icon, type IconName } from '@/components/icons';
import type { Ramo } from '@/lib/automations';

export interface DadosNo {
  tipo: string;
  nome: string;
  categoria: 'gatilho' | 'controle' | 'acao';
  resumo: string;
  ramos?: Ramo[];
  problema?: string;
  provider?: string;
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
};

// Gatilho verde · controle roxo · ação azul — só como acento (o corpo é roxo/glow).
export const ACENTO: Record<string, string> = { gatilho: '#10B981', controle: '#7B2EFF', acao: '#3B82F6' };

/** Nó do canvas. Gatilho não recebe conexão; condição tem uma saída por ramo. */
export const NoCanvas = memo(({ data, selected }: NodeProps<DadosNo>) => {
  const ehGatilho = data.categoria === 'gatilho';
  const ramos = data.ramos ?? [];
  const acento = ACENTO[data.categoria] ?? 'var(--brand)';

  return (
    <div
      className="w-60 rounded-2xl border bg-surface transition-shadow"
      style={{
        borderColor: data.problema ? '#ef4444' : selected ? 'var(--brand)' : 'color-mix(in srgb, var(--brand) 28%, var(--border))',
        boxShadow: data.problema
          ? '0 0 0 1px #ef4444, 0 8px 26px -12px rgba(239,68,68,.5)'
          : selected
            ? '0 0 0 1px var(--brand), 0 12px 34px -10px var(--glow)'
            : '0 8px 26px -14px var(--glow), inset 0 1px 0 rgba(255,255,255,.4)',
      }}
    >
      {!ehGatilho && <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-2 !border-surface !bg-brand" />}

      <div className="flex items-start gap-2.5 p-3">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
          style={{
            color: acento,
            background: `color-mix(in srgb, ${acento} 14%, transparent)`,
            boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${acento} 34%, transparent), 0 0 16px -4px color-mix(in srgb, ${acento} 60%, transparent)`,
          }}
        >
          <Icon name={ICONE[data.tipo] ?? 'sparkles'} size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: acento }}>
            {data.categoria === 'gatilho' ? 'Gatilho' : data.categoria === 'controle' ? 'Controle' : 'Ação'}
          </span>
          <p className="truncate text-sm font-bold leading-tight text-fg">{data.nome}</p>
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted">{data.resumo}</p>
        </div>
      </div>

      {data.problema && (
        <p className="border-t border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[10px] font-medium text-red-600 dark:text-red-400">
          {data.problema}
        </p>
      )}

      {data.provider && (
        <p className="border-t border-line px-3 py-1 text-[10px] text-muted">
          entrega via <span className="font-semibold">{data.provider}</span>
        </p>
      )}

      {/* Condição: uma saída por ramo, rotulada */}
      {ramos.length > 0 ? (
        <div className="border-t border-line">
          {ramos.map((r, i) => (
            <div key={r.id} className="relative flex items-center justify-between px-3 py-1.5 text-[11px]">
              <span className="truncate text-fg">{r.rotulo || `Ramo ${i + 1}`}</span>
              <span className="ml-2 shrink-0 rounded bg-surface2 px-1 text-[9px] font-bold text-muted">{r.juncao}</span>
              <Handle
                id={r.id}
                type="source"
                position={Position.Right}
                style={{ top: '50%' }}
                className="!h-2.5 !w-2.5 !border-2 !border-surface !bg-violet-500"
              />
            </div>
          ))}
        </div>
      ) : (
        <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-2 !border-surface !bg-brand" />
      )}
    </div>
  );
});

NoCanvas.displayName = 'NoCanvas';
