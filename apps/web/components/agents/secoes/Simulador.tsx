'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { ApiError } from '@/lib/api-error';
import {
  agentesApi,
  dataHora,
  inteiro,
  usd,
  valorTexto,
  ROTULO_CAMPO_PERFIL,
  ROTULO_INTENCAO,
  ROTULO_OBJECAO,
  type Expectativas,
  type Simulacao,
  type TraceRun,
  type TraceSimulacao,
} from '@/lib/agents';
import { Campo, Confirmar, Erro, Esqueleto, ListaTextos, Modal, Painel, Vazio, mensagemDeErro, useAcao, useCarga, useToast } from '../kit';
import type { SecaoProps } from '../editor';

// ------------------------------------------------------------------ utilidades compartilhadas (Logs reutiliza)

export const ROTULO_DECISAO: Record<string, string> = {
  responder: 'Responder',
  transferir: 'Transferir para a equipe',
  silenciar: 'Não responder',
  recusa: 'Recusa do modelo',
  sem_resposta: 'Sem resposta',
};

const ROTULO_DECISAO_EXTRACAO: Record<string, string> = {
  aplicado: 'Aplicado',
  pendente_revisao: 'Revisão humana',
  ignorado_confianca: 'Ignorado (confiança baixa)',
  ignorado_politica: 'Ignorado (política)',
  ignorado_confirmado: 'Ignorado (já confirmado)',
};

