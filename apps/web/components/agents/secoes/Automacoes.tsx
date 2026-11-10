'use client';

import Link from 'next/link';
import { Icon } from '@/components/icons';
import { RegrasEditor } from './Regras';
import type { SecaoProps } from '../editor';

/** Automation Builder do agente: regras SE/ENTÃO com ações no CRM. */
export function Automacoes(props: SecaoProps) {
  const ferramentasDesligadas = ['adicionar_tag', 'remover_tag', 'acionar_workflow', 'mover_etapa', 'notificar_equipe'].filter((f) => !props.agente.ferramentas.includes(f));
  return (
    <div className="space-y-5">
      <div className="card flex flex-wrap items-start gap-3 p-4 text-[13.5px] text-muted">
        <span className="icon-tile icon-tile-info h-8 w-8 rounded-lg"><Icon name="info" size={15} /></span>
        <div className="min-w-0 flex-1 space-y-1">
          <p>Automações do agente reagem à análise de cada mensagem (intenção, objeção, sentimento, perfil). Para fluxos longos com esperas e ramificações, use as <Link href="/automacoes" className="font-medium text-brand hover:underline">automações da conta</Link> e acione-as daqui com &quot;Acionar workflow&quot;.</p>
          {ferramentasDesligadas.length > 0 && <p className="text-xs">Ferramentas desligadas para este agente (a regra será recusada até ligar na aba Ferramentas): {ferramentasDesligadas.join(', ')}.</p>}
        </div>
      </div>
      <RegrasEditor {...props} modo="automacao" />
    </div>
  );
}
