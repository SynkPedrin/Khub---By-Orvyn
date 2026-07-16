'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Avatar, Badge } from '@/components/ui';
import { Icon } from '@/components/icons';
import { crm, type Conversa } from '@/lib/crm';

type Status = 'sending' | 'sent' | 'delivered' | 'failed';
interface Msg { id: string; de: string; texto: string; hora: string | null; status?: Status }

function Tick({ status }: { status?: Status }) {
  if (status === 'sending') return <span className="ml-1 inline-block animate-pulse text-white/60">🕓</span>;
  if (status === 'failed') return <span className="ml-1 text-red-200" title="falhou">!</span>;
  const two = status === 'delivered' || status === undefined;
  return <span className={`ml-1 text-[10px] ${two ? 'text-sky-200' : 'text-white/70'}`}>{two ? '✓✓' : '✓'}</span>;
}

function TypingDots() {
  return (
    <div className="flex w-max items-center gap-1 rounded-2xl rounded-bl-sm border border-line bg-surface px-3 py-2.5">
      {[0, 150, 300].map((d) => (
        <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" style={{ animationDelay: `${d}ms` }} />
      ))}
    </div>
  );
}

export default function InboxPage() {
  const [convs, setConvs] = useState<Conversa[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [thread, setThread] = useState<Msg[]>([]);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const selRef = useRef<string | null>(null);
  const threadRef = useRef<Msg[]>([]);
  selRef.current = sel;
  threadRef.current = thread;

  const scrollDown = useCallback(() => setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 40), []);

  const openConversa = (c: Conversa) => {
    setSel(c.id);
    setThread(c.mensagens.map((m) => ({ ...m })));
    setTyping(false);
    scrollDown();
  };

  // carga inicial
  useEffect(() => {
    crm.conversations().then((cs) => { setConvs(cs); if (cs[0]) openConversa(cs[0]); }).catch(() => setConvs([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // polling: novas mensagens (entrega ao vivo do STEVO) + reconciliação
  useEffect(() => {
    const t = setInterval(async () => {
      let cs: Conversa[];
      try { cs = await crm.conversations(); } catch { return; }
      setConvs(cs);
      const id = selRef.current;
      const conv = cs.find((c) => c.id === id);
      if (!conv) return;
      const cur = threadRef.current;
      const ids = new Set(cur.map((m) => m.id));
      const novas: Msg[] = [];
      for (const m of conv.mensagens) {
        if (ids.has(m.id)) continue;
        // reconcilia a mensagem otimista (mesma texto, ainda "sending")
        const pend = cur.find((x) => x.status === 'sending' && x.de === 'humano' && x.texto === m.texto);
        if (pend) { pend.id = m.id; pend.status = 'delivered'; ids.add(m.id); continue; }
        novas.push({ ...m });
      }
      if (!novas.length) { setThread([...cur]); return; }
      const temInbound = novas.some((m) => m.de === 'contato');
      if (temInbound) {
        setTyping(true);
        setTimeout(() => { setThread((p) => [...p, ...novas]); setTyping(false); scrollDown(); }, 900);
      } else {
        setThread((p) => [...p, ...novas]); scrollDown();
      }
    }, 3000);
    return () => clearInterval(t);
  }, [scrollDown]);

  const conversa = convs?.find((c) => c.id === sel);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || !conversa || sending) return;
    setSending(true); setNote('');
    const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const tmpId = `tmp-${Date.now()}`;
    setThread((p) => [...p, { id: tmpId, de: 'humano', texto: t, hora, status: 'sending' }]);
    setConvs((cs) => cs?.map((c) => (c.id === conversa.id ? { ...c, ultimaPrevia: t, ultimaHora: hora } : c)) ?? cs);
    setText(''); scrollDown();
    try {
      const r = await crm.sendMessage(conversa.id, t);
      const status: Status = r.status === 'sent' ? 'delivered' : r.status === 'failed' ? 'failed' : 'sent';
      setThread((p) => p.map((m) => (m.id === tmpId ? { ...m, id: r.id ?? m.id, status } : m)));
      if (r.status === 'stevo_off') setNote('Mensagem salva. Envio no WhatsApp requer configurar o STEVO (STEVO_API_URL + instância).');
      else if (r.status === 'sem_telefone') setNote('Contato sem telefone (defina STEVO_TEST_NUMBER p/ testar no seu WhatsApp).');
      else if (r.status === 'failed') setNote(`Falha no envio via STEVO: ${r.erro ?? ''}`);
    } catch {
      setThread((p) => p.map((m) => (m.id === tmpId ? { ...m, status: 'failed' } : m)));
      setNote('Não consegui enviar. Tente novamente.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full">
      {/* Lista */}
      <div className="flex w-full max-w-xs shrink-0 flex-col border-r border-line bg-surface md:w-80">
        <div className="border-b border-line px-4 py-4">
          <h1 className="text-lg font-extrabold tracking-tight text-fg">Inbox</h1>
          <p className="text-xs text-muted">WhatsApp (STEVO) · Instagram · E-mail</p>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {!convs && <p className="p-4 text-sm text-muted">Carregando…</p>}
          {convs?.map((c) => (
            <button key={c.id} onClick={() => openConversa(c)} className="flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left transition-colors hover:bg-surface2" style={{ background: sel === c.id ? 'color-mix(in srgb, var(--brand) 8%, transparent)' : undefined }}>
              <Avatar name={c.nome} size={42} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold text-fg">{c.nome}</span>
                  <span className="shrink-0 text-[11px] text-muted">{c.ultimaHora}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-muted">{c.ultimaPrevia}</span>
                  {c.naoLidas > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-white">{c.naoLidas}</span>}
                </div>
              </div>
            </button>
          ))}
          {convs && convs.length === 0 && <p className="p-4 text-sm text-muted">Sem conversas ainda.</p>}
        </div>
      </div>

      {/* Thread (estilo WhatsApp) */}
      <div className="hidden min-w-0 flex-1 flex-col md:flex" style={{ background: 'var(--bg)' }}>
        {conversa ? (
          <>
            <div className="flex items-center justify-between border-b border-line bg-surface px-5 py-3">
              <div className="flex items-center gap-3">
                <Avatar name={conversa.nome} size={40} />
                <div>
                  <p className="font-bold text-fg">{conversa.nome}</p>
                  {typing ? <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">digitando…</span> : <Badge tone="green">● {conversa.canal}</Badge>}
                </div>
              </div>
              <div className="flex gap-1">
                <button className="rounded-lg p-2 text-muted hover:bg-surface3"><Icon name="phone" size={18} /></button>
                <button className="rounded-lg p-2 text-muted hover:bg-surface3"><Icon name="dots" size={18} /></button>
              </div>
            </div>

            <div
              className="flex-1 space-y-2 overflow-y-auto p-5 scrollbar-thin"
              style={{ backgroundImage: 'radial-gradient(color-mix(in srgb, var(--brand) 8%, transparent) 0.8px, transparent 0.8px)', backgroundSize: '18px 18px' }}
            >
              {thread.map((m) => {
                const mine = m.de !== 'contato';
                return (
                  <div key={m.id} className={`flex animate-scale-in ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className="max-w-[72%] rounded-2xl px-3.5 py-2 text-sm shadow-sm"
                      style={mine ? { background: 'linear-gradient(135deg, var(--brand-bright), var(--brand))', color: '#fff', borderBottomRightRadius: 5 } : { background: 'var(--surface)', border: '1px solid var(--border)', borderBottomLeftRadius: 5 }}
                    >
                      {m.de === 'nyro' && <p className="mb-0.5 text-[10px] font-bold opacity-80">✦ Nyro</p>}
                      <span className="align-middle">{m.texto}</span>
                      <span className={`ml-2 whitespace-nowrap text-[10px] ${mine ? 'text-white/70' : 'text-muted'}`}>
                        {m.hora}{mine && <Tick status={m.status} />}
                      </span>
                    </div>
                  </div>
                );
              })}
              {typing && <div className="flex justify-start animate-scale-in"><TypingDots /></div>}
              <div ref={endRef} />
            </div>

            {/* Composer */}
            <div className="border-t border-line bg-surface px-5 py-3 pr-20">
              {note && <p className="mb-2 rounded-lg bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400">{note}</p>}
              <form onSubmit={enviar} className="flex items-center gap-2 rounded-2xl border border-line bg-surface2 px-3 py-2">
                <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Escreva uma mensagem…  (Enter envia)" className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-muted" />
                <button type="submit" disabled={sending || !text.trim()} className="flex h-9 w-9 items-center justify-center rounded-full text-white transition-transform active:scale-90 disabled:opacity-40" style={{ background: 'linear-gradient(135deg, var(--brand-bright), var(--brand-deep))' }}>
                  <Icon name="chevronRight" size={17} />
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted">Selecione uma conversa</div>
        )}
      </div>
    </div>
  );
}
