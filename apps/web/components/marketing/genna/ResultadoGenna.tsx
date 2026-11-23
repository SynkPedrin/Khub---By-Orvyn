'use client';

import { useState } from 'react';
import { Card } from '@/components/ui';
import { Icon } from '@/components/icons';
import { Markdown } from '@/components/Markdown';
import type { ResultadoGenna as Resultado } from '@/lib/genna';
import { ehImagem, ehUrl, formaDosDados, rotulo, textoValor, type Tabela } from '@/lib/genna-formato';

const MAX_LINHAS = 50;

function Celula({ v }: { v: unknown }) {
  if (ehImagem(v)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={v} alt="" className="h-12 w-12 rounded-lg object-cover" loading="lazy" />;
  }
  if (ehUrl(v)) {
    return (
      <a href={v} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand underline">
        abrir <Icon name="external" size={12} />
      </a>
    );
  }
  const t = textoValor(v);
  return <span className={typeof v === 'number' ? 'tabular' : 'line-clamp-3'}>{t}</span>;
}

function TabelaDados({ t }: { t: Tabela }) {
  const [todas, setTodas] = useState(false);
  const linhas = todas ? t.linhas : t.linhas.slice(0, MAX_LINHAS);
  return (
    <div className="space-y-2">
      {t.titulo && <h3 className="text-sm font-semibold text-fg">{t.titulo} <span className="font-normal text-muted">({t.linhas.length})</span></h3>}
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead className="bg-surface2 text-xs text-muted">
            <tr>{t.colunas.map((c) => <th key={c} scope="col" className="px-3 py-2 font-medium">{rotulo(c)}</th>)}</tr>
          </thead>
          <tbody>
            {linhas.map((l, i) => (
              <tr key={i} className="border-t border-line align-top">
                {t.colunas.map((c) => <td key={c} className={typeof l[c] === 'number' ? 'px-3 py-2 text-right' : 'max-w-[320px] px-3 py-2'}><Celula v={l[c]} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {t.linhas.length > MAX_LINHAS && !todas && (
        <button onClick={() => setTodas(true)} className="text-xs font-semibold text-brand underline">Mostrar as {t.linhas.length} linhas</button>
      )}
    </div>
  );
}

/** Resultado de uma ferramenta do Genna: texto, números, tabelas, imagens e links. */
export function ResultadoGenna({ r }: { r: Resultado }) {
  const forma = formaDosDados(r.dados);
  // Quando o Genna manda o mesmo conteúdo como texto JSON e como dado, não repete o JSON cru.
  const textoEhJson = !!r.dados && /^\s*[[{]/.test(r.texto);
  const vazio = !r.texto && !forma.destaques.length && !forma.tabelas.length && !forma.resto && !r.imagens.length && !r.links.length;

  return (
    <div className="space-y-4">
      {!r.ok && (
        <p role="alert" className="flex items-start gap-2 rounded-xl bg-danger/5 px-4 py-3 text-sm text-danger">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0" /> O Genna devolveu um erro nesta consulta.
        </p>
      )}
      {forma.destaques.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {forma.destaques.map((d) => (
            <Card key={d.chave} className="p-4">
              <p className="text-xs font-medium text-muted">{rotulo(d.chave.replace('.', ' '))}</p>
              <p className={typeof d.valor === 'number' ? 'mt-1 text-2xl font-semibold tabular text-fg' : 'mt-1 break-words text-sm font-medium text-fg'}>{textoValor(d.valor)}</p>
            </Card>
          ))}
        </div>
      )}
      {forma.tabelas.map((t, i) => <TabelaDados key={i} t={t} />)}
      {r.imagens.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {r.imagens.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={src} alt={`Imagem ${i + 1} devolvida pelo Genna`} className="w-full rounded-xl border border-line object-cover" />
          ))}
        </div>
      )}
      {r.texto && !textoEhJson && (
        <Card className="p-4 text-sm">
          <Markdown>{r.texto}</Markdown>
        </Card>
      )}
      {forma.resto && (
        <details className="rounded-xl border border-line">
          <summary className="cursor-pointer px-4 py-2 text-xs font-semibold text-muted">Dados completos</summary>
          <pre className="max-h-96 overflow-auto px-4 pb-4 text-xs">{JSON.stringify(forma.resto, null, 2)}</pre>
        </details>
      )}
      {r.links.length > 0 && (
        <ul className="space-y-1 text-sm">
          {r.links.map((l) => (
            <li key={l}><a href={l} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand underline">{l} <Icon name="external" size={12} /></a></li>
          ))}
        </ul>
      )}
      {vazio && <p className="text-sm text-muted">O Genna não devolveu dados para esta consulta.</p>}
    </div>
  );
}
