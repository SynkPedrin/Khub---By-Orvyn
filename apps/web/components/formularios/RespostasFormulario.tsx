'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button, SkeletonRows, useToast } from '@/components/kit';
import { EmptyState, ErrorState } from '@/components/revenue/States';
import { formularios, mensagemDeErro, type Envio, type Formulario } from '@/lib/formularios';

const quando = (iso: string) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

function texto(v: unknown): string {
  if (v === undefined || v === null || v === '') return '';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  return String(v);
}

/** Aba Respostas: tabela paginada por cursor + exportação CSV gerada no servidor. */
export function RespostasFormulario({ form }: { form: Formulario }) {
  const toast = useToast();
  const [itens, setItens] = useState<Envio[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [erro, setErro] = useState(false);
  const [mais, setMais] = useState(false);
  const [exportando, setExportando] = useState(false);
  const colunas = form.campos.filter((c) => c.tipo !== 'consentimento').slice(0, 6);

  const carregar = useCallback(() => {
    setErro(false);
    formularios.respostas(form.id).then((r) => { setItens(r.items); setCursor(r.nextCursor); }).catch(() => setErro(true));
  }, [form.id]);
  useEffect(carregar, [carregar]);

  async function carregarMais() {
    if (!cursor) return;
    setMais(true);
    try {
      const r = await formularios.respostas(form.id, cursor);
      setItens((l) => [...(l ?? []), ...r.items]);
      setCursor(r.nextCursor);
    } catch (x) {
      toast.error(mensagemDeErro(x, 'Não foi possível carregar mais respostas.'));
    } finally {
      setMais(false);
    }
  }

  async function exportar() {
    setExportando(true);
    try {
      await formularios.exportarCsv(form.id, form.slug);
      toast.success('Exportação pronta');
    } catch (x) {
      toast.error(mensagemDeErro(x, 'Não foi possível exportar.'));
    } finally {
      setExportando(false);
    }
  }

  if (erro) return <ErrorState onRetry={carregar} />;
  if (itens === null) return <div className="card p-4"><SkeletonRows rows={5} /></div>;
  if (itens.length === 0) return <EmptyState icon="list" title="Nenhuma resposta ainda" description="Compartilhe o link ou coloque o formulário no seu site. As respostas aparecem aqui na hora." />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted"><span className="tabular font-semibold text-fg">{form.totalRespostas}</span> resposta(s)</p>
        <Button size="sm" icon="download" loading={exportando} onClick={() => void exportar()}>Exportar CSV</Button>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
            <tr>
              <th scope="col" className="whitespace-nowrap px-4 py-3 font-semibold">Recebida</th>
              {colunas.map((c) => <th key={c.id} scope="col" className="px-4 py-3 font-semibold">{c.rotulo}</th>)}
              <th scope="col" className="px-4 py-3 font-semibold">Origem</th>
              <th scope="col" className="px-4 py-3"><span className="sr-only">Contato</span></th>
            </tr>
          </thead>
          <tbody>
            {itens.map((e) => (
              <tr key={e.id} className="border-b border-line align-top last:border-0">
                <td className="tabular whitespace-nowrap px-4 py-3 text-muted">{quando(e.createdAt)}</td>
                {colunas.map((c) => <td key={c.id} className="max-w-[240px] truncate px-4 py-3 text-fg" title={texto(e.respostas[c.id])}>{texto(e.respostas[c.id])}</td>)}
                <td className="px-4 py-3 text-muted">{e.utm.utm_source ?? (e.utm.referrer ? new URL(e.utm.referrer).hostname : 'Direto')}</td>
                <td className="px-4 py-3 text-right">
                  {e.contactId && <Link href={`/contatos/${e.contactId}`} className="text-sm font-medium text-brand hover:underline">Ver contato</Link>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cursor && (
        <div className="flex justify-center">
          <Button variant="ghost" loading={mais} onClick={() => void carregarMais()}>Carregar mais</Button>
        </div>
      )}
    </div>
  );
}
