'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Icon, type IconName } from '@/components/icons';
import { cx } from '@/components/ui';
import { AvatarContato } from '@/components/inbox/AvatarContato';
import { crm, type MensagemConversa, type SearchResult, type Contato360 } from '@/lib/crm';
import { agentesApi, type AnalisePrompt, type ConversaAoVivo, type RunAtividade } from '@/lib/agents';
import { Campo, Modal, Painel, mensagemDeErro, useToast } from '../kit';
import type { SecaoProps } from '../editor';

/**
 * AO VIVO — o cockpit do agente: ele trabalhando de verdade, não uma
 * simulação. Conversa real à esquerda, fluxo operacional (trace real dos
 * runs) no centro, efeitos no CRM à direita. Em cima: configuração rápida
 * com a NICO escrevendo o prompt e medindo a qualidade dele.
 */

const FOCOS = ['Vendas', 'Agendamento', 'Atendimento', 'Suporte', 'Qualificação de leads'];

type PassoFluxo = { rotulo: string; detalhe?: string; tag: 'CONVERSA' | 'AGENTE' | 'CRM'; ok: boolean };

function passosDoRun(run: RunAtividade | null): PassoFluxo[] {
  if (!run) return [];
  const t = run.trace ?? {};
  const passos: PassoFluxo[] = [
    { rotulo: 'Mensagem recebida', detalhe: run.contatoNome, tag: 'CONVERSA', ok: true },
  ];
  if (run.intencao) {
    passos.push({ rotulo: 'Identificar intenção', detalhe: `${run.intencao}${run.confianca != null ? ` · ${Math.round(run.confianca * 100)}% de confiança` : ''}`, tag: 'AGENTE', ok: true });
  }
  if (t.conhecimento?.consulta) {
    const fontes = t.conhecimento.fontes?.length ?? 0;
    passos.push({ rotulo: 'Consultar base de conhecimento', detalhe: `${t.conhecimento.consulta}${fontes ? ` · ${fontes} trecho${fontes > 1 ? 's' : ''}` : ''}`, tag: 'AGENTE', ok: true });
  }
  for (const r of t.regras?.disparadas ?? []) {
    passos.push({ rotulo: `Regra: ${r.nome}`, tag: 'AGENTE', ok: true });
  }
  for (const f of t.ferramentas ?? []) {
    passos.push({ rotulo: `Ferramenta: ${f.ferramenta}`, detalhe: f.pendente ? 'aguardando aprovação' : f.erro, tag: 'CRM', ok: f.ok });
  }
  const blocos = t.fragmentacao?.blocos?.length ?? 0;
  if (run.status === 'respondido') {
    passos.push({ rotulo: 'Responder no WhatsApp', detalhe: blocos > 1 ? `${blocos} mensagens fragmentadas` : '1 mensagem', tag: 'CONVERSA', ok: true });
  }
  if (run.status === 'transferido') passos.push({ rotulo: 'Transferir para humano', detalhe: run.motivo ?? undefined, tag: 'AGENTE', ok: true });
  if (run.status === 'ignorado') passos.push({ rotulo: 'Ficar em silêncio', detalhe: run.motivo ?? undefined, tag: 'AGENTE', ok: true });
  if (run.status === 'erro') passos.push({ rotulo: 'Erro no atendimento', detalhe: run.motivo ?? undefined, tag: 'AGENTE', ok: false });
  if (run.status === 'processando') passos.push({ rotulo: 'Processando…', tag: 'AGENTE', ok: false });
  return passos;
}

const COR_TAG: Record<PassoFluxo['tag'], string> = {
  CONVERSA: 'bg-brand-soft text-brand',
  AGENTE: 'bg-lime-soft text-lime-ink',
  CRM: 'bg-[var(--base-2)] text-muted',
};

