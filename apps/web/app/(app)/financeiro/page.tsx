'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, Field, Input, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { ConfigRequired } from '@/components/app/ConfigRequired';
import { ApiError } from '@/lib/api-error';
import { financeiro, type Cobranca, type ResumoFinanceiro } from '@/lib/financeiro';
import { SkeletonRows } from '@/components/kit';

const money = (centavos: number) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const STATUS: Record<Cobranca['status'], { label: string; tone: 'green' | 'amber' | 'brand' | 'neutral' }> = {
  rascunho: { label: 'rascunho', tone: 'neutral' },
  enviada: { label: 'enviada', tone: 'brand' },
  paga: { label: 'paga', tone: 'green' },
  vencida: { label: 'vencida', tone: 'amber' },
  cancelada: { label: 'cancelada', tone: 'neutral' },
};

export default function FinanceiroPage() {
  const [resumo, setResumo] = useState<ResumoFinanceiro | null>(null);
  const [cobrancas, setCobrancas] = useState<Cobranca[] | null>(null);
  const [novo, setNovo] = useState(false);
  const [form, setForm] = useState({ descricao: '', valor: '', vencimento: '' });
  const [gated, setGated] = useState<{ provider: string; missing: string[] } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    financeiro.resumo().then(setResumo).catch(() => undefined);
    financeiro.cobrancas().then(setCobrancas).catch(() => setCobrancas([]));
  };
  useEffect(() => { load(); }, []);

  const criar = async () => {
    const valorCentavos = Math.round((parseFloat(form.valor.replace(',', '.')) || 0) * 100);
    if (!form.descricao.trim() || valorCentavos <= 0) { setMsg('Preencha descrição e valor.'); return; }
    setBusy('criar'); setMsg(null);
    try {
      await financeiro.criar({ descricao: form.descricao.trim(), valorCentavos, vencimento: form.vencimento || undefined, enviar: true });
      setForm({ descricao: '', valor: '', vencimento: '' }); setNovo(false); load();
    } catch { setMsg('Não consegui criar a cobrança.'); } finally { setBusy(null); }
  };

  const marcar = async (id: string, status: 'paga' | 'cancelada') => { await financeiro.status(id, status).catch(() => undefined); load(); };
  const remover = async (id: string) => { await financeiro.remover(id).catch(() => undefined); load(); };

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

  const kpis = [
    { l: 'Recebido', v: resumo ? money(resumo.recebidoCentavos) : '-', icon: 'finance' as const, cor: 'text-emerald-600 dark:text-emerald-400' },
    { l: 'A receber', v: resumo ? money(resumo.aReceberCentavos) : '-', icon: 'trend' as const, cor: 'text-fg' },
    { l: 'Vencido', v: resumo ? money(resumo.vencidoCentavos) : '-', icon: 'inbox' as const, cor: 'text-amber-600 dark:text-amber-400' },
  ];

  return (
    <div className="mx-auto w-full max-w-[1680px] space-y-6 px-4 py-6 lg:px-8 lg:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="t-display">Financeiro</h1>
          <p className="mt-1 text-sm text-muted">Acompanhe cobranças e recebimentos. Conecte a Stripe para gerar links de pagamento.</p>
        </div>
        <Button onClick={() => setNovo((v) => !v)}><Icon name="plus" size={16} /> Nova cobrança</Button>
      </div>

      {gated && <ConfigRequired provider={gated.provider} missing={gated.missing} />}
      {msg && <p className="rounded-xl bg-amber-500/10 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-400">{msg}</p>}

      <div className="grid gap-4 sm:grid-cols-3">
        {kpis.map((k) => (
          <Card key={k.l} className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted">{k.l}</p>
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand/12 text-brand"><Icon name={k.icon} size={17} /></span>
            </div>
            <p className={cx('mt-2 text-2xl font-semibold', k.cor)}>{k.v}</p>
          </Card>
        ))}
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
          {cobrancas?.map((c) => {
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
                      <button onClick={() => marcar(c.id, 'paga')} className="rounded-lg border border-emerald-500/40 px-2.5 py-1 text-[11px] font-semibold text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400">Marcar paga</button>
                      <button onClick={() => marcar(c.id, 'cancelada')} className="rounded-lg px-2 py-1 text-[11px] font-semibold text-muted hover:text-fg">Cancelar</button>
                    </>
                  )}
                  <button onClick={() => remover(c.id)} className="rounded-lg p-1.5 text-muted hover:bg-surface2 hover:text-red-500" aria-label="Excluir"><Icon name="close" size={14} /></button>
                </div>
              </div>
            );
          })}
          {cobrancas && cobrancas.length === 0 && <p className="px-5 py-10 text-center text-sm text-muted">Nenhuma cobrança ainda. Crie a primeira acima.</p>}
          {!cobrancas && <SkeletonRows rows={4} label="Carregando cobranças" />}
        </div>
      </Card>
    </div>
  );
}