export const porcento =(n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? '-' : `${Math.round(n * 100)}%`);
export const duracao = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n) ? '-' : n >= 1000 ? `${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s` : `${Math.round(n)} ms`;
const rotuloDe = (mapa: Record<string, string>, v: string | null | undefined) => (v ? mapa[v] ?? v : '-');
const hora = (s: string) => {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

function Bloco({ titulo, children, contagem, aberto = true }: { titulo: string; children: ReactNode; contagem?: number; aberto?: boolean }) {
  return (
    <details open={aberto} className="group rounded-xl border border-line bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-[13px] font-semibold text-fg hover:bg-surface2/70 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          {titulo}
          {typeof contagem === 'number' && <span className="pill tabular">{contagem}</span>}
        </span>
        <Icon name="chevronDown" size={14} className="shrink-0 text-muted transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-line px-3.5 py-3 text-[13px] text-fg">{children}</div>
    </details>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5">
      <dt className="text-muted">{rotulo}</dt>
      <dd className="min-w-0 break-words text-right font-medium text-fg">{children}</dd>
    </div>
  );
}

function StatusExecucao({ ok, pendente, erro, simulado }: { ok: boolean; pendente?: boolean; erro?: string; simulado?: boolean }) {
  if (pendente) return <span className="pill pill-warning">Aguardando aprovação</span>;
  if (ok) return <span className="pill pill-success">{simulado ? 'Simulada' : 'Executada'}</span>;
  return <span className="pill pill-danger" title={erro}>Falhou</span>;
}

export interface TraceDetalheProps {
  trace: TraceRun;
  recebido?: string[];
  resposta?: string;
  blocosTexto?: { ordem: number; texto: string; atrasoMs: number }[];
  tokens?: { entrada: number; saida: number };
  custoUsd?: number;
  /** Simulador: escritas no CRM não acontecem de verdade. */
  simulado?: boolean;
}

/** Trace estruturado de um turno/execução. Só decisões e resultados; não existe raciocínio privado no trace. */
export function TraceDetalhe({ trace, recebido, resposta, blocosTexto, tokens, custoUsd, simulado }: TraceDetalheProps) {
  const a = trace.analise;
  const c = trace.conhecimento;
  const r = trace.regras;
  const f = trace.fragmentacao;
  const m = trace.memoria;
  const t = trace.tempos;
  const extracoes = trace.extracoes ?? [];
  const ferramentas = trace.ferramentas ?? [];
  const validacao = trace.validacao ?? [];
  return (
    <div className="space-y-2.5">
      <Bloco titulo="Decisão operacional">
        <p className="font-semibold">{rotuloDe(ROTULO_DECISAO, trace.decisao)}</p>
        {trace.motivo && <p className="mt-1 text-muted">Motivo: {trace.motivo}</p>}
      </Bloco>

      {recebido && recebido.length > 0 && (
        <Bloco titulo="Mensagem recebida" contagem={recebido.length}>
          <ul className="space-y-1.5">
            {recebido.map((msg, i) => (
              <li key={i} className="whitespace-pre-wrap break-words rounded-lg bg-surface2 px-2.5 py-1.5">{msg}</li>
            ))}
          </ul>
        </Bloco>
      )}

      {a && (
        <Bloco titulo="Análise da mensagem">
          <dl className="divide-y divide-line">
            <Linha rotulo="Intenção">
              {rotuloDe(ROTULO_INTENCAO, a.intencao)} · {porcento(a.confiancaIntencao)} · {a.fonte === 'modelo' ? 'modelo' : 'heurística'}
            </Linha>
            {(a.intencoesSecundarias ?? []).length > 0 && <Linha rotulo="Intenções secundárias">{a.intencoesSecundarias.map((i) => rotuloDe(ROTULO_INTENCAO, i)).join(', ')}</Linha>}
            <Linha rotulo="Problema">{a.problema || '-'}</Linha>
            <Linha rotulo="Sentimento">{a.sentimento || '-'}</Linha>
            <Linha rotulo="Urgência">{a.urgencia || '-'}</Linha>
            <Linha rotulo="Temperatura">{a.temperatura || '-'}</Linha>
            {a.interesse && <Linha rotulo="Interesse">{a.interesse}</Linha>}
            <Linha rotulo="Objeções">{(a.objecoes ?? []).length ? a.objecoes.map((o) => rotuloDe(ROTULO_OBJECAO, o)).join(', ') : 'nenhuma'}</Linha>
            <Linha rotulo="Precisa consultar a base">{a.precisaConhecimento ? 'sim' : 'não'}</Linha>
            <Linha rotulo="Pediu atendimento humano">{a.pedeHumano ? 'sim' : 'não'}</Linha>
            {a.proximoPasso && <Linha rotulo="Próximo passo">{a.proximoPasso}</Linha>}
          </dl>
        </Bloco>
      )}

      {m && (
        <Bloco titulo="Memórias usadas">
          <dl className="divide-y divide-line">
            <Linha rotulo="Resumo da conversa">{m.resumo ? 'usado' : 'não usado'}</Linha>
            <Linha rotulo="Memórias de longo prazo">{inteiro(m.longoPrazo)}</Linha>
            <Linha rotulo="Memórias operacionais">{inteiro(m.operacional)}</Linha>
          </dl>
        </Bloco>
      )}

      {c && (
        <Bloco titulo="Fontes consultadas" contagem={c.fontes?.length ?? 0}>
          {c.consulta ? <p className="text-muted">Consulta: <span className="text-fg">{c.consulta}</span></p> : <p className="text-muted">A base não foi consultada neste turno.</p>}
          {c.confianca && (
            <p className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className={cx('pill', c.confianca.nivel === 'alta' ? 'pill-success' : c.confianca.nivel === 'media' ? 'pill-info' : 'pill-warning')}>Confiança {c.confianca.nivel}</span>
              <span className="text-muted">{c.confianca.motivo}</span>
            </p>
          )}
          {(c.fontes ?? []).length > 0 && (
            <ul className="mt-2 space-y-1">
              {c.fontes.map((fo) => (
                <li key={fo.chunkId} className="flex items-center gap-2"><Icon name="file" size={13} className="shrink-0 text-muted" /><span className="truncate">{fo.titulo}</span></li>
              ))}
            </ul>
          )}
          {(c.conflitos ?? []).length > 0 && (
            <div className="mt-2 rounded-lg border border-warning-border bg-warning-soft px-2.5 py-2">
              <p className="font-medium">Conflitos entre fontes</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted">{c.conflitos.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </div>
          )}
        </Bloco>
      )}

      {r && (
        <Bloco titulo="Regras disparadas" contagem={r.disparadas?.length ?? 0}>
          {(r.disparadas ?? []).length === 0 ? (
            <p className="text-muted">Nenhuma regra disparou.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">{r.disparadas.map((d) => <li key={d.regraId} className="pill pill-brand">{d.nome}</li>)}</ul>
          )}
          {(r.instrucoes ?? []).length > 0 && (
            <div className="mt-2">
              <p className="text-muted">Instruções aplicadas</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">{r.instrucoes.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </div>
          )}
          {(r.acoes ?? []).length > 0 && (
            <ul className="mt-2 space-y-1">
              {r.acoes.map((ac, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{ac.acao}</span>
                  <StatusExecucao ok={ac.ok} pendente={ac.pendente} erro={ac.erro} simulado={simulado} />
                </li>
              ))}
            </ul>
          )}
          {r.iniciarFollowup && <p className="mt-2 text-muted">Follow-up solicitado: <span className="text-fg">{r.iniciarFollowup}</span></p>}
        </Bloco>
      )}

      <Bloco titulo="Ferramentas acionadas" contagem={ferramentas.length} aberto={ferramentas.length > 0}>
        {ferramentas.length === 0 ? (
          <p className="text-muted">Nenhuma ferramenta foi acionada.</p>
        ) : (
          <ul className="space-y-1.5">
            {ferramentas.map((fe, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-[12.5px]">{fe.nome}</span>
                <StatusExecucao ok={fe.ok} pendente={fe.pendente} erro={fe.erro} simulado={simulado} />
                {fe.erro && <span className="w-full text-xs text-danger">{fe.erro}</span>}
              </li>
            ))}
          </ul>
        )}
        {simulado && ferramentas.length > 0 && <p className="mt-2 text-xs text-muted">No simulador as ferramentas de escrita não alteram o CRM.</p>}
      </Bloco>

      <Bloco titulo="Dados extraídos" contagem={extracoes.length} aberto={extracoes.length > 0}>
        {extracoes.length === 0 ? (
          <p className="text-muted">Nenhum dado de perfil extraído.</p>
        ) : (
          <ul className="space-y-2">
            {extracoes.map((ex, i) => (
              <li key={i} className="rounded-lg bg-surface2 px-2.5 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{rotuloDe(ROTULO_CAMPO_PERFIL, ex.campo)}</span>
                  <span className={cx('pill', ex.decisao === 'aplicado' ? 'pill-success' : ex.decisao === 'pendente_revisao' ? 'pill-warning' : '')}>{ROTULO_DECISAO_EXTRACAO[ex.decisao] ?? ex.decisao}</span>
                </div>
                <p className="mt-0.5 break-words">{valorTexto(ex.valor)}</p>
                <p className="mt-0.5 text-xs text-muted">Origem {ex.origem} · confiança {porcento(ex.confianca)}{ex.motivo ? ` · ${ex.motivo}` : ''}</p>
              </li>
            ))}
          </ul>
        )}
      </Bloco>

      {(validacao.length > 0 || trace.guardrail) && (
        <Bloco titulo="Validação e guardrail">
          {trace.guardrail && (
            <div className="rounded-lg border border-danger-border bg-danger-soft px-2.5 py-2">
              <p className="font-medium">Guardrail acionado: {trace.guardrail.regra}</p>
              <p className="mt-0.5 text-muted">{trace.guardrail.motivo}</p>
            </div>
          )}
          {validacao.length > 0 && <ul className={cx('list-disc space-y-0.5 pl-4 text-muted', trace.guardrail && 'mt-2')}>{validacao.map((v, i) => <li key={i}>{v}</li>)}</ul>}
        </Bloco>
      )}

      {resposta !== undefined && (
        <Bloco titulo="Resposta gerada">
          {resposta ? <p className="whitespace-pre-wrap break-words">{resposta}</p> : <p className="text-muted">Nenhuma resposta gerada.</p>}
        </Bloco>
      )}

      {f && (
        <Bloco titulo="Fragmentação" contagem={f.blocos?.length ?? 0}>
          <p className="text-muted">Estratégia: <span className="text-fg">{f.estrategia}</span></p>
          {(f.ajustes ?? []).length > 0 && <p className="mt-1 text-muted">Ajustes: <span className="text-fg">{f.ajustes.join(', ')}</span></p>}
          {(f.blocos ?? []).length > 0 && (
            <ol className="mt-2 space-y-1.5">
              {f.blocos.map((b) => {
                const txt = blocosTexto?.find((x) => x.ordem === b.ordem)?.texto;
                return (
                  <li key={b.ordem} className="rounded-lg bg-surface2 px-2.5 py-1.5">
                    <p className="text-xs text-muted">Bloco {b.ordem} · {inteiro(b.caracteres)} caracteres · espera {duracao(b.atrasoMs)}</p>
                    {txt && <p className="mt-0.5 whitespace-pre-wrap break-words">{txt}</p>}
                  </li>
                );
              })}
            </ol>
          )}
        </Bloco>
      )}

      {(t || tokens || custoUsd !== undefined || (trace.modelos ?? []).length > 0) && (
        <Bloco titulo="Tempos, modelos e custo">
          <dl className="divide-y divide-line">
            {t && (
              <>
                <Linha rotulo="Análise">{duracao(t.analiseMs)}</Linha>
                <Linha rotulo="Conhecimento">{duracao(t.conhecimentoMs)}</Linha>
                <Linha rotulo="Geração">{duracao(t.geracaoMs)}</Linha>
                <Linha rotulo="Total">{duracao(t.totalMs)}</Linha>
              </>
            )}
            {(trace.modelos ?? []).length > 0 && <Linha rotulo="Modelos">{(trace.modelos ?? []).join(', ')}</Linha>}
            {tokens && <Linha rotulo="Tokens (entrada / saída)">{inteiro(tokens.entrada)} / {inteiro(tokens.saida)}</Linha>}
            {custoUsd !== undefined && <Linha rotulo="Custo">{usd(custoUsd)}</Linha>}
          </dl>
        </Bloco>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ simulador

type MarcadorSessao = Extract<Simulacao['traces'][number], { tipo: 'sessao' }>;
const ehTurno = (t: Simulacao['traces'][number]): t is TraceSimulacao => t.tipo === 'turno';
const ehSessao = (t: Simulacao['traces'][number]): t is MarcadorSessao => t.tipo === 'sessao';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RAJADA = 5;

/** Agent Simulator: conversa de teste com o agente, sem WhatsApp e sem ações reais. */
export function Simulador({ agente, catalogo }: SecaoProps) {
  const toast = useToast();
  const { ocupado, executar } = useAcao();
  const personas = useCarga(() => agentesApi.personas(), []);
  const sessoes = useCarga(() => agentesApi.simulacoes(agente.id), [agente.id]);

  const [persona, setPersona] = useState('livre');
  const [contactId, setContactId] = useState('');
  const [usarRascunho, setUsarRascunho] = useState(true);
  const [sessao, setSessao] = useState<Simulacao | null>(null);
  const [rajada, setRajada] = useState<string[]>([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [gerandoCliente, setGerandoCliente] = useState(false);
  const [ocultas, setOcultas] = useState(0);
  const [turnoSel, setTurnoSel] = useState<number | null>(null);
  const [excluir, setExcluir] = useState<string | null>(null);
  const [cenarioAberto, setCenarioAberto] = useState(false);
  const timers = useRef<number[]>([]);
  const chatRef = useRef<HTMLDivElement>(null);

  const limparTimers = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  };
  useEffect(() => () => limparTimers(), []);

  const temPublicada = !!agente.versaoPublicada;
  const turnos = useMemo(() => (sessao?.traces ?? []).filter(ehTurno), [sessao]);
  const marcador = useMemo(() => (sessao?.traces ?? []).find(ehSessao), [sessao]);
  const idxTurno = turnoSel ?? turnos.length - 1;
  const turnoAtual = idxTurno >= 0 ? turnos[idxTurno] : undefined;
  const mensagens = sessao?.mensagens ?? [];
  const visiveis = mensagens.slice(0, Math.max(0, mensagens.length - ocultas));

  // Cada turno ocupa recebido.length mensagens do contato + blocos.length do agente.
  const turnoDaMensagem = useMemo(() => {
    const mapa: (number | null)[] = [];
    let i = 0;
    turnos.forEach((t, ti) => {
      const n = (t.recebido?.length ?? 0) + (t.blocos?.length ?? 0);
      for (let k = 0; k < n && i < mensagens.length; k++) mapa[i++] = ti;
    });
    while (i < mensagens.length) mapa[i++] = null;
    return mapa;
  }, [turnos, mensagens]);

  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visiveis.length, ocultas]);

  const nomePersona = (id: string) => personas.dados?.find((p) => p.id === id)?.nome ?? id;

  const escolherPersona = (id: string) => {
    setPersona(id);
    const p = personas.dados?.find((x) => x.id === id);
    if (!p) return;
    if (p.mensagensIniciais.length <= 1) {
      setRajada([]);
      setTexto(p.mensagensIniciais[0] ?? '');
    } else {
      setRajada(p.mensagensIniciais.slice(0, MAX_RAJADA));
      setTexto('');
    }
  };

  const abrirSessao = (s: Simulacao) => {
    limparTimers();
    setOcultas(0);
    setTurnoSel(null);
    setSessao(s);
  };

  const criarSessao = async (): Promise<Simulacao | null> => {
    const cid = contactId.trim();
    if (cid && !UUID.test(cid)) {
      toast('erro', 'O ID do contato precisa ser um UUID válido');
      return null;
    }
    const s = await executar('criar', () => agentesApi.criarSimulacao(agente.id, { perfil: persona, contactId: cid || undefined, usarRascunho: temPublicada ? usarRascunho : true }));
    if (s) {
      abrirSessao(s);
      void sessoes.recarregar();
    }
    return s;
  };

  const animar = (atrasos: number[], n: number) => {
    const reduzir = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduzir || n === 0) {
      setOcultas(0);
      return;
    }
    setOcultas(n);
    let acumulado = 0;
    for (let i = 0; i < n; i++) {
      acumulado += Math.min(4000, Math.max(180, (atrasos[i] ?? 0) / 4));
      const restantes = n - i - 1;
      timers.current.push(window.setTimeout(() => setOcultas(restantes), acumulado));
    }
  };

  const adicionarRajada = () => {
    const t = texto.trim();
    if (!t || rajada.length >= MAX_RAJADA) return;
    setRajada((r) => [...r, t]);
    setTexto('');
  };

  const enviar = async () => {
    const msgs = [...rajada, texto].map((x) => x.trim()).filter(Boolean);
    if (!msgs.length || enviando) return;
    if (msgs.length > MAX_RAJADA) {
      toast('erro', `Envie no máximo ${MAX_RAJADA} mensagens por rajada`);
      return;
    }
    setEnviando(true);
    try {
      const s = sessao ?? (await criarSessao());
      if (!s) return;
      const r = await agentesApi.turno(s.id, msgs);
      const agora = new Date().toISOString();
      const recebido = r.trace.recebido?.length ? r.trace.recebido : msgs;
      limparTimers();
      setSessao({
        ...s,
        mensagens: [...s.mensagens, ...recebido.map((x) => ({ de: 'contato' as const, texto: x, em: agora })), ...r.resposta],
        traces: [...s.traces, r.trace],
        custoUsd: Number(s.custoUsd) + Number(r.trace.custoUsd ?? 0),
      });
      setTurnoSel(null);
      setRajada([]);
      setTexto('');
      animar((r.trace.blocos ?? []).map((b) => b.atrasoMs), r.resposta.length);
      if (!r.iaConfigurada) toast('info', 'A IA não está conectada: o turno usou a análise heurística e o agente transfere a conversa para a equipe.');
      void sessoes.recarregar();
    } catch (e) {
      toast('erro', mensagemDeErro(e));
    } finally {
      setEnviando(false);
    }
  };

  const clienteAutomatico = async () => {
    const s = sessao ?? (await criarSessao());
    if (!s) return;
    setGerandoCliente(true);
    try {
      const r = await agentesApi.clienteAutomatico(s.id);
      setTexto(r.mensagem);
    } catch (e) {
      if (e instanceof ApiError && e.configRequired) toast('info', 'O cliente automático usa IA para escrever como o contato. Conecte a IA em Configurações, Integrações, para usar este recurso.');
      else toast('erro', mensagemDeErro(e));
    } finally {
      setGerandoCliente(false);
    }
  };

  const abrir = async (id: string) => {
    const s = await executar(`abrir:${id}`, () => agentesApi.simulacao(id));
    if (!s) return;
    abrirSessao(s);
    setPersona(s.perfil);
    const cfg = s.traces.find(ehSessao);
    if (cfg) {
      setContactId(cfg.contactId ?? '');
      setUsarRascunho(cfg.usarRascunho);
    }
  };

  const confirmarExclusao = async () => {
    const id = excluir;
    setExcluir(null);
    if (!id) return;
    const ok = await executar(`excluir:${id}`, () => agentesApi.removerSimulacao(id), 'Sessão excluída');
    if (ok) {
      if (sessao?.id === id) {
        limparTimers();
        setSessao(null);
      }
      void sessoes.recarregar();
    }
  };

  const total = rajada.length + (texto.trim() ? 1 : 0);
  const temContato = mensagens.some((x) => x.de === 'contato');
  const personaAtual = personas.dados?.find((p) => p.id === persona);

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2.5 rounded-xl border border-info-border bg-info-soft px-4 py-3 text-[13.5px] text-fg">
        <Icon name="shield" size={16} className="mt-0.5 shrink-0" />
        <p>
          Ambiente de teste. Nada é enviado ao WhatsApp e nenhuma ação real é executada: ferramentas de escrita no CRM são apenas simuladas. A base de conhecimento e o perfil de um contato real escolhido são só lidos.
        </p>
      </div>

      <Painel titulo="Sessão de teste" descricao="Escolha o tipo de cliente, a versão do agente e, se quiser, um contato real para carregar perfil e memória (somente leitura).">
        <div className="grid gap-4 md:grid-cols-3">
          <Campo rotulo="Persona do cliente" dica={personaAtual?.descricao}>
            {personas.erro ? (
              <button className="btn btn-ghost btn-sm" onClick={() => void personas.recarregar()}><Icon name="refresh" size={14} /> Recarregar personas</button>
            ) : (
              <select className="select" value={persona} disabled={personas.carregando && !personas.dados} onChange={(e) => escolherPersona(e.target.value)}>
                {(personas.dados ?? [{ id: 'livre', nome: 'Conversa livre' }]).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            )}
          </Campo>
          <Campo rotulo="Contato real (opcional)" dica="ID (UUID) do contato. Perfil e memórias são lidos, nunca alterados.">
            <input className="input font-mono text-[12.5px]" value={contactId} onChange={(e) => setContactId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" spellCheck={false} />
          </Campo>
          <div>
            <span className="mb-1.5 block text-[13px] font-medium text-fg">Versão testada</span>
            <div className="segbar" role="tablist" aria-label="Versão testada">
              <button type="button" role="tab" aria-selected={usarRascunho || !temPublicada} className="seg" onClick={() => setUsarRascunho(true)}>Usar rascunho</button>
              <button type="button" role="tab" aria-selected={!usarRascunho && temPublicada} className="seg disabled:cursor-not-allowed disabled:opacity-50" disabled={!temPublicada} onClick={() => setUsarRascunho(false)}>
                Versão publicada{agente.versaoPublicada ? ` v${agente.versaoPublicada.numero}` : ''}
              </button>
            </div>
            {!temPublicada && <span className="mt-1 block text-xs text-muted">Ainda não há versão publicada.</span>}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button className="btn btn-primary btn-sm" disabled={ocupado === 'criar'} onClick={() => void criarSessao()}><Icon name="plus" size={14} /> {ocupado === 'criar' ? 'Criando…' : 'Nova sessão'}</button>
          {sessao && <span className="text-xs text-muted">A persona, o contato e a versão valem para a próxima sessão criada.</span>}
        </div>
      </Painel>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="card flex min-w-0 flex-col overflow-hidden" aria-label="Conversa simulada">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0">
              <p className="t-section truncate">{sessao ? `Sessão de ${dataHora(sessao.createdAt)}` : 'Nenhuma sessão aberta'}</p>
              <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted">
                {sessao ? (
                  <>
                    <span>{nomePersona(sessao.perfil)}</span>
                    <span>·</span>
                    <span>{marcador?.usarRascunho === false ? 'Versão publicada' : 'Rascunho'}</span>
                    {marcador?.contactId && <><span>·</span><span>Contato real</span></>}
                    <span>·</span>
                    <span>{usd(sessao.custoUsd)}</span>
                  </>
                ) : (
                  <span>Envie uma mensagem para começar uma sessão com a configuração acima.</span>
                )}
              </p>
            </div>
            {sessao && (
              <button className="btn btn-soft btn-sm" disabled={!temContato} onClick={() => setCenarioAberto(true)} title={temContato ? undefined : 'A sessão precisa ter mensagens do contato'}>
                <Icon name="check2" size={14} /> Salvar como cenário de teste
              </button>
            )}
          </header>

          <div ref={chatRef} className="h-[440px] space-y-2 overflow-y-auto bg-surface2/60 px-3 py-4 sm:h-[520px]" aria-live="polite">
            {visiveis.length === 0 && (
              <div className="flex h-full items-center justify-center text-center text-[13.5px] text-muted">
                <p className="max-w-xs">Escreva como o cliente. Use a rajada para mandar várias mensagens seguidas, como alguém que interrompe.</p>
              </div>
            )}
            {visiveis.map((msg, i) => {
              const ti = turnoDaMensagem[i] ?? null;
              const contato = msg.de === 'contato';
              const selecionado = ti !== null && ti === idxTurno;
              const turno = ti !== null ? turnos[ti] : undefined;
              const fimDoTurno = ti !== null && turnoDaMensagem[i + 1] !== ti;
              return (
                <div key={i}>
                  <div className={cx('flex', contato ? 'justify-end' : 'justify-start')}>
                    <button
                      type="button"
                      aria-pressed={selecionado}
                      disabled={ti === null}
                      onClick={() => ti !== null && setTurnoSel(ti)}
                      title={ti !== null ? `Ver turno ${ti + 1} no painel técnico` : undefined}
                      className={cx(
                        'max-w-[85%] animate-fade-in whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-left text-[14px] leading-snug text-fg shadow-sm',
                        contato ? 'rounded-br-md bg-brand-soft' : 'rounded-bl-md border border-line bg-surface',
                        selecionado && 'ring-2 ring-brand-border',
                      )}
                    >
                      <span className="sr-only">{contato ? 'Contato: ' : 'Agente: '}</span>
                      {msg.texto}
                      <span className="mt-1 block text-right text-[10.5px] text-faint">{hora(msg.em)}</span>
                    </button>
                  </div>
                  {fimDoTurno && turno && (turno.blocos?.length ?? 0) === 0 && (
                    <p className="mx-auto mt-2 w-max max-w-full rounded-full bg-surface3 px-3 py-1 text-center text-[11.5px] text-muted">
                      Agente decidiu: {rotuloDe(ROTULO_DECISAO, turno.decisao)}{turno.motivo ? ` (${turno.motivo})` : ''}
                    </p>
                  )}
                </div>
              );
            })}
            {(ocultas > 0 || enviando) && (
              <div className="flex justify-start">
                <span className="rounded-2xl rounded-bl-md border border-line bg-surface px-3 py-2 text-[13px] text-muted">{enviando ? 'Processando…' : 'digitando…'}</span>
              </div>
            )}
          </div>

          <div className="border-t border-line p-3">
            {rajada.length > 0 && (
              <ol className="mb-2 flex flex-wrap gap-1.5" aria-label="Mensagens na rajada">
                {rajada.map((m, i) => (
                  <li key={i} className="pill pill-brand max-w-full">
                    <span className="truncate">{i + 1}. {m}</span>
                    <button type="button" aria-label={`Remover mensagem ${i + 1} da rajada`} className="opacity-70 hover:opacity-100" onClick={() => setRajada((r) => r.filter((_, k) => k !== i))}><Icon name="close" size={11} /></button>
                  </li>
                ))}
              </ol>
            )}
            <label htmlFor="simulador-composer" className="sr-only">Mensagem do contato</label>
            <textarea
              id="simulador-composer"
              className="textarea"
              rows={2}
              maxLength={2000}
              value={texto}
              placeholder="Escreva como o contato. Enter envia, Shift+Enter quebra a linha."
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void enviar();
                }
              }}
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <button type="button" className="btn btn-ghost btn-sm" disabled={gerandoCliente || enviando} onClick={() => void clienteAutomatico()}>
                <Icon name="ai" size={14} /> {gerandoCliente ? 'Gerando…' : 'Cliente automático'}
              </button>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-soft btn-sm" disabled={!texto.trim() || rajada.length >= MAX_RAJADA} onClick={adicionarRajada}>
                  <Icon name="plus" size={14} /> Adicionar à rajada
                </button>
                <button type="button" className="btn btn-primary btn-sm" disabled={!total || enviando} onClick={() => void enviar()}>
                  <Icon name="send" size={14} /> {enviando ? 'Enviando…' : total > 1 ? `Enviar (${total})` : 'Enviar'}
                </button>
              </div>
            </div>
          </div>
        </section>

        <Painel titulo="Painel técnico" descricao="Decisões estruturadas do turno selecionado. O trace não guarda raciocínio privado do modelo." corpo="p-5 pt-3">
          {!turnoAtual ? (
            <Vazio icone="list" titulo="Nenhum turno ainda" descricao="Envie uma mensagem para ver análise, regras, fontes, ferramentas e tempos do agente." />
          ) : (
            <div className="space-y-3">
              <Campo rotulo="Turno">
                <select className="select" value={idxTurno} onChange={(e) => setTurnoSel(Number(e.target.value))}>
                  {turnos.map((t, i) => (
                    <option key={i} value={i}>Turno {i + 1} · {rotuloDe(ROTULO_DECISAO, t.decisao)}</option>
                  ))}
                </select>
              </Campo>
              <p className="text-xs text-muted">
                {turnoAtual.versao === 'publicada' ? 'Versão publicada' : 'Rascunho'} · execução em {duracao(turnoAtual.execucaoMs)}
              </p>
              <TraceDetalhe
                trace={turnoAtual}
                recebido={turnoAtual.recebido}
                resposta={turnoAtual.resposta ?? ''}
                blocosTexto={turnoAtual.blocos}
                tokens={turnoAtual.tokens}
                custoUsd={turnoAtual.custoUsd}
                simulado
              />
              {Object.keys(turnoAtual.perfilDepois ?? {}).length > 0 && (
                <Bloco titulo="Perfil da sessão depois do turno" contagem={Object.keys(turnoAtual.perfilDepois).length} aberto={false}>
                  <ul className="space-y-1">
                    {Object.entries(turnoAtual.perfilDepois).map(([campo, fato]) => (
                      <li key={campo} className="flex flex-wrap justify-between gap-2">
                        <span className="text-muted">{rotuloDe(ROTULO_CAMPO_PERFIL, campo)}</span>
                        <span className="text-right">{valorTexto(fato.valor)} <span className="text-xs text-faint">({fato.status}, {porcento(fato.confianca)})</span></span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-muted">Este perfil vive só na sessão de teste.</p>
                </Bloco>
              )}
            </div>
          )}
        </Painel>
      </div>

      <Painel titulo="Sessões anteriores" descricao="Reabra uma conversa de teste para continuar ou revisar os turnos." corpo="p-0 pb-2">
        {sessoes.carregando && !sessoes.dados ? (
          <Esqueleto linhas={3} />
        ) : sessoes.erro ? (
          <Erro texto={sessoes.erro} tentar={() => void sessoes.recarregar()} />
        ) : !sessoes.dados?.length ? (
          <Vazio icone="chat" titulo="Nenhuma sessão de teste" descricao="As sessões criadas aparecem aqui." />
        ) : (
          <ul className="divide-y divide-line">
            {sessoes.dados.map((s) => (
              <li key={s.id} className={cx('flex flex-wrap items-center justify-between gap-3 px-5 py-3', sessao?.id === s.id && 'bg-brand-softer/60')}>
                <div className="min-w-0">
                  <p className="text-[13.5px] font-medium text-fg">{nomePersona(s.perfil)}</p>
                  <p className="text-xs text-muted">
                    Atualizada {dataHora(s.updatedAt)} · {inteiro(s.mensagens?.length ?? 0)} mensagens · {usd(s.custoUsd)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button className="btn btn-ghost btn-sm" disabled={ocupado === `abrir:${s.id}`} onClick={() => void abrir(s.id)}>
                    <Icon name="eye" size={14} /> {sessao?.id === s.id ? 'Aberta' : 'Abrir'}
                  </button>
                  <button className="btn btn-ghost btn-sm btn-icon" aria-label="Excluir sessão" title="Excluir" disabled={ocupado === `excluir:${s.id}`} onClick={() => setExcluir(s.id)}>
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Painel>

      <Confirmar
        aberto={!!excluir}
        titulo="Excluir sessão de teste"
        texto={<p>A conversa e os traces desta sessão serão apagados. Cenários de teste já salvos a partir dela continuam.</p>}
        confirmar="Excluir"
        perigo
        onConfirmar={() => void confirmarExclusao()}
        onFechar={() => setExcluir(null)}
      />

      {sessao && cenarioAberto && <ModalCenario sessaoId={sessao.id} catalogo={catalogo} onFechar={() => setCenarioAberto(false)} />}
    </div>
  );
}

function ModalCenario({ sessaoId, catalogo, onFechar }: { sessaoId: string; catalogo: SecaoProps['catalogo']; onFechar: () => void }) {
  const { ocupado, executar } = useAcao();
  const [nome, setNome] = useState('');
  const [deveConter, setDeveConter] = useState<string[]>([]);
  const [naoDeveConter, setNaoDeveConter] = useState<string[]>([]);
  const [intencao, setIntencao] = useState('');
  const [transferir, setTransferir] = useState<'indiferente' | 'sim' | 'nao'>('indiferente');

  const salvar = async () => {
    if (!nome.trim()) return;
    const exp: Expectativas = {};
    if (deveConter.length) exp.deveConter = deveConter;
    if (naoDeveConter.length) exp.naoDeveConter = naoDeveConter;
    if (intencao) exp.intencaoEsperada = intencao;
    if (transferir !== 'indiferente') exp.deveTransferir = transferir === 'sim';
    const r = await executar('cenario', () => agentesApi.cenarioDaSimulacao(sessaoId, nome.trim(), Object.keys(exp).length ? exp : undefined), 'Cenário de teste salvo. Ele entra nas próximas avaliações de regressão.');
    if (r) onFechar();
  };

  return (
    <Modal
      aberto
      onFechar={onFechar}
      titulo="Salvar como cenário de teste"
      largura="max-w-xl"
      rodape={
        <>
          <button className="btn btn-ghost" onClick={onFechar}>Cancelar</button>
          <button className="btn btn-primary" disabled={!nome.trim() || ocupado === 'cenario'} onClick={() => void salvar()}>{ocupado === 'cenario' ? 'Salvando…' : 'Salvar cenário'}</button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[13.5px] text-muted">As mensagens do contato desta sessão viram a entrada do cenário. As expectativas são opcionais e verificadas a cada avaliação.</p>
        <Campo rotulo="Nome do cenário"><input className="input" maxLength={120} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: cliente pede desconto e depois some" autoFocus /></Campo>
        <Campo rotulo="A resposta deve conter"><ListaTextos valores={deveConter} onChange={setDeveConter} max={10} placeholder="Ex.: avaliação" /></Campo>
        <Campo rotulo="A resposta não deve conter"><ListaTextos valores={naoDeveConter} onChange={setNaoDeveConter} max={10} placeholder="Ex.: desconto" /></Campo>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Intenção esperada">
            <select className="select" value={intencao} onChange={(e) => setIntencao(e.target.value)}>
              <option value="">Qualquer</option>
              {catalogo.intencoesBase.map((i) => <option key={i} value={i}>{ROTULO_INTENCAO[i] ?? i}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Deve transferir para a equipe">
            <select className="select" value={transferir} onChange={(e) => setTransferir(e.target.value as 'indiferente' | 'sim' | 'nao')}>
              <option value="indiferente">Indiferente</option>
              <option value="sim">Sim</option>
              <option value="nao">Não</option>
            </select>
          </Campo>
        </div>
      </div>
    </Modal>
  );
}
