'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, Field, Input } from '@/components/ui';
import { Icon } from '@/components/icons';
import { ConfigRequired } from '@/components/app/ConfigRequired';
import { ApiError } from '@/lib/api-error';
import { financeiro, type Cobranca, type ResumoFinanceiro } from '@/lib/financeiro';
import { Confirm, SkeletonRows } from '@/components/kit';
import { Paginacao, usePaginacao } from '@/components/kit';
import { falhaDeCarga, mensagemFin, money, parseValor, type FalhaCarga } from './fin-utils';
import { FinAviso, FinFalha } from './FinEstado';

const STATUS: Record<Cobranca['status'], { label: string; tone: 'green' | 'amber' | 'brand' | 'neutral' }> = {
  rascunho: { label: 'rascunho', tone: 'neutral' },
  enviada: { label: 'enviada', tone: 'brand' },
  paga: { label: 'paga', tone: 'green' },
  vencida: { label: 'vencida', tone: 'amber' },
  cancelada: { label: 'cancelada', tone: 'neutral' },
};

/**
 * Cobranças a clientes (Stripe gated para link de pagamento). Cobrança paga
 * vira entrada no fluxo de caixa automaticamente.
 */
export function FinCobrancas({ onMudou }: { onMudou: () => void }) {
  const [resumo, setResumo] = useState<ResumoFinanceiro | null>(null);
  const [cobrancas, setCobrancas] = useState<Cobranca[] | null>(null);
  const pg = usePaginacao(cobrancas, 25);
  const [novo, setNovo] = useState(false);
  const [form, setForm] = useState({ descricao: '', valor: '', vencimento: '' });
  const [gated, setGated] = useState<{ provider: string; missing: string[] } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [falha, setFalha] = useState<FalhaCarga | null>(null);
  const [excluir, setExcluir] = useState<Cobranca | null>(null);

  const load = () => {
    setFalha(null);
    Promise.all([financeiro.resumo(), financeiro.cobrancas()])
      .then(([r, c]) => { setResumo(r); setCobrancas(c); })
      .catch((e) => setFalha(falhaDeCarga(e, 'as cobranças')));
  };
  useEffect(load, []);

  const criar = async () => {
    const valorCentavos = parseValor(form.valor);
    if (!form.descricao.trim()) { setMsg('Preencha a descrição.'); return; }
    if (valorCentavos <= 0) { setMsg('Informe um valor válido, por exemplo 199,90.'); return; }
    setBusy('criar'); setMsg(null);
    try {
      await financeiro.criar({ descricao: form.descricao.trim(), valorCentavos, vencimento: form.vencimento || undefined, enviar: true });
      setForm({ descricao: '', valor: '', vencimento: '' }); setNovo(false); load();
    } catch (e) { setMsg(mensagemFin(e, 'criar a cobrança')); } finally { setBusy(null); }
  };

  const marcar = async (id: string, status: 'paga' | 'cancelada') => {
    setBusy(id); setMsg(null);
    try {
      await financeiro.status(id, status);
      load(); onMudou(); // paga vira entrada no caixa: a visão geral precisa recarregar
    } catch (e) { setMsg(mensagemFin(e, status === 'paga' ? 'marcar a cobrança como paga' : 'cancelar a cobrança')); } finally { setBusy(null); }
  };
  const confirmarExclusao = async () => {
    if (!excluir) return;
    setBusy('excluir'); setMsg(null);
    try {
      await financeiro.remover(excluir.id);
      setExcluir(null);
      load();
    } catch (e) {
      setExcluir(null);
      setMsg(mensagemFin(e, 'excluir a cobrança'));
    } finally { setBusy(null); }
  };

  if (falha) return <Card><FinFalha falha={falha} onTentar={load} /></Card>;

  const gerarLink = async (c: Cobranca) => {
    setGated(null); setMsg(null); setBusy(c.id);
    try {
      const { url } = await financeiro.linkPagamento(c.id);
      window.open(url, '_blank', 'noopener');
      load();
    } catch (e) {
      const cr = e instanceof ApiError ? e.configRequired : null;
      if (cr) setGated(cr);
      else setMsg('Não consegui gerar o link de pagamento.');
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      {gated && <ConfigRequired provider={gated.provider} missing={gated.missing} />}
      {msg && <FinAviso texto={msg} />}

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { l: 'Recebido em cobranças', v: resumo ? money(resumo.recebidoCentavos) : '–', cor: 'text-emerald-600 dark:text-emerald-400' },
          { l: 'A receber', v: resumo ? money(resumo.aReceberCentavos) : '–', cor: 'text-fg' },
          { l: 'Vencido', v: resumo ? money(resumo.vencidoCentavos) : '–', cor: 'text-amber-600 dark:text-amber-400' },
        ].map((k) => (
          <Card key={k.l} className="p-4">
            <p className="text-xs font-medium text-muted">{k.l}</p>
            <p className={`mt-2 text-2xl font-semibold ${k.cor}`}>{k.v}</p>
          </Card>
        ))}
      </div>

      <div className="flex justify-end">
        <Button onClick={() => setNovo((v) => !v)}><Icon name="plus" size={16} /> Nova cobrança</Button>
      </div>

      {novo && (
        <Card className="p-6">
          <h2 className="mb-3 font-bold text-fg">Nova cobrança</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-1"><Field label="Descrição"><Input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="Consulta / Mensalidade" autoFocus /></Field></div>
            <Field label="Valor (R$)"><Input value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} placeholder="199,90" inputMode="decimal" /></Field>
            <Field label="Vencimento"><Input type="date" value={form.vencimento} onChange={(e) => setForm({ ...form, vencimento: e.target.value })} /></Field>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setNovo(false)}>Cancelar</Button>
            <Button onClick={criar} disabled={busy === 'criar'}>{busy === 'criar' ? 'Criando…' : 'Criar cobrança'}</Button>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <div className="border-b border-line px-5 py-3"><h2 className="font-bold text-fg">Cobranças</h2></div>
        <div className="divide-y divide-line">
          {pg.fatia?.map((c) => {
            const st = STATUS[c.status];
            return (
              <div key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-fg">{c.descricao}</p>
                  <p className="text-[11px] text-muted">
                    {money(c.valorCentavos)}{c.vencimento ? ` · vence ${new Date(c.vencimento).toLocaleDateString('pt-BR')}` : ''}
                    {c.pagoEm ? ` · pago ${new Date(c.pagoEm).toLocaleDateString('pt-BR')}` : ''}
                  </p>
                </div>
                <Badge tone={st.tone}>{st.label}</Badge>
                <div className="flex items-center gap-1.5">
                  {c.status !== 'paga' && c.status !== 'cancelada' && (
                    <>
                      <button onClick={() => gerarLink(c)} disabled={busy === c.id} className="rounded-lg border border-brand/40 px-2.5 py-1 text-[11px] font-semibold text-brand hover:bg-brand/10">
                        {busy === c.id ? '…' : c.stripeCheckoutUrl ? 'Reabrir link' : 'Link de pagamento'}
                      </button>
                      <button onClick={() => marcar(c.id, 'paga')} disabled={busy === c.id} className="rounded-lg border border-emerald-500/40 px-2.5 py-1 text-[11px] font-semibold text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400">Marcar paga</button>
                      <button onClick={() => marcar(c.id, 'cancelada')} disabled={busy === c.id} className="rounded-lg px-2 py-1 text-[11px] font-semibold text-muted hover:text-fg">Cancelar</button>
                    </>
                  )}
                  <button onClick={() => setExcluir(c)} className="rounded-lg p-1.5 text-muted hover:bg-surface2 hover:text-red-500" aria-label={`Excluir ${c.descricao}`}><Icon name="trash" size={14} /></button>
                </div>
              </div>
            );
          })}
          {cobrancas && cobrancas.length === 0 && <p className="px-5 py-10 text-center text-sm text-muted">Nenhuma cobrança ainda. Crie a primeira acima.</p>}
          {!cobrancas && <SkeletonRows rows={4} label="Carregando cobranças" />}
        </div>
        {cobrancas && <Paginacao pagina={pg.pagina} totalPaginas={pg.totalPaginas} total={pg.total} tamanho={pg.tamanho} onPagina={pg.setPagina} onTamanho={pg.setTamanho} rotulo="cobranças" />}
      </Card>

      <Confirm
        open={!!excluir}
        onClose={() => setExcluir(null)}
        onConfirm={confirmarExclusao}
        loading={busy === 'excluir'}
        title="Excluir cobrança?"
        description={
          excluir
            ? `${excluir.descricao} (${money(excluir.valorCentavos)}) some da lista de cobranças.${excluir.status === 'paga' ? ' A entrada que ela gerou continua no fluxo de caixa: o dinheiro foi recebido.' : ''}`
            : undefined
        }
      />
    </div>
  );
}
