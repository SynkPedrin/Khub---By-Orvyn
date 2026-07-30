'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, Field, Input, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { ConfigRequired } from '@/components/app/ConfigRequired';
import { ApiError } from '@/lib/api-error';
import { agenda, type Compromisso } from '@/lib/agenda';

const STATUS: Record<Compromisso['status'], { label: string; tone: 'green' | 'amber' | 'brand' | 'neutral' }> = {
  agendado: { label: 'agendado', tone: 'brand' },
  confirmado: { label: 'confirmado', tone: 'green' },
  concluido: { label: 'concluído', tone: 'neutral' },
  cancelado: { label: 'cancelado', tone: 'neutral' },
  nao_compareceu: { label: 'não compareceu', tone: 'amber' },
};

const hoje = () => new Date().toISOString().slice(0, 10);
const dt = (iso: string) => new Date(iso).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export default function AgendaPage() {
  const [lista, setLista] = useState<Compromisso[] | null>(null);
  const [novo, setNovo] = useState(false);
  const [form, setForm] = useState({ titulo: '', data: hoje(), inicio: '', fim: '' });
  const [slots, setSlots] = useState<{ inicio: string; fim: string }[] | null>(null);
  const [gated, setGated] = useState<{ provider: string; missing: string[] } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => agenda.compromissos().then(setLista).catch(() => setLista([]));
  useEffect(() => { load(); }, []);

  // Sugere horários livres quando abre o formulário / muda o dia.
  useEffect(() => {
    if (!novo) return;
    setSlots(null);
    agenda.horarios(form.data, 60).then(setSlots).catch(() => setSlots([]));
  }, [novo, form.data]);

  const escolherSlot = (s: { inicio: string; fim: string }) => setForm((f) => ({ ...f, inicio: s.inicio, fim: s.fim }));

  const criar = async () => {
    if (!form.titulo.trim() || !form.inicio || !form.fim) { setMsg('Escolha um título e um horário.'); return; }
    setBusy('criar'); setMsg(null);
    try {
      await agenda.criar({ titulo: form.titulo.trim(), inicio: form.inicio, fim: form.fim });
      setForm({ titulo: '', data: hoje(), inicio: '', fim: '' }); setNovo(false); load();
    } catch (e) {
      setMsg(e instanceof ApiError ? (e.body?.detail as string) ?? (e.body?.title as string) ?? 'Não consegui agendar.' : 'Não consegui agendar.');
    } finally { setBusy(null); }
  };

  const setStatus = async (id: string, status: Compromisso['status']) => { await agenda.status(id, status).catch(() => undefined); load(); };
  const remover = async (id: string) => { await agenda.remover(id).catch(() => undefined); load(); };

  const sincronizar = async (id: string) => {
    setGated(null); setMsg(null); setBusy(id);
    try { await agenda.sincronizar(id); load(); }
    catch (e) {
      const cr = e instanceof ApiError ? e.configRequired : null;
      if (cr) setGated(cr);
      else setMsg('Sincronização com o Google Calendar ainda não está conectada.');
    } finally { setBusy(null); }
  };

  const proximos = (lista ?? []).filter((c) => c.status === 'agendado' || c.status === 'confirmado');

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-fg">Agenda</h1>
          <p className="mt-1 text-sm text-muted">Agende compromissos e evite choque de horário. Sincronizar com o Google Calendar precisa conectar a conta.</p>
        </div>
        <Button onClick={() => setNovo((v) => !v)}><Icon name="plus" size={16} /> Novo compromisso</Button>
      </div>

      {gated && <ConfigRequired provider={gated.provider} missing={gated.missing} />}
      {msg && <p className="rounded-xl bg-amber-500/10 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-400">{msg}</p>}

      {novo && (
        <Card className="p-6">
          <h2 className="mb-3 font-bold text-fg">Novo compromisso</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Field label="Título"><Input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="Consulta / Reunião com cliente" autoFocus /></Field></div>
            <Field label="Dia"><Input type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value, inicio: '', fim: '' })} /></Field>
            <div>
              <p className="mb-1 text-xs font-semibold text-muted">Horário livre</p>
              {!slots && <p className="text-xs text-muted">Buscando horários…</p>}
              {slots && slots.length === 0 && <p className="text-xs text-muted">Nenhum horário livre nesse dia (9h–18h).</p>}
              <div className="flex flex-wrap gap-1.5">
                {slots?.map((s) => (
                  <button key={s.inicio} onClick={() => escolherSlot(s)} className={cx('rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors', form.inicio === s.inicio ? 'border-brand bg-brand/10 text-brand' : 'border-line text-fg hover:bg-surface2')}>
                    {hora(s.inicio)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-xs text-muted">{form.inicio ? `Selecionado: ${dt(form.inicio)} – ${hora(form.fim)}` : 'Escolha um horário livre acima.'}</span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setNovo(false)}>Cancelar</Button>
              <Button onClick={criar} disabled={busy === 'criar'}>{busy === 'criar' ? 'Agendando…' : 'Agendar'}</Button>
            </div>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <div className="border-b border-line px-5 py-3"><h2 className="font-bold text-fg">Próximos ({proximos.length})</h2></div>
        <div className="divide-y divide-line">
          {lista?.map((c) => {
            const st = STATUS[c.status];
            const passado = new Date(c.fim) < new Date();
            return (
              <div key={c.id} className={cx('flex flex-wrap items-center gap-3 px-5 py-3', (c.status === 'cancelado' || passado) && 'opacity-60')}>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/12 text-brand"><Icon name="calendar" size={18} /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-fg">{c.titulo}</p>
                  <p className="text-[11px] text-muted">{dt(c.inicio)} – {hora(c.fim)}{c.local ? ` · ${c.local}` : ''}{c.googleEventId ? ' · ✓ Google' : ''}</p>
                </div>
                <Badge tone={st.tone}>{st.label}</Badge>
                <div className="flex items-center gap-1.5">
                  {(c.status === 'agendado' || c.status === 'confirmado') && (
                    <>
                      {c.status === 'agendado' && <button onClick={() => setStatus(c.id, 'confirmado')} className="rounded-lg border border-emerald-500/40 px-2.5 py-1 text-[11px] font-semibold text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400">Confirmar</button>}
                      <button onClick={() => setStatus(c.id, 'concluido')} className="rounded-lg border border-line px-2.5 py-1 text-[11px] font-semibold text-fg hover:bg-surface2">Concluir</button>
                      <button onClick={() => sincronizar(c.id)} disabled={busy === c.id} className="rounded-lg border border-brand/40 px-2.5 py-1 text-[11px] font-semibold text-brand hover:bg-brand/10" title="Sincronizar com Google Calendar">{busy === c.id ? '…' : 'Google'}</button>
                      <button onClick={() => setStatus(c.id, 'cancelado')} className="rounded-lg px-2 py-1 text-[11px] font-semibold text-muted hover:text-fg">Cancelar</button>
                    </>
                  )}
                  <button onClick={() => remover(c.id)} className="rounded-lg p-1.5 text-muted hover:bg-surface2 hover:text-red-500" aria-label="Excluir"><Icon name="close" size={14} /></button>
                </div>
              </div>
            );
          })}
          {lista && lista.length === 0 && <p className="px-5 py-10 text-center text-sm text-muted">Nenhum compromisso. Crie o primeiro acima.</p>}
          {!lista && <p className="px-5 py-10 text-center text-sm text-muted">Carregando…</p>}
        </div>
      </Card>
    </div>
  );
}
