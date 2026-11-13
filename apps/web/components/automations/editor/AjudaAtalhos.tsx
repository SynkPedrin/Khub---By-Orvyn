'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/kit';
import { ATALHOS } from '@/lib/automations-editor';

/** O "?" do editor: lista dos atalhos, com Ctrl ou ⌘ conforme o sistema. */
export function AjudaAtalhos({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mod, setMod] = useState('Ctrl');
  useEffect(() => {
    try {
      if (/mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)) setMod('⌘');
    } catch {
      /* navegador sem navigator: mantém Ctrl */
    }
  }, []);

  return (
    <Modal open={open} onClose={onClose} title="Atalhos do editor" description="Funcionam com o foco no canvas, fora dos campos de texto." size="md">
      <ul className="divide-y divide-line">
        {ATALHOS.map((a) => (
          <li key={a.descricao} className="flex items-center justify-between gap-4 py-2.5">
            <span className="text-sm text-fg">{a.descricao}</span>
            <span className="flex shrink-0 items-center gap-1">
              {a.teclas.map((t) => (
                <kbd key={t} className="rounded-md border border-line bg-surface2 px-1.5 py-0.5 font-mono text-xs text-fg">
                  {t === 'mod' ? mod : t}
                </kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
