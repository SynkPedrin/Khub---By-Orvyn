'use client';

import { useEffect, useId, useState } from 'react';
import { Button, Modal } from '@/components/kit';
import { cx } from '@/components/ui';

interface Props {
  open: boolean;
  onClose: () => void;
  atual: string | null;
  /** Pastas que já existem no tenant (para escolher com um clique). */
  existentes: string[];
  onMover: (pasta: string | null) => Promise<void>;
}

/** Mover um fluxo para uma pasta (Q3.3): escolhe uma existente ou cria digitando. */
export function MoverParaPasta({ open, onClose, atual, existentes, onMover }: Props) {
  const [pasta, setPasta] = useState(atual ?? '');
  const [salvando, setSalvando] = useState(false);
  const listaId = useId();
  useEffect(() => {
    if (open) setPasta(atual ?? '');
  }, [open, atual]);

  const limpa = pasta.trim().slice(0, 60);
  const confirmar = async (destino: string | null) => {
    setSalvando(true);
    try {
      await onMover(destino);
      onClose();
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Mover para pasta"
      description="Cada fluxo mora em uma pasta. Escreva um nome novo para criar."
      size="sm"
      footer={
        <>
          {atual && (
            <Button variant="ghost" onClick={() => void confirmar(null)} disabled={salvando} className="mr-auto">
              Tirar da pasta
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button variant="primary" loading={salvando} disabled={!limpa || limpa === atual} onClick={() => void confirmar(limpa)}>
            Mover
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (limpa && limpa !== atual) void confirmar(limpa);
        }}
      >
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-fg">Pasta</span>
          <input className="input" value={pasta} onChange={(e) => setPasta(e.target.value)} list={listaId} maxLength={60} placeholder="Ex.: Pós-venda" autoFocus />
          <datalist id={listaId}>
            {existentes.map((p) => <option key={p} value={p} />)}
          </datalist>
        </label>
        {existentes.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {existentes.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPasta(p)}
                className={cx('pill', p === limpa ? 'pill-brand' : 'hover:bg-surface3')}
              >
                {p}
              </button>
            ))}
          </div>
        )}
      </form>
    </Modal>
  );
}
