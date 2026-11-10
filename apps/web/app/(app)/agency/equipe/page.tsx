'use client';

import { useEffect, useState } from 'react';
import { AgencyInvites } from '@/components/agency/AgencyInvites';
import { Avatar } from '@/components/ui';
import { PageShell, PageHeader, Section } from '@/components/revenue/Page';
import { EmptyState } from '@/components/revenue/States';
import { Quando } from '@/components/revenue/Quando';
import { agency, type MembroAgencia } from '@/lib/agency';

const ROLE_LABEL: Record<string, string> = { owner: 'Owner', admin: 'Admin', member: 'Membro', viewer: 'Visualizador' };

/**
 * V1 (seção 26 do brief): só listagem. Convite sofisticado fica pra depois —
 * o fluxo de invite que já existe é por TENANT (Invite model, aceite via
 * link), não por agência; reaproveitá-lo aqui exigiria decisão de produto
 * sobre em qual tenant o convite "vive", que não estava no escopo desta
 * sprint. Documentado, não inventado.
 */
export default function AgencyEquipePage() {
  const [membros, setMembros] = useState<MembroAgencia[] | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    agency.listarMembros().then(setMembros).catch(() => setErro(true));
  }, []);

  return (
    <PageShell>
      <PageHeader title="Equipe" subtitle="Quem tem acesso a esta agência." />

      <AgencyInvites />
      <Section title="Membros">
        {erro ? (
          <EmptyState icon="alert" title="Não foi possível carregar" description="Tente novamente em instantes." />
        ) : !membros ? (
          <div className="space-y-2">
            {[0, 1].map((i) => <div key={i} className="skeleton h-12 rounded-md" />)}
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {membros.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-3">
                <Avatar name={m.email} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-fg">{m.email}</p>
                  <p className="text-xs text-muted">
                    Membro desde <Quando data={m.createdAt} formato="data" />
                  </p>
                </div>
                <span className="pill shrink-0">{ROLE_LABEL[m.role] ?? m.role}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </PageShell>
  );
}
