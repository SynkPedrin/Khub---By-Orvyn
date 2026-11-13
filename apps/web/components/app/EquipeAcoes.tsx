'use client';

import { useState } from 'react';
import { Card } from '@/components/ui';
import { Icon } from '@/components/icons';
import { Button, Confirm, useToast } from '@/components/kit';
import { settingsApi, type Member } from '@/lib/settings';

/**
 * Remover membro da equipe (SEC-01 · ADR-0042). O acesso cai na hora e as
 * sessões dele neste cliente são encerradas. Esconde o botão na própria linha.
 */
export function RemoverMembro({ membro, euEmail, onRemovido }: { membro: Member; euEmail?: string; onRemovido: () => void }) {
  const toast = useToast();
  const [aberto, setAberto] = useState(false);
  const [busy, setBusy] = useState(false);
  if (euEmail && membro.email.toLowerCase() === euEmail.toLowerCase()) return null;
  const nome = membro.nome ?? membro.email;

  const remover = async () => {
    setBusy(true);
    try {
      const r = await settingsApi.removeMember(membro.identityId);
      toast.success(`${nome} foi removido da equipe`, { description: `${r.sessoesRevogadas} sessão(ões) encerrada(s)${r.conversasLiberadas ? ` e ${r.conversasLiberadas} conversa(s) voltaram para a fila` : ''}.` });
      setAberto(false);
      onRemovido();
    } catch (e) {
      toast.error('Não foi possível remover', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button onClick={() => setAberto(true)} className="rounded-lg p-1.5 text-muted hover:bg-surface2 hover:text-red-500" aria-label={`Remover ${nome} da equipe`} title="Remover da equipe">
        <Icon name="trash" size={15} />
      </button>
      <Confirm
        open={aberto}
        onClose={() => setAberto(false)}
        onConfirm={remover}
        loading={busy}
        title={`Remover ${nome}?`}
        description="A pessoa perde o acesso a esta operação imediatamente e todas as sessões dela aqui são encerradas. As conversas atribuídas a ela voltam para a fila. O histórico (mensagens enviadas, auditoria) é mantido. Você pode convidá-la de novo depois."
        confirmLabel="Remover da equipe"
      />
    </>
  );
}

/** "Sair de todos os dispositivos": encerra todas as sessões da conta e volta para o login. */
export function EncerrarSessoes() {
  const toast = useToast();
  const [aberto, setAberto] = useState(false);
  const [busy, setBusy] = useState(false);

  const encerrar = async () => {
    setBusy(true);
    try {
      await settingsApi.revokeAllSessions();
      await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
      window.location.href = '/login';
    } catch (e) {
      toast.error('Não foi possível encerrar as sessões', { description: e instanceof Error ? e.message : undefined });
      setBusy(false);
    }
  };

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-bold text-fg">Sessões</h2>
          <p className="mt-1 text-sm text-muted">Perdeu um aparelho ou entrou num computador que não é seu? Encerre o acesso em todos os dispositivos, inclusive este.</p>
        </div>
        <Button variant="secondary" onClick={() => setAberto(true)}><Icon name="logout" size={16} /> Sair de todos os dispositivos</Button>
      </div>
      <Confirm
        open={aberto}
        onClose={() => setAberto(false)}
        onConfirm={encerrar}
        loading={busy}
        tone="primary"
        title="Sair de todos os dispositivos?"
        description="Todas as sessões da sua conta serão encerradas, em todas as empresas que você acessa. Você vai precisar entrar de novo."
        confirmLabel="Encerrar sessões"
      />
    </Card>
  );
}
