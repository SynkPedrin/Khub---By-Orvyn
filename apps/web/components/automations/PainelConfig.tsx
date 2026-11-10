'use client';

import { useState } from 'react';
import { Button, Field } from '@/components/ui';
import { Icon } from '@/components/icons';
import type { ConfigWorkflow } from '@/lib/automations';

interface Props {
  config: ConfigWorkflow;
  webhookUrl: string | null;
  temGatilhoWebhook: boolean;
  onSalvar: (c: Partial<ConfigWorkflow>) => Promise<void>;
  onGerarWebhook: () => Promise<void>;
  onFechar: () => void;
}

const DIAS = [
  { n: 1, l: 'S' }, { n: 2, l: 'T' }, { n: 3, l: 'Q' }, { n: 4, l: 'Q' },
  { n: 5, l: 'S' }, { n: 6, l: 'S' }, { n: 0, l: 'D' },
];
const FUSOS_BASE = ['America/Sao_Paulo', 'America/Manaus', 'America/Recife', 'America/Belem', 'America/Cuiaba', 'America/Rio_Branco', 'UTC'];
const tzLocal = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'America/Sao_Paulo'; } })();
const rotuloFuso = (f: string) => f.replace('America/', '').replace('_', ' ');

const REENTRADA: { valor: ConfigWorkflow['reentrada']; titulo: string; desc: string }[] = [
  { valor: 'uma_vez', titulo: 'Só uma vez', desc: 'Cada contato passa por este fluxo uma única vez. É o mais seguro.' },
  { valor: 'apos_terminar', titulo: 'Depois que terminar', desc: 'Pode entrar de novo, desde que a execução anterior tenha acabado.' },
  { valor: 'sempre', titulo: 'Toda vez', desc: 'Entra sempre que o gatilho disparar. Cuidado: pode repetir mensagem.' },
];