export function AoVivo({ agente, onAtualizado }: SecaoProps) {
  const toast = useToast();

  // ---- dados ao vivo ----
  const [conversas, setConversas] = useState<ConversaAoVivo[] | null>(null);
  const [atividade, setAtividade] = useState<RunAtividade[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [thread, setThread] = useState<MensagemConversa[] | null>(null);
  const [contato360, setContato360] = useState<Contato360 | null>(null);

  // ---- configuração rápida ----
  const [cfg, setCfg] = useState({ nome: agente.nome, descricao: agente.descricao ?? '', instrucoes: agente.instrucoes, conhecimentoAtivo: agente.conhecimentoAtivo });
  const [foco, setFoco] = useState(agente.config?.identidade?.objetivoPrincipal || '');
  const [gerando, setGerando] = useState(false);
  const [analise, setAnalise] = useState<AnalisePrompt | null>(null);
  const [analisando, setAnalisando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  // ---- teste no WhatsApp ----
  const [testeAberto, setTesteAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [achados, setAchados] = useState<SearchResult[]>([]);
  const [testando, setTestando] = useState(false);

  const fimRef = useRef<HTMLDivElement>(null);

  const carregarAoVivo = useCallback(() => {
    agentesApi.studioConversas(agente.id).then((cs) => {
      setConversas(cs);
      setSel((atual) => atual ?? cs[0]?.id ?? null);
    }).catch(() => setConversas([]));
    agentesApi.studioAtividade(agente.id).then(setAtividade).catch(() => undefined);
  }, [agente.id]);

  useEffect(() => {
    carregarAoVivo();
    const t = setInterval(carregarAoVivo, 5000);
    return () => clearInterval(t);
  }, [carregarAoVivo]);

  const conversaSel = conversas?.find((c) => c.id === sel) ?? null;

  useEffect(() => {
    if (!sel) { setThread(null); setContato360(null); return; }
    const puxar = () => crm.mensagens(sel).then((r) => setThread(r.mensagens)).catch(() => undefined);
    puxar();
    const t = setInterval(puxar, 4000);
    return () => clearInterval(t);
  }, [sel]);

  useEffect(() => {
    const cid = conversaSel?.contato?.id;
    if (!cid) { setContato360(null); return; }
    crm.contact(cid).then(setContato360).catch(() => setContato360(null));
  }, [conversaSel?.contato?.id]);

  useEffect(() => { fimRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [thread?.length]);

  // run mais recente DA conversa selecionada (ou o mais recente do agente)
  const runAtual = useMemo(() => atividade.find((r) => r.conversaId === sel) ?? atividade[0] ?? null, [atividade, sel]);
  const passos = useMemo(() => passosDoRun(runAtual), [runAtual]);
  const concluidos = passos.filter((p) => p.ok).length;

  // ---- ações ----
  const gerarComNico = async () => {
    if (!foco.trim() || foco.trim().length < 3) return toast('erro', 'Diga o foco do agente (ex.: vendas, agendamento)');
    if (!cfg.descricao.trim() || cfg.descricao.trim().length < 10) return toast('erro', 'Descreva em uma frase o negócio e o que o agente deve fazer');
    setGerando(true);
    try {
      const r = await agentesApi.assistentePrompt({ nome: cfg.nome, foco: foco.trim(), descricao: cfg.descricao.trim(), instrucoesAtuais: cfg.instrucoes.trim() || undefined });
      setCfg((c) => ({ ...c, instrucoes: r.instrucoes }));
      toast('ok', 'A NICO escreveu o prompt — revise e salve');
    } catch (e) {
      toast('erro', mensagemDeErro(e));
    } finally {
      setGerando(false);
    }
  };

  const analisar = async () => {
    if (cfg.instrucoes.trim().length < 10) return toast('erro', 'Escreva (ou gere) o prompt antes de analisar');
    setAnalisando(true);
    try {
      setAnalise(await agentesApi.analisarRascunho({ nome: cfg.nome, foco: foco || undefined, instrucoes: cfg.instrucoes, tom: agente.tom, conhecimentoAtivo: cfg.conhecimentoAtivo }));
    } catch (e) {
      toast('erro', mensagemDeErro(e));
    } finally {
      setAnalisando(false);
    }
  };

  const salvar = async () => {
    setSalvando(true);
    try {
      const a = await agentesApi.atualizar(agente.id, { nome: cfg.nome.trim(), descricao: cfg.descricao, instrucoes: cfg.instrucoes, conhecimentoAtivo: cfg.conhecimentoAtivo });
      onAtualizado(a);
      toast('ok', 'Agente atualizado');
    } catch (e) {
      toast('erro', mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  };

  const buscarContatos = async (q: string) => {
    setBusca(q);
    if (q.trim().length < 2) { setAchados([]); return; }
    try {
      const r = await crm.search(q.trim());
      setAchados(r.filter((x) => x.tipo === 'contato').slice(0, 8));
    } catch { setAchados([]); }
  };

  const iniciarTeste = async (contactId: string) => {
    setTestando(true);
    try {
      const r = await agentesApi.studioTestarWhatsApp(agente.id, contactId);
      setTesteAberto(false);
      toast('ok', `Conversa de ${r.contatoNome} entregue ao agente — é só o contato escrever no WhatsApp`);
      setSel(r.conversaId);
      carregarAoVivo();
    } catch (e) {
      toast('erro', mensagemDeErro(e));
    } finally {
      setTestando(false);
    }
  };

  const notaTom = !analise ? '' : analise.nota >= 80 ? 'text-lime-ink' : analise.nota >= 50 ? 'text-warning' : 'text-danger';
  const notaBarra = !analise ? '' : analise.nota >= 80 ? 'bg-[var(--khub-lime)]' : analise.nota >= 50 ? 'bg-warning' : 'bg-danger';

  return (
    <div className="space-y-5">
      {/* ================= CONFIGURAÇÃO RÁPIDA + NICO + QUALIDADE ================= */}
      <Painel
        titulo="Configuração rápida"
        descricao="O essencial para o agente trabalhar. A NICO escreve o prompt com você e mede se está pronto."
        acao={
          <div className="flex items-center gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={analisar} disabled={analisando}>
              <Icon name="target" size={14} /> {analisando ? 'Analisando…' : 'NICO, avaliar prompt'}
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={salvar} disabled={salvando}>
              {salvando ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        }
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Campo rotulo="Nome do agente"><input className="input" maxLength={80} value={cfg.nome} onChange={(e) => setCfg({ ...cfg, nome: e.target.value })} /></Campo>
              <Campo rotulo="Foco" dica="Vendas, agendamento, atendimento…">
                <input className="input" list="focos-agente" maxLength={60} value={foco} onChange={(e) => setFoco(e.target.value)} placeholder="Ex.: agendamento de avaliações" />
                <datalist id="focos-agente">{FOCOS.map((f) => <option key={f} value={f} />)}</datalist>
              </Campo>
            </div>
            <Campo rotulo="O negócio e o que o agente deve fazer" dica="Uma frase basta — a NICO transforma em prompt completo.">
              <textarea className="textarea" rows={2} maxLength={2000} value={cfg.descricao} onChange={(e) => setCfg({ ...cfg, descricao: e.target.value })} placeholder="Ex.: salão de beleza; a agente agenda avaliações, informa serviços e confirma horários" />
            </Campo>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[13px] font-medium text-fg">Prompt do agente</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={gerarComNico} disabled={gerando}>
                  <Icon name="sparkles" size={14} /> {gerando ? 'NICO escrevendo…' : cfg.instrucoes.trim() ? 'NICO, melhorar meu prompt' : 'NICO, escrever o prompt'}
                </button>
              </div>
              <textarea className="textarea font-mono text-[12.5px]" rows={8} maxLength={8000} value={cfg.instrucoes} onChange={(e) => setCfg({ ...cfg, instrucoes: e.target.value })} placeholder="Escreva você mesmo ou deixe a NICO escrever a partir da descrição acima." />
            </div>
            <label className="flex items-start gap-3 text-[13.5px]">
              <input type="checkbox" className="checkbox mt-0.5" checked={cfg.conhecimentoAtivo} onChange={(e) => setCfg({ ...cfg, conhecimentoAtivo: e.target.checked })} />
              <span>
                <span className="font-medium text-fg">Usar a base de conhecimento</span>
                <span className="block text-xs text-muted">O agente consulta os materiais da empresa antes de responder. O acervo em si fica na aba “Base de conhecimento”.</span>
              </span>
            </label>
          </div>

          {/* medidor de qualidade */}
          <div className="rounded-xl border border-line bg-[var(--base-1)] p-4">
            <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-fg"><Icon name="target" size={14} /> Qualidade do prompt</p>
            {!analise && <p className="text-[12.5px] text-muted">Peça para a NICO avaliar. Ela aponta o que falta — por exemplo: agente de vendas sem valores informados não vai funcionar corretamente.</p>}
            {analise && (
              <div className="space-y-3">
                <div className="flex items-end gap-2">
                  <span className={cx('text-3xl font-bold tabular', notaTom)}>{analise.nota}</span>
                  <span className="pb-1 text-[12px] text-muted">/100 {analise.nota >= 80 ? '· pronto pra produção' : analise.nota >= 50 ? '· funciona, mas frágil' : '· vai falhar'}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[var(--base-2)]">
                  <div className={cx('h-full rounded-full transition-all', notaBarra)} style={{ width: `${analise.nota}%` }} />
                </div>
                {analise.faltando.length > 0 && (
                  <div>
                    <p className="mb-1 text-[12px] font-semibold text-danger">Está faltando</p>
                    <ul className="space-y-1">
                      {analise.faltando.map((f, i) => <li key={i} className="flex items-start gap-1.5 text-[12.5px] text-fg"><Icon name="alert" size={12} className="mt-0.5 shrink-0 text-danger" /> {f}</li>)}
                    </ul>
                  </div>
                )}
                {analise.sugestoes.length > 0 && (
                  <div>
                    <p className="mb-1 text-[12px] font-semibold text-lime-ink">Sugestões da NICO</p>
                    <ul className="space-y-1">
                      {analise.sugestoes.map((s, i) => <li key={i} className="flex items-start gap-1.5 text-[12.5px] text-fg"><Icon name="sparkles" size={12} className="mt-0.5 shrink-0 text-brand" /> {s}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </Painel>

      {/* ================= COCKPIT 3 PAINÉIS ================= */}
      <div className="grid gap-4 xl:grid-cols-3">
        {/* ---- conversa ao vivo ---- */}
        <Painel
          titulo="Conversa ao vivo"
          className="flex min-h-[520px] flex-col"
          corpo="flex min-h-0 flex-1 flex-col p-0"
          acao={
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTesteAberto(true)}>
              <Icon name="whatsapp" size={14} /> Testar no WhatsApp
            </button>
          }
        >
          {conversas && conversas.length > 1 && (
            <div className="border-b border-line px-4 py-2">
              <select className="input h-8 w-full text-[12.5px]" value={sel ?? ''} onChange={(e) => setSel(e.target.value)} aria-label="Escolher conversa">
                {conversas.map((c) => <option key={c.id} value={c.id}>{c.contato?.nome ?? 'Contato'} {c.naoLidas > 0 ? `(${c.naoLidas})` : ''}</option>)}
              </select>
            </div>
          )}
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto scrollbar-thin px-4 py-4">
            {!conversaSel && (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <Icon name="chat" size={28} className="text-muted" />
                <p className="text-[13px] text-muted">Nenhuma conversa ativa com este agente.<br />Teste no WhatsApp ou torne-o o agente padrão.</p>
              </div>
            )}
            {conversaSel && !thread && <p className="py-8 text-center text-[12.5px] text-muted">Carregando conversa…</p>}
            {thread?.map((m) => {
              const minha = m.de !== 'contato';
              const ia = m.de === 'ia';
              return (
                <div key={m.id} className={cx('flex', minha ? 'justify-end' : 'justify-start')}>
                  <div className={cx('max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed shadow-sm',
                    !minha && 'rounded-bl-md border border-line bg-[var(--base-0)] text-fg',
                    minha && !ia && 'rounded-br-md bg-brand text-white',
                    ia && 'rounded-br-md border border-[color-mix(in_srgb,var(--brand)_18%,transparent)] bg-brand-soft text-fg')}>
                    {ia && <p className="mb-0.5 flex items-center gap-1 text-[10.5px] font-semibold text-brand"><Icon name="sparkles" size={10} /> {agente.nome}</p>}
                    <span className="whitespace-pre-wrap break-words">{m.texto}</span>
                    <span className={cx('mt-0.5 block text-right text-[10px] tabular', minha && !ia ? 'text-white/75' : 'text-muted')}>{m.hora ?? ''}</span>
                  </div>
                </div>
              );
            })}
            <div ref={fimRef} />
          </div>
          {conversaSel && (
            <div className="border-t border-line px-4 py-2.5">
              <p className="flex items-center gap-1.5 text-[11.5px] text-muted"><Icon name="check" size={12} className="text-lime-ink" /> {agente.nome} conectado(a) à conversa · <Link href="/conversas" className="font-medium text-brand underline underline-offset-2">abrir no Inbox</Link></p>
            </div>
          )}
        </Painel>

        {/* ---- fluxo operacional ---- */}
        <Painel titulo="Fluxo operacional" descricao={runAtual ? `${concluidos}/${passos.length} concluído` : undefined} className="min-h-[520px]">
          {!runAtual && <p className="py-8 text-center text-[12.5px] text-muted">O agente ainda não atendeu nenhuma mensagem. O passo a passo real aparece aqui.</p>}
          {runAtual && (
            <ol className="relative space-y-0.5">
              {passos.map((p, i) => (
                <li key={i} className="flex items-start gap-3 py-1.5">
                  <span className={cx('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full', p.ok ? 'bg-[var(--khub-lime)] text-[#2b3a00]' : 'bg-[var(--base-2)] text-muted')}>
                    <Icon name={p.ok ? 'check' : 'clock'} size={13} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-fg">{p.rotulo}</p>
                    {p.detalhe && <p className="truncate text-[11.5px] text-muted">{p.detalhe}</p>}
                  </div>
                  <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold', COR_TAG[p.tag])}>{p.tag}</span>
                </li>
              ))}
            </ol>
          )}
          {runAtual && (
            <div className={cx('mt-4 flex items-center gap-2 rounded-xl border p-3 text-[12.5px] font-medium',
              runAtual.status === 'erro' ? 'border-danger/40 bg-danger/5 text-danger' : 'border-[color-mix(in_srgb,var(--khub-lime)_45%,transparent)] bg-lime-soft text-lime-ink')}>
              <Icon name={runAtual.status === 'erro' ? 'alert' : 'check'} size={15} />
              {runAtual.status === 'respondido' && `Respondeu · ${runAtual.contatoNome}${runAtual.latenciaMs ? ` · ${(runAtual.latenciaMs / 1000).toFixed(1)}s` : ''}`}
              {runAtual.status === 'transferido' && `Transferiu para a equipe · ${runAtual.contatoNome}`}
              {runAtual.status === 'ignorado' && `Ficou em silêncio · ${runAtual.contatoNome}`}
              {runAtual.status === 'processando' && `Atendendo agora · ${runAtual.contatoNome}…`}
              {runAtual.status === 'erro' && `Erro · ${runAtual.motivo ?? 'falha no atendimento'}`}
            </div>
          )}
          {atividade.length > 1 && (
            <div className="mt-4 border-t border-line pt-3">
              <p className="mb-2 text-[11.5px] font-semibold text-muted">Atendimentos recentes</p>
              <ul className="space-y-1.5">
                {atividade.slice(0, 6).map((r) => (
                  <li key={r.id} className="flex items-center gap-2 text-[12px] text-muted">
                    <Icon name={r.status === 'erro' ? 'alert' : 'check'} size={12} className={r.status === 'erro' ? 'text-danger' : 'text-lime-ink'} />
                    <button type="button" className="truncate text-left hover:text-fg" onClick={() => setSel(r.conversaId)}>{r.contatoNome}</button>
                    <span className="ml-auto shrink-0 tabular">{new Date(r.criadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Painel>

        {/* ---- CRM ---- */}
        <Painel titulo="CRM" className="min-h-[520px]">
          {!conversaSel?.contato && <p className="py-8 text-center text-[12.5px] text-muted">Selecione uma conversa para ver o contato, negócios e tarefas ligados a ela.</p>}
          {conversaSel?.contato && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-xl border border-line bg-[var(--base-1)] p-3">
                <AvatarContato nome={conversaSel.contato.nome} fotoUrl={conversaSel.contato.fotoUrl} size={44} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-fg">{conversaSel.contato.nome}</p>
                  <p className="text-[12px] text-muted tabular">{conversaSel.contato.telefone ?? 'sem telefone'}</p>
                </div>
                <Link href={`/leads/${conversaSel.contato.id}`} className="btn btn-ghost btn-sm shrink-0">Ver contato</Link>
              </div>
              {contato360 && (
                <>
                  <div className="grid grid-cols-2 gap-2 text-center">
                    <div className="rounded-xl border border-line bg-[var(--base-1)] p-3">
                      <p className="text-xl font-bold tabular text-fg">{contato360.negocios.length}</p>
                      <p className="text-[11px] text-muted">negócios</p>
                    </div>
                    <div className="rounded-xl border border-line bg-[var(--base-1)] p-3">
                      <p className="text-xl font-bold tabular text-fg">{contato360.tarefas.filter((t) => !t.completedAt).length}</p>
                      <p className="text-[11px] text-muted">tarefas abertas</p>
                    </div>
                  </div>
                  {contato360.negocios.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-[11.5px] font-semibold text-muted">Negócios</p>
                      <ul className="space-y-1.5">
                        {contato360.negocios.slice(0, 4).map((n) => (
                          <li key={n.id} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-[12.5px]">
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: n.cor }} />
                            <span className="truncate text-fg">{n.titulo}</span>
                            <span className="ml-auto shrink-0 text-muted">{n.stage}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
              {!contato360 && <p className="text-center text-[12px] text-muted">Carregando CRM…</p>}
            </div>
          )}
        </Painel>
      </div>

      {/* ---- modal: testar no WhatsApp ---- */}
      <Modal aberto={testeAberto} onFechar={() => setTesteAberto(false)} titulo="Testar no WhatsApp de verdade">
        <div className="space-y-3">
          <p className="text-[13px] text-muted">Escolha o contato (pode ser o seu próprio número). A conversa dele passa a ser atendida por <strong className="text-fg">{agente.nome}</strong> — cada mensagem que chegar é respondida pelo agente e aparece aqui e no Inbox.</p>
          <input className="input" placeholder="Buscar contato por nome ou telefone…" value={busca} onChange={(e) => void buscarContatos(e.target.value)} aria-label="Buscar contato" />
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {achados.map((a) => (
              <li key={a.id}>
                <button type="button" disabled={testando} onClick={() => void iniciarTeste(a.id)} className="flex w-full items-center gap-2 rounded-lg border border-line px-3 py-2 text-left text-[13px] hover:border-brand/40 hover:bg-brand-soft/40">
                  <Icon name="user" size={14} className="text-muted" />
                  <span className="flex-1 truncate text-fg">{a.titulo}</span>
                  <span className="text-[11.5px] text-muted">{a.subtitulo}</span>
                </button>
              </li>
            ))}
            {busca.trim().length >= 2 && achados.length === 0 && <li className="py-4 text-center text-[12.5px] text-muted">Nenhum contato encontrado.</li>}
          </ul>
        </div>
      </Modal>
    </div>
  );
}
