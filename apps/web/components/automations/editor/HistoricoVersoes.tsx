'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Drawer, SkeletonRows } from '@/components/kit';
import { EmptyState, ErrorState } from '@/components/revenue/States';
import { automations, type VersaoResumo } from '@/lib/automations';

const quando = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

interface Props {
  open: boolean;
  onClose: () => void;
  workflowId: string;
  /** Versão aberta em modo leitura agora (destaca na lista). */
  visualizando: string | null;
  onVisualizar: (v: VersaoResumo) => void;
  onRestaurar: (v: VersaoResumo) => void;
  /** Muda a cada publicação/restauração, para a lista recarregar. */
  revisao: number;
}

/**
 * Histórico de versões publicadas (Q3.3). Cada publicação é imutável; daqui
 * dá para abrir qualquer uma no canvas em modo leitura e restaurá-la.
 */
export function HistoricoVersoes({ open, onClose, workflowId, visualizando, onVisualizar, onRestaurar, revisao }: Props) {
  const [versoes, setVersoes] = useState<VersaoResumo[] | null>(null);
  const [erro, setErro] = useState(false);

  const carregar = useCallback(() => {
    setErro(false);
    setVersoes(null);
    automations.versoes(workflowId).then(setVersoes).catch(() => setErro(true));
  }, [workflowId]);

  useEffect(() => {
    if (open) carregar();
  }, [open, carregar, revisao]);

  return (
    <Drawer open={open} onClose={onClose} title="Histórico de versões" description="Cada publicação fica guardada. Abra para conferir ou restaure." width="sm:max-w-md">
      {erro && <ErrorState title="Não consegui carregar as versões" description="Verifique a conexão e tente de novo." onRetry={carregar} />}
      {!erro && !versoes && <SkeletonRows rows={5} />}
      {!erro && versoes && versoes.length === 0 && (
        <EmptyState icon="history" title="Nenhuma versão publicada ainda" description="Quando você publicar, cada versão aparece aqui com data, autor e tamanho." />
      )}
      {!erro && versoes && versoes.length > 0 && (
        <ol className="space-y-2">
          {versoes.map((v) => (
            <li
              key={v.id}
              className={`rounded-xl border p-3 transition-colors ${visualizando === v.id ? 'border-brand bg-brand-softer' : 'border-line bg-surface'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-fg">Versão {v.versao}</p>
                {v.ativa && <span className="pill pill-success">No ar</span>}
              </div>
              <p className="mt-0.5 text-xs text-muted">
                {quando(v.publicadoEm)} · {v.autor?.nome ?? 'autor desconhecido'} · <span className="tabular">{v.nos}</span> {v.nos === 1 ? 'nó' : 'nós'}
              </p>
              <div className="mt-2.5 flex gap-2">
                <Button size="sm" variant="ghost" icon="eye" onClick={() => onVisualizar(v)} aria-label={`Ver a versão ${v.versao}`}>
                  {visualizando === v.id ? 'Aberta' : 'Ver'}
                </Button>
                <Button size="sm" variant="soft" icon="history" onClick={() => onRestaurar(v)} aria-label={`Restaurar a versão ${v.versao}`}>
                  Restaurar
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Drawer>
  );
}