/** Configurações do fluxo (fora do canvas). */
export function PainelConfig({ config, webhookUrl, temGatilhoWebhook, onSalvar, onGerarWebhook, onFechar }: Props) {
  const [c, setC] = useState(config);
  const [salvando, setSalvando] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const set = async (patch: Partial<ConfigWorkflow>) => {
    const novo = { ...c, ...patch };
    setC(novo);
    setSalvando(true);
    try { await onSalvar(patch); } finally { setSalvando(false); }
  };

  const alternarDia = (n: number) => {
    const dias = c.janelaDias.includes(n) ? c.janelaDias.filter((d) => d !== n) : [...c.janelaDias, n].sort();
    void set({ janelaDias: dias });
  };

  const copiar = async () => {
    if (!webhookUrl) return;
    await navigator.clipboard.writeText(webhookUrl).catch(() => undefined);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  return (
    <div className="flex h-full w-80 shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line p-4">
        <div>
          <p className="text-sm font-bold text-fg">Configuração da automação</p>
          <p className="text-[11px] text-muted">{salvando ? 'salvando…' : 'reentrada · horário de funcionamento · fuso'}</p>
        </div>
        <button onClick={onFechar} className="rounded-lg p-1 text-muted hover:bg-surface2 hover:text-fg" aria-label="Fechar"><Icon name="close" size={15} /></button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-4 scrollbar-thin">
        {/* Reentrada */}
        <div>
          <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">Quem já passou pode entrar de novo?</p>
          <div className="space-y-1.5">
            {REENTRADA.map((r) => (
              <button
                key={r.valor}
                onClick={() => set({ reentrada: r.valor })}
                className={`w-full rounded-xl border p-2.5 text-left transition ${c.reentrada === r.valor ? 'border-brand bg-brand/8' : 'border-line hover:bg-surface2'}`}
              >
                <span className="flex items-center gap-1.5">
                  <span className={`grid h-3.5 w-3.5 place-items-center rounded-full border ${c.reentrada === r.valor ? 'border-brand bg-brand' : 'border-line'}`}>
                    {c.reentrada === r.valor && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                  </span>
                  <span className="text-xs font-semibold text-fg">{r.titulo}</span>
                </span>
                <span className="mt-0.5 block pl-5 text-[11px] leading-snug text-muted">{r.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Parar no reply */}
        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line p-3">
          <input
            type="checkbox"
            checked={c.pararNoReply}
            onChange={(e) => set({ pararNoReply: e.target.checked })}
            className="mt-0.5 h-4 w-4 accent-[var(--brand)]"
          />
          <span>
            <span className="block text-xs font-semibold text-fg">Parar se o contato responder</span>
            <span className="block text-[11px] leading-snug text-muted">
              Ele virou conversa humana, a automação sai da frente e não manda mais nada.
            </span>
          </span>
        </label>

        {/* Janela de envio */}
        <div className="rounded-xl border border-line p-3">
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={c.janelaAtiva}
              onChange={(e) => set({ janelaAtiva: e.target.checked })}
              className="mt-0.5 h-4 w-4 accent-[var(--brand)]"
            />
            <span>
              <span className="block text-xs font-semibold text-fg">Só mandar mensagem em horário útil</span>
              <span className="block text-[11px] leading-snug text-muted">
                Fora da janela, a mensagem <strong>espera</strong> a hora certa em vez de chegar de madrugada.
              </span>
            </span>
          </label>

          {c.janelaAtiva && (
            <div className="mt-3 space-y-3 border-t border-line pt-3">
              <div>
                <p className="mb-1 text-[11px] text-muted">Dias</p>
                <div className="flex gap-1">
                  {DIAS.map((d) => (
                    <button
                      key={d.n}
                      onClick={() => alternarDia(d.n)}
                      className={`h-7 w-7 rounded-lg text-[11px] font-bold transition ${c.janelaDias.includes(d.n) ? 'bg-brand text-white' : 'bg-surface2 text-muted hover:text-fg'}`}
                    >
                      {d.l}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Das">
                  <select className="input h-8 text-xs" value={c.janelaInicio} onChange={(e) => set({ janelaInicio: Number(e.target.value) })}>
                    {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                  </select>
                </Field>
                <Field label="Até">
                  <select className="input h-8 text-xs" value={c.janelaFim} onChange={(e) => set({ janelaFim: Number(e.target.value) })}>
                    {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                  </select>
                </Field>
              </div>
              <Field label="Fuso horário" hint="A janela usa o horário do seu cliente, não o do servidor.">
                <div className="flex items-center gap-2">
                  <select className="input h-8 flex-1 text-xs" value={c.timezone} onChange={(e) => set({ timezone: e.target.value })}>
                    {Array.from(new Set([tzLocal, ...FUSOS_BASE])).map((f) => <option key={f} value={f}>{rotuloFuso(f)}{f === tzLocal ? ' (seu)' : ''}</option>)}
                  </select>
                  {c.timezone !== tzLocal && (
                    <button onClick={() => set({ timezone: tzLocal })} className="shrink-0 rounded-lg border border-brand/40 px-2 py-1 text-[11px] font-semibold text-brand hover:bg-brand/10" title={`Usar ${rotuloFuso(tzLocal)}`}>Detectar</button>
                  )}
                </div>
              </Field>
            </div>
          )}
        </div>

        {/* Webhook de entrada */}
        {temGatilhoWebhook && (
          <div className="rounded-xl border border-line p-3">
            <p className="text-xs font-bold text-fg">URL de entrada</p>
            <p className="mt-0.5 text-[11px] leading-snug text-muted">
              Cole no seu site/formulário. Quem tiver esta URL dispara o fluxo, trate como senha.
            </p>
            {webhookUrl ? (
              <>
                <code className="mt-2 block truncate rounded-lg bg-surface2 p-2 font-mono text-[10px] text-fg">{webhookUrl}</code>
                <div className="mt-2 flex gap-2">
                  <Button variant="ghost" onClick={copiar} className="flex-1 text-xs">{copiado ? '✓ copiado' : 'Copiar'}</Button>
                  <Button variant="ghost" onClick={onGerarWebhook} className="text-xs" title="A URL antiga para de funcionar">Trocar</Button>
                </div>
              </>
            ) : (
              <Button onClick={onGerarWebhook} className="mt-2 w-full text-xs">Gerar URL</Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
