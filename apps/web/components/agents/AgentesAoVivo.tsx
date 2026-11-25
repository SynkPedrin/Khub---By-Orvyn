'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { Avatar, cx } from '@/components/ui';
import { crm, type MensagemConversa } from '@/lib/crm';
import { agentesApi, dataHora, ROTULO_STATUS_RUN, type Dashboard, type RunAtividade } from '@/lib/agents';
import { passosDoRun, COR_TAG } from './secoes/AoVivo';

type Run = RunAtividade & { agenteId: string; agenteNome: string };

/**
 * Agentes trabalhando DE VERDADE: leads atendidos (esq.), passo a passo real do
 * último atendimento do lead (centro, clicável) e a conversa real (dir.).
 * Altura fixa, cada coluna rola sozinha — a página não estica.
 */
export function AgentesAoVivo({ atividades }: { atividades: Dashboard['ultimasAtividades'] }) {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [leadSel, setLeadSel] = useState<string | null>(null);
  const [passoSel, setPassoSel] = useState<number | null>(null);
  const [thread, setThread] = useState<MensagemConversa[] | null>(null);
  const fimRef = useRef<HTMLDivElement>(null);
  const topoRef = useRef<HTMLDivElement>(null);

  const agentes = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of atividades) if (a.agentId) m.set(a.agentId, a.agente ?? 'Agente');
    return [...m.entries()].slice(0, 6);
  }, [atividades]);
  const chave = agentes.map(([id]) => id).join(',');

  const carregar = useCallback(async () => {
    const partes = await Promise.all(agentes.map(async ([id, nome]) => {
      const r = await agentesApi.studioAtividade(id, 40).catch(() => [] as RunAtividade[]);
      return r.map((x): Run => ({ ...x, agenteId: id, agenteNome: nome }));
    }));
    setRuns(partes.flat().sort((a, b) => +new Date(b.criadoEm) - +new Date(a.criadoEm)));
  }, [chave]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void carregar();
    const t = setInterval(() => void carregar(), 8000);
    return () => clearInterval(t);
  }, [carregar]);

  // um lead = sua conversa; o run mostrado é o mais recente dela
  const leads = useMemo(() => {
    const vistos = new Map<string, Run>();
    for (const r of runs ?? []) if ((r.temContato ?? r.contatoNome !== 'Contato') && !vistos.has(r.conversaId)) vistos.set(r.conversaId, r);
    return [...vistos.values()];
  }, [runs]);
  const lead = leads.find((l) => l.conversaId === leadSel) ?? leads[0] ?? null;
  const conversaId = lead?.conversaId ?? null;

  useEffect(() => {
    if (!conversaId) { setThread(null); return; }
    setThread(null);
    setPassoSel(null);
    const puxar = () => crm.mensagens(conversaId).then((r) => setThread(r.mensagens)).catch(() => undefined);
    void puxar();
    const t = setInterval(puxar, 5000);
    return () => clearInterval(t);
  }, [conversaId]);
  useEffect(() => { fimRef.current?.scrollIntoView({ block: 'end' }); }, [thread?.length, conversaId]);

  const passos = useMemo(() => passosDoRun(lead), [lead]);
  const detalheDoPasso = (i: number): string[] => {
    const p = passos[i];
    if (!p || !lead) return [];
    const t = lead.trace ?? {};
    const linhas: string[] = [];
    if (p.detalhe) linhas.push(p.detalhe);
    if (p.rotulo.startsWith('Consultar base')) for (const f of t.conhecimento?.fontes ?? []) linhas.push(`Fonte: ${f.titulo ?? f.chunkId.slice(0, 8)}`);
    if (p.rotulo.startsWith('Responder') && lead.latenciaMs != null) linhas.push(`Respondeu em ${(lead.latenciaMs / 1000).toFixed(1)} s${lead.modelo ? ` · ${lead.modelo}` : ''}`);
    if (p.rotulo.startsWith('Identificar') && t.guardrail?.motivo) linhas.push(`Guardrail: ${t.guardrail.motivo}`);
    return linhas;
  };
  const clicarPasso = (i: number) => {
    setPassoSel((a) => (a === i ? null : i));
    const p = passos[i];
    if (p?.tag === 'CONVERSA') (p.rotulo.startsWith('Mensagem') ? topoRef : fimRef).current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  return (
    <section aria-label="Agentes atendendo ao vivo" className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
        <p className="text-[13px] font-semibold text-fg">
          Assista os agentes trabalhando
          <span className="ml-2 font-normal text-muted">— atendimentos reais: clique num lead ou numa etapa</span>
        </p>
        <span className="pill pill-brand">Ao vivo</span>
      </div>

      {runs && leads.length === 0 ? (
        <div className="grid h-[140px] place-items-center px-6 text-center text-[13px] text-muted">
          Nenhum lead real foi atendido por um agente ainda. Quando um contato da sua base conversar com um agente no WhatsApp, o lead, o passo a passo e a conversa aparecem aqui.
        </div>
      ) : (
        <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_minmax(0,1.1fr)] lg:p-4">
          <div className="card-inset flex h-[360px] min-h-0 flex-col">
            <p className="border-b border-line px-4 py-2.5 text-[12px] font-semibold text-fg">Leads atendidos <span className="font-normal text-faint">· {leads.length}</span></p>
            <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto scrollbar-thin p-2">
              {!runs && <li className="p-4 text-[12.5px] text-muted">Carregando…</li>}
              {leads.map((l) => (
                <li key={l.conversaId}>
                  <button type="button" onClick={() => setLeadSel(l.conversaId)} aria-current={l.conversaId === lead?.conversaId} className={cx('flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-surface2', l.conversaId === lead?.conversaId && 'bg-brand/[0.08] shadow-[inset_0_0_0_1px_var(--brand-border)]')}>
                    <Avatar name={l.contatoNome || 'Contato'} size={30} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-fg">{l.contatoNome || 'Contato'}</span>
                      <span className="block truncate text-[11px] text-muted">{l.agenteNome} · {ROTULO_STATUS_RUN[l.status] ?? l.status}</span>
                    </span>
                    <span className="shrink-0 text-[10.5px] tabular text-faint">{dataHora(l.criadoEm)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="card-inset flex h-[360px] min-h-0 flex-col">
            <p className="flex items-center justify-between border-b border-line px-4 py-2.5 text-[12px] font-semibold text-fg">Fluxo do atendimento <span className="font-normal tabular text-faint">{passos.filter((p) => p.ok).length}/{passos.length}</span></p>
            <ol className="min-h-0 flex-1 space-y-0.5 overflow-y-auto scrollbar-thin p-2">
              {passos.map((p, i) => {
                const aberto = passoSel === i;
                const extra = aberto ? detalheDoPasso(i) : [];
                return (
                  <li key={`${p.rotulo}-${i}`}>
                    <button type="button" onClick={() => clicarPasso(i)} aria-expanded={aberto} className={cx('flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-surface2', aberto && 'bg-brand/[0.07]')}>
                      <span className={cx('grid h-6 w-6 shrink-0 place-items-center rounded-full border', p.ok ? 'border-brand bg-brand text-on-brand' : 'border-danger text-danger')}><Icon name={p.ok ? 'check2' : 'close'} size={12} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-medium text-fg">{p.rotulo}</span>
                        {p.detalhe && !aberto && <span className="block truncate text-[11px] text-muted">{p.detalhe}</span>}
                      </span>
                      <span className={cx('shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold', COR_TAG[p.tag])}>{p.tag}</span>
                    </button>
                    {aberto && extra.length > 0 && (
                      <ul className="ml-10 mr-2 mt-1 space-y-0.5 border-l border-line pb-1 pl-3 text-[11.5px] text-muted">
                        {extra.map((x, k) => <li key={k} className="break-words">{x}</li>)}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="card-inset flex h-[360px] min-h-0 flex-col">
            <div className="flex items-center gap-2.5 border-b border-line px-4 py-2.5">
              <Avatar name={lead?.contatoNome || 'Contato'} size={26} />
              <p className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-fg">{lead?.contatoNome || 'Conversa'}</p>
              {conversaId && <Link href={`/inbox?c=${conversaId}`} className="btn btn-ghost btn-sm !h-7 shrink-0">Abrir no Inbox</Link>}
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto scrollbar-thin px-3 py-3">
              <div ref={topoRef} />
              {conversaId && !thread && <p className="py-6 text-center text-[12.5px] text-muted">Carregando conversa…</p>}
              {thread?.map((m) => {
                const minha = m.de !== 'contato';
                const ia = m.de === 'ia';
                return (
                  <div key={m.id} className={cx('flex', minha ? 'justify-end' : 'justify-start')}>
                    <div className={cx('max-w-[88%] rounded-2xl px-3 py-2 text-[12.5px] leading-snug', !minha && 'rounded-bl-md bg-surface3 text-fg', minha && !ia && 'rounded-br-md bg-brand text-on-brand', ia && 'rounded-br-md bg-brand/15 text-fg shadow-[inset_0_0_0_1px_var(--brand-border)]')}>
                      {ia && <span className="mb-0.5 block text-[10px] font-semibold text-brand">{m.agentNome ?? 'Agente'}</span>}
                      <span className="whitespace-pre-wrap break-words">{m.texto}</span>
                      <span className="mt-0.5 block text-right text-[10px] text-faint">{m.hora ?? ''}</span>
                    </div>
                  </div>
                );
              })}
              <div ref={fimRef} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
