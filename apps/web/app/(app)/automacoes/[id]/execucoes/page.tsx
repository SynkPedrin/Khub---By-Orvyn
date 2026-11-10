'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Badge, Button, Card, Field } from '@/components/ui';
import { Icon } from '@/components/icons';
import { automations, type RunDetalhe, type RunResumo } from '@/lib/automations';
import { crm, type Contato } from '@/lib/crm';
import { useRealtime } from '@/lib/realtime';

const TOM: Record<string, 'green' | 'amber' | 'brand' | 'neutral'> = {
  concluido: 'green', falhou: 'amber', rodando: 'brand', esperando: 'brand', cancelado: 'neutral',
};

function quando(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s atrás`;
  if (s < 3600) return `${Math.round(s / 60)}min atrás`;
  if (s < 86400) return `${Math.round(s / 3600)}h atrás`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

export default function ExecucoesPage() {
  const { id } = useParams<{ id: string }>();
  const [runs, setRuns] = useState<RunResumo[] | null>(null);
  const [aberta, setAberta] = useState<RunDetalhe | null>(null);
  const [contatos, setContatos] = useState<Contato[]>([]);
  const [testando, setTestando] = useState(false);
  const [contatoTeste, setContatoTeste] = useState('');
  const [aviso, setAviso] = useState('');

  const load = useCallback(() => automations.runs(id).then(setRuns).catch(() => setRuns([])), [id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { crm.contacts({ limit: 50 }).then((p) => setContatos(p.items)).catch(() => setContatos([])); }, []);

  // a execução anda sozinha: a timeline acompanha ao vivo (D2)
  useRealtime({
    'automation.run': () => {
      void load();
      if (aberta) automations.run(aberta.id).then(setAberta).catch(() => undefined);
    },
  });

  const abrir = async (runId: string) => setAberta(await automations.run(runId));

  const testar = async () => {
    if (!contatoTeste) return;
    setTestando(true);
    setAviso('');
    try {
      const r = await automations.testar(id, contatoTeste);
      setAviso(r.runId ? 'Execução de teste iniciada, as ações acontecem de verdade.' : 'Nada a executar (gatilho sem nó ligado?).');
      setTimeout(load, 800);
    } catch {
      setAviso('Não consegui testar: o workflow tem problemas de validação.');
    } finally {
      setTestando(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1680px] space-y-5 px-4 py-6 lg:px-8 lg:py-8">
      <Link href={`/automacoes/${id}`} className="inline-flex items-center gap-1 text-xs text-muted hover:text-brand">
        <Icon name="chevronRight" size={13} className="rotate-180" /> Voltar ao editor
      </Link>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="t-display">Execuções</h1>
          <p className="text-sm text-muted">Cada passo do fluxo, com entrada, saída e erro.</p>
        </div>
        <div className="flex items-end gap-2">
          <Field label="Testar com um contato real">
            <select className="input h-9 w-56 text-sm" value={contatoTeste} onChange={(e) => setContatoTeste(e.target.value)}>
              <option value="">Escolha um contato…</option>
              {contatos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </Field>
          <Button onClick={testar} disabled={!contatoTeste || testando}>{testando ? 'Rodando…' : 'Executar teste'}</Button>
        </div>
      </div>

      <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
        O teste <strong>executa de verdade</strong>: manda mensagem, cria tarefa, mexe no funil. Não é simulação, use um contato seu.
      </p>
      {aviso && <p className="rounded-lg bg-brand/10 px-3 py-2 text-xs text-brand">{aviso}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-2">
          {!runs && <p className="py-8 text-center text-sm text-muted">Carregando…</p>}
          {runs?.length === 0 && <p className="py-8 text-center text-sm text-muted">Nenhuma execução ainda. Publique, ative e dispare o gatilho, ou teste acima.</p>}
          {runs?.map((r) => (
            <button
              key={r.id}
              onClick={() => abrir(r.id)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-surface2 ${aberta?.id === r.id ? 'bg-surface2' : ''}`}
            >
              <Badge tone={TOM[r.status] ?? 'neutral'}>{r.status}</Badge>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-fg">{r.gatilho}</span>
                <span className="block truncate text-[11px] text-muted">{quando(r.startedAt)}{r.erro ? ` · ${r.erro}` : ''}</span>
              </span>
              {r.teste && <span className="shrink-0 rounded bg-brand/12 px-1.5 text-[10px] font-bold text-brand">teste</span>}
            </button>
          ))}
        </Card>

        <Card className="p-4">
          {!aberta && <p className="py-8 text-center text-sm text-muted">Escolha uma execução para ver a timeline.</p>}
          {aberta && (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-fg">{aberta.gatilho}</p>
                  <p className="text-[11px] text-muted">iniciada {quando(aberta.startedAt)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={TOM[aberta.status] ?? 'neutral'}>{aberta.status}</Badge>
                  {(aberta.status === 'rodando' || aberta.status === 'esperando') && (
                    <button onClick={async () => { await automations.cancelar(aberta.id); load(); abrir(aberta.id); }} className="text-xs text-red-500 hover:underline">
                      cancelar
                    </button>
                  )}
                </div>
              </div>

              {aberta.erro && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">{aberta.erro}</p>}

              <div className="mt-4 space-y-3">
                {aberta.passos.length === 0 && <p className="text-center text-xs text-muted">Nenhum passo executado ainda.</p>}
                {aberta.passos.map((p) => (
                  <div key={p.id} className="flex gap-3">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${p.status === 'ok' ? 'bg-emerald-500' : p.status === 'falhou' ? 'bg-red-500' : 'bg-amber-500'}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-fg">
                        {p.tipo} {p.tentativa > 1 && <span className="text-amber-600">· tentativa {p.tentativa}</span>}
                      </p>
                      {p.erro
                        ? <p className="text-[11px] text-red-500">{p.erro}</p>
                        : <p className="truncate text-[11px] text-muted">{JSON.stringify(p.saida)}</p>}
                      <p className="text-[10px] text-muted">{p.duracaoMs != null ? `${p.duracaoMs}ms · ` : ''}{quando(p.createdAt)}</p>
                    </div>
                  </div>
                ))}
                {aberta.status === 'esperando' && (
                  <p className="rounded-lg bg-brand/10 px-3 py-2 text-[11px] text-brand">
                    Em espera no nó <strong>{aberta.noAtual}</strong>. Retoma sozinha, mesmo depois de restart.
                  </p>
                )}
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
