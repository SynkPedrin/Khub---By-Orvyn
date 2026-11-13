'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Confirm, SkeletonRows, useToast } from '@/components/kit';
import { Card } from '@/components/ui';
import { Icon } from '@/components/icons';
import { ErrorState } from '@/components/revenue/States';
import { automations, type RunDoContato } from '@/lib/automations';

const STATUS: Record<string, { rotulo: string; classe: string }> = {
  rodando: { rotulo: 'Em andamento', classe: 'pill-brand' },
  esperando: { rotulo: 'Esperando', classe: 'pill-info' },
  concluido: { rotulo: 'Concluído', classe: 'pill-success' },
  falhou: { rotulo: 'Erro', classe: 'pill-danger' },
  cancelado: { rotulo: 'Removido', classe: '' },
};

const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Seção "Automações" do perfil do contato (Q3.3): em quais fluxos ele está,
 * em que passo, e o botão para tirá-lo de um fluxo que ainda está correndo.
 */
export function AutomacoesDoContato({ contactId }: { contactId: string }) {
  const toast = useToast();
  const [runs, setRuns] = useState<RunDoContato[] | null>(null);
  const [erro, setErro] = useState(false);
  const [remover, setRemover] = useState<RunDoContato | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(() => {
    setErro(false);
    automations.runsDoContato(contactId).then(setRuns).catch(() => setErro(true));
  }, [contactId]);
  useEffect(() => { carregar(); }, [carregar]);

  const confirmar = async () => {
    if (!remover) return;
    setOcupado(true);
    try {
      const r = await automations.cancelar(remover.id);
      toast[r.cancelado ? 'success' : 'info'](r.cancelado ? `Removido de "${remover.workflowNome}".` : 'Essa execução já tinha terminado.');
      setRemover(null);
      carregar();
    } catch {
      toast.error('Não consegui remover o contato do fluxo.');
    } finally {
      setOcupado(false);
    }
  };

  const ativos = runs?.filter((r) => r.ativo).length ?? 0;

  return (
    <Card className="p-5">
      <h2 className="mb-3 font-bold text-fg">Automações{runs ? ` (${ativos} ${ativos === 1 ? 'ativa' : 'ativas'})` : ''}</h2>
      {erro && <ErrorState title="Não consegui carregar as automações" onRetry={carregar} />}
      {!erro && !runs && <SkeletonRows rows={3} label="Carregando automações do contato" />}
      {!erro && runs && runs.length === 0 && <p className="py-2 text-center text-sm text-muted">Este contato ainda não passou por nenhum fluxo.</p>}
      {!erro && runs && runs.length > 0 && (
        <ul className="space-y-2">
          {runs.map((r) => {
            const st = STATUS[r.status] ?? { rotulo: r.status, classe: '' };
            return (
              <li key={r.id} className="rounded-xl border border-line px-3 py-2.5">
                <div className="flex items-start gap-2">
                  <Link href={`/automacoes/${r.workflowId}/execucoes`} className="min-w-0 flex-1 hover:underline">
                    <span className="block truncate text-sm font-semibold text-fg">{r.workflowNome}</span>
                  </Link>
                  <span className={`pill shrink-0 ${st.classe}`}>{st.rotulo}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  {r.ativo && r.noAtualRotulo ? <>No passo <span className="font-medium text-fg">{r.noAtualRotulo}</span> · </> : null}
                  {r.teste ? 'teste · ' : ''}desde {quando(r.startedAt)}
                </p>
                {r.status === 'falhou' && r.erro && <p className="mt-1 line-clamp-2 text-xs text-danger">{r.erro}</p>}
                {r.ativo && (
                  <button type="button" onClick={() => setRemover(r)} className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-danger hover:underline">
                    <Icon name="close" size={12} /> Remover deste fluxo
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Confirm
        open={remover !== null}
        onClose={() => setRemover(null)}
        onConfirm={confirmar}
        loading={ocupado}
        title={`Remover do fluxo "${remover?.workflowNome ?? ''}"?`}
        description="A execução para agora: os próximos passos (mensagens, esperas, tarefas) não acontecem. O que já foi feito continua feito."
        confirmLabel="Remover do fluxo"
      />
    </Card>
  );
}
