'use client';

import { useState } from 'react';
import { cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { tamanhoLegivel, type AnexoMensagem } from '@/lib/inbox';

/**
 * Anexo de saída na bolha (Q2.5). A URL é assinada e vale 1 h: a thread é
 * recarregada ao abrir a conversa, então a tela sempre recebe uma nova. Sem
 * URL = o arquivo foi em base64 direto ao WhatsApp e não há cópia guardada.
 */
export function AnexoBolha({ anexo, claro }: { anexo: AnexoMensagem; claro: boolean }) {
  const [imagemFalhou, setImagemFalhou] = useState(false);
  const tom = claro ? 'text-white/80' : 'text-muted';

  if (anexo.figurinha && anexo.url && !imagemFalhou) {
    // Figurinha do WhatsApp: fundo transparente, tamanho fixo, sem moldura.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={anexo.url} alt="Figurinha" width={128} height={128} className="mb-1 h-32 w-32 object-contain" onError={() => setImagemFalhou(true)} />;
  }
  if (anexo.tipo === 'imagem' && anexo.url && !imagemFalhou) {
    return (
      <a href={anexo.url} target="_blank" rel="noreferrer" className="mb-1 block overflow-hidden rounded-xl">
        {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada externa (storage), fora do otimizador do Next */}
        <img src={anexo.url} alt={anexo.nome} className="max-h-64 w-full object-cover" onError={() => setImagemFalhou(true)} />
      </a>
    );
  }
  if (anexo.tipo === 'audio' && anexo.url) {
    return <audio controls preload="none" src={anexo.url} className="mb-1 w-64 max-w-full" aria-label={anexo.nome} />;
  }

  const conteudo = (
    <>
      <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-lg', claro ? 'bg-white/15' : 'bg-[var(--fill-4)]')}>
        <Icon name={anexo.tipo === 'audio' ? 'play' : 'file'} size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{anexo.nome}</span>
        <span className={cx('block text-xs', tom)}>
          {tamanhoLegivel(anexo.tamanho)}
          {anexo.url ? '' : ' · enviado direto pelo WhatsApp'}
        </span>
      </span>
      {anexo.url && <Icon name="download" size={15} className={tom} />}
    </>
  );
  return anexo.url ? (
    <a href={anexo.url} target="_blank" rel="noreferrer" download={anexo.nome} className={cx('mb-1 flex items-center gap-2.5 rounded-xl px-2.5 py-2', claro ? 'bg-white/10 hover:bg-white/15' : 'border border-line hover:bg-[var(--fill-4)]')}>
      {conteudo}
    </a>
  ) : (
    <div className={cx('mb-1 flex items-center gap-2.5 rounded-xl px-2.5 py-2', claro ? 'bg-white/10' : 'border border-line')}>{conteudo}</div>
  );
}
