'use client';

import { useEffect, useState } from 'react';
import { Field } from '@/components/ui';
import { settingsApi, type Member } from '@/lib/settings';
import { TIPO_LABEL, TIPO_ORDEM } from './agenda-utils';

/** Gatilhos de agenda (migration 054): filtro opcional por tipo e responsável. */
export const GATILHOS_AGENDA = [
  'gatilho.agendamento_criado',
  'gatilho.agendamento_confirmado',
  'gatilho.faltou',
  'gatilho.agendamento_cancelado',
  'gatilho.lembrete_agendamento',
] as const;

export const ehGatilhoAgenda = (tipo: string): boolean => (GATILHOS_AGENDA as readonly string[]).includes(tipo);

/**
 * Configuração dos gatilhos de agenda no editor de automações. Vazio = qualquer
 * compromisso. As variáveis {{agendamento.*}} ficam listadas para o usuário
 * saber o que pode usar nas mensagens seguintes.
 */
export function FiltroGatilhoAgenda({
  tipo,
  responsavelId,
  onChange,
}: {
  tipo?: string;
  responsavelId?: string;
  onChange: (patch: { tipo?: string; responsavelId?: string }) => void;
}) {
  const [membros, setMembros] = useState<Member[]>([]);
  useEffect(() => {
    settingsApi
      .members()
      .then((r) => setMembros(r.members))
      .catch(() => setMembros([]));
  }, []);

  return (
    <>
      <Field label="Tipo de compromisso" hint="Vazio = qualquer tipo.">
        <select className="input" value={tipo ?? ''} onChange={(e) => onChange({ tipo: e.target.value || undefined })}>
          <option value="">Qualquer tipo</option>
          {TIPO_ORDEM.map((t) => (
            <option key={t} value={t}>
              {TIPO_LABEL[t]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Responsável" hint="Vazio = qualquer membro e a agenda geral.">
        <select className="input" value={responsavelId ?? ''} onChange={(e) => onChange({ responsavelId: e.target.value || undefined })}>
          <option value="">Qualquer responsável</option>
          {membros.map((m) => (
            <option key={m.identityId} value={m.identityId}>
              {m.nome || m.email}
            </option>
          ))}
        </select>
      </Field>
      <p className="rounded-lg bg-brand-softer px-3 py-2 text-2xs leading-snug text-muted">
        Use nas mensagens: <code>{'{{agendamento.titulo}}'}</code>, <code>{'{{agendamento.data}}'}</code>, <code>{'{{agendamento.hora}}'}</code>, <code>{'{{agendamento.local}}'}</code> e{' '}
        <code>{'{{agendamento.dataExtenso}}'}</code>.
      </p>
    </>
  );
}
