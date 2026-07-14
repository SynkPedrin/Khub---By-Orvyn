'use client';

import { useEffect, useState } from 'react';
import { Avatar, Badge } from '@/components/ui';
import { Icon } from '@/components/icons';
import { crm, type Conversa } from '@/lib/crm';

export default function InboxPage() {
  const [convs, setConvs] = useState<Conversa[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);

  useEffect(() => {
    crm.conversations().then((c) => { setConvs(c); setSel(c[0]?.id ?? null); }).catch(() => setConvs([]));
  }, []);

  const conversa = convs?.find((c) => c.id === sel);

  return (
    <div className="flex h-full">
      <div className="flex w-full max-w-xs shrink-0 flex-col border-r border-line bg-surface md:w-80">
        <div className="border-b border-line px-4 py-4">
          <h1 className="text-lg font-extrabold tracking-tight text-fg">Inbox</h1>
          <p className="text-xs text-muted">WhatsApp · Instagram · E-mail</p>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {!convs && <p className="p-4 text-sm text-muted">Carregando…</p>}
          {convs?.map((c) => (
            <button
              key={c.id}
              onClick={() => setSel(c.id)}
              className="flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left transition-colors hover:bg-surface2"
              style={{ background: sel === c.id ? 'color-mix(in srgb, var(--brand) 8%, transparent)' : undefined }}
            >
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

      <div className="hidden min-w-0 flex-1 flex-col bg-bg md:flex">
        {conversa ? (
          <>
            <div className="flex items-center justify-between border-b border-line bg-surface px-5 py-3">
              <div className="flex items-center gap-3">
                <Avatar name={conversa.nome} size={40} />
                <div>
                  <p className="font-bold text-fg">{conversa.nome}</p>
                  <Badge tone="green">● {conversa.canal}</Badge>
                </div>
              </div>
              <div className="flex gap-1">
                <button className="rounded-lg p-2 text-muted hover:bg-surface3"><Icon name="phone" size={18} /></button>
                <button className="rounded-lg p-2 text-muted hover:bg-surface3"><Icon name="dots" size={18} /></button>
              </div>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-5 scrollbar-thin">
              {conversa.mensagens.map((m, i) => {
                const mine = m.de !== 'contato';
                return (
                  <div key={i} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div className="max-w-[70%] rounded-2xl px-3.5 py-2.5 text-sm" style={mine ? { background: 'var(--brand)', color: '#fff', borderBottomRightRadius: 4 } : { background: 'var(--surface)', border: '1px solid var(--border)', borderBottomLeftRadius: 4 }}>
                      {m.de === 'nyro' && <p className="mb-0.5 text-[10px] font-bold opacity-80">✦ Nyro</p>}
                      {m.texto}
                      <span className={`ml-2 text-[10px] ${mine ? 'text-white/70' : 'text-muted'}`}>{m.hora}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-line bg-surface px-5 py-3">
              <div className="mb-2 flex items-center gap-2 rounded-xl border border-brand/30 bg-brand/5 px-3 py-2 text-xs text-fg">
                <Icon name="sparkles" size={15} className="shrink-0 text-brand" />
                <span className="flex-1">Sugestão da Nyro: “Consigo encaixar quinta às 15h ou sexta às 10h. Qual prefere?”</span>
                <button className="shrink-0 font-semibold text-brand hover:underline">Usar</button>
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-line bg-surface2 px-3 py-2">
                <input placeholder="Escreva uma mensagem…" className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-muted" />
                <button className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-white"><Icon name="chevronRight" size={17} /></button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted">Selecione uma conversa</div>
        )}
      </div>
    </div>
  );
}
