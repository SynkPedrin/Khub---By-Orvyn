'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { automations, type MensagemNico, type PassoNico, type RunDetalhe } from '@/lib/automations';
import { ACENTO, ICONE } from './NoCanvas';
import { SeloNo } from './marcas';

const SUGESTOES = [
  'Quando entrar um lead novo do Meta, mandar boas-vindas no WhatsApp e, se não responder em 1 dia, criar uma tarefa para ligar.',
  'Um dia antes do agendamento, lembrar o contato no WhatsApp e avisar a equipe se ele não confirmar.',
  'Quando um negócio for ganho, agradecer no WhatsApp e marcar a tag cliente.',
];

const FINAIS = ['concluido', 'falhou', 'cancelado'];

/**
 * MODO SIMPLES — a pessoa conversa com a NICO; a NICO monta o fluxo (rascunho),
 * mostra o que cada passo faz e roda um teste REAL com dados reais de um
 * contato. Teste nunca toca a operação: mensagens só no número de teste,
 * o resto simulado (ver ExecutorService.emTeste na API). Publicar continua no
 * botão do cabeçalho: decisão humana.
 */
export function ModoSimples({ workflowId, passosNoCanvas, onMontado }: {
  workflowId: string;
  /** Quantos passos o rascunho já tem (a NICO reescreve o rascunho). */
  passosNoCanvas: number;
  /** A NICO gravou um rascunho novo: o editor recarrega o canvas. */
  onMontado: (r: { nome: string; resumo: string }) => void;
}) {
  const [conversa, setConversa] = useState<MensagemNico[]>([]);
  const [texto, setTexto] = useState('');
  const [pensando, setPensando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [passos, setPassos] = useState<PassoNico[] | null>(null);
  const [resumo, setResumo] = useState('');
  const fim = useRef<HTMLDivElement>(null);

  useEffect(() => fim.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), [conversa, pensando]);

  const enviar = async (msg: string) => {
    const t = msg.trim();
    if (!t || pensando) return;
    const nova: MensagemNico[] = [...conversa, { autor: 'usuario', texto: t }];
    setConversa(nova);
    setTexto('');
    setErro(null);
    setPensando(true);
    try {
      const r = await automations.nicoMontar(nova, workflowId);
      if (r.tipo === 'pergunta') {
        const fala = [r.resumo, ...r.perguntas.map((p) => `• ${p}`)].filter(Boolean).join('\n');
        setConversa((c) => [...c, { autor: 'nico', texto: fala }]);
      } else {
        setPassos(r.passos);
        setResumo(r.resumo);
        setConversa((c) => [...c, { autor: 'nico', texto: `Montei "${r.nome}". ${r.resumo}\nConfira os passos ao lado e rode o teste: a mensagem chega no número de teste com os dados reais de um contato.` }]);
        onMontado({ nome: r.nome, resumo: r.resumo });
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : '';
      setErro(/config|501/i.test(m) ? 'A IA da NICO não está configurada neste ambiente.' : m || 'A NICO não conseguiu montar agora. Tente descrever de outro jeito.');
    } finally {
      setPensando(false);
    }
  };

  return (
    <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Conversa */}
      <section className="flex min-h-0 flex-col overflow-hidden rounded-3xl border border-line bg-surface" aria-label="Conversa com a NICO">
        <header className="flex items-center gap-3 border-b border-line px-4 py-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/nico-avatar.png" alt="" className="nico-orbe h-9 w-9 object-contain" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-fg">NICO</p>
            <p className="text-2xs text-muted">Diga o que fazer e quando. Eu monto, testo e te mostro.</p>
          </div>
        </header>

        <div className="scrollbar-thin min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {conversa.length === 0 && (
            <div className="space-y-3">
              <p className="text-sm text-muted">
                Escreva como você explicaria para alguém da equipe. {passosNoCanvas > 0 && 'Este fluxo já tem passos: eu reescrevo o rascunho, e a versão publicada só muda quando você publicar.'}
              </p>
              <div className="space-y-2">
                {SUGESTOES.map((s) => (
                  <button key={s} type="button" onClick={() => void enviar(s)} className="block w-full rounded-2xl border border-line px-3.5 py-2.5 text-left text-xs text-fg transition hover:border-brand-border hover:bg-brand-softer">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {conversa.map((m, i) => (
            <div key={i} className={cx('flex', m.autor === 'usuario' ? 'justify-end' : 'justify-start')}>
              <p className={cx('max-w-[85%] whitespace-pre-line rounded-2xl px-3.5 py-2 text-sm', m.autor === 'usuario' ? 'bg-brand text-white' : 'bg-surface2 text-fg')}>
                {m.texto}
              </p>
            </div>
          ))}
          {pensando && <p className="text-xs text-muted" role="status">NICO está montando o fluxo…</p>}
          {erro && <p className="rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger" role="alert">{erro}</p>}
          <div ref={fim} />
        </div>

        <form
          className="flex items-end gap-2 border-t border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void enviar(texto);
          }}
        >
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void enviar(texto);
              }
            }}
            rows={2}
            maxLength={3000}
            placeholder="Ex.: quando alguém mandar mensagem com a palavra preço, responder com a tabela e avisar o comercial"
            aria-label="Mensagem para a NICO"
            className="input min-h-[44px] flex-1 resize-none"
          />
          <button type="submit" className="btn btn-primary btn-icon" disabled={!texto.trim() || pensando} aria-label="Enviar">
            <Icon name="send" size={16} />
          </button>
        </form>
      </section>

      {/* Fluxo + teste */}
      <section className="flex min-h-0 flex-col gap-3 overflow-y-auto scrollbar-thin" aria-label="Fluxo montado">
        <div className="rounded-3xl border border-line bg-surface p-4">
          <p className="text-sm font-semibold text-fg">O fluxo</p>
          {resumo && <p className="mt-0.5 text-xs text-muted">{resumo}</p>}
          {!passos && <p className="mt-3 text-xs text-faint">Os passos aparecem aqui assim que a NICO montar.</p>}
          {passos && (
            <ol className="mt-3 space-y-1.5">
              {passos.map((p, i) => (
                <li key={i} style={{ marginLeft: p.nivel * 20 }}>
                  {p.ramo && <p className="mb-1 mt-2 text-2xs font-semibold uppercase tracking-wider text-faint">Se: {p.ramo}</p>}
                  <div className="flex items-start gap-3 rounded-2xl border border-line px-3 py-2.5">
                    <SeloNo tipo={p.tipo} icone={ICONE[p.tipo] ?? 'sparkles'} acento={ACENTO[p.categoria] ?? 'var(--brand)'} tamanho={32} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-fg">{p.nome}</p>
                      {p.detalhe && <p className="line-clamp-2 text-xs text-muted">{p.detalhe}</p>}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>

        {passos && <TesteReal workflowId={workflowId} />}
      </section>
    </div>
  );
}

/** Roda o teste com o contato mais recente e mostra cada passo, como aconteceu. */
function TesteReal({ workflowId }: { workflowId: string }) {
  const [run, setRun] = useState<RunDetalhe | null>(null);
  const [contato, setContato] = useState<string | null>(null);
  const [rodando, setRodando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const parar = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => parar, [parar]);

  const testar = async () => {
    setErro(null);
    setRodando(true);
    setRun(null);
    try {
      const r = await automations.nicoTestar(workflowId);
      if (!r.runId) throw new Error('O fluxo não tem passo depois do gatilho.');
      setContato(r.contato.nome);
      parar();
      const tick = () =>
        automations.run(r.runId!).then((d) => {
          setRun(d);
          if (FINAIS.includes(d.status)) {
            parar();
            setRodando(false);
          }
        }).catch(() => {
          parar();
          setRodando(false);
        });
      void tick();
      timer.current = setInterval(tick, 1500);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui rodar o teste.');
      setRodando(false);
    }
  };

  return (
    <div className="rounded-3xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-fg">Teste real</p>
          <p className="text-xs text-muted">Dados reais de um contato. Mensagens só no número de teste; nada muda na operação.</p>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void testar()} disabled={rodando}>
          <Icon name="play" size={14} /> {rodando ? 'Testando…' : run ? 'Testar de novo' : 'Testar agora'}
        </button>
      </div>
      {erro && <p className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger" role="alert">{erro}</p>}

      {run && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted">
            Com os dados de <b className="text-fg">{contato}</b> ·{' '}
            {run.status === 'concluido' ? 'concluído' : run.status === 'falhou' ? 'falhou' : 'rodando'}
          </p>
          {run.erro && <p className="rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger">{run.erro}</p>}
          <ol className="space-y-2">
            {run.passos.map((s) => {
              const saida = s.saida ?? {};
              const mensagem = saida.teste === true && typeof saida.texto === 'string';
              return (
                <li key={s.id} className="flex items-start gap-3">
                  <span className={cx('mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full', s.status === 'ok' ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger')}>
                    <Icon name={s.status === 'ok' ? 'check' : 'close'} size={11} />
                  </span>
                  <div className="min-w-0 flex-1">
                    {mensagem ? (
                      <>
                        <p className="max-w-[90%] whitespace-pre-line rounded-2xl rounded-tl-md bg-success-soft px-3 py-2 text-sm text-fg">{String(saida.texto)}</p>
                        <p className="mt-0.5 text-2xs text-faint">
                          WhatsApp · {saida.status === 'sent' ? `entregue em ${String(saida.para ?? 'número de teste')}` : saida.status === 'config_required' ? 'número de teste não configurado (não enviada)' : String(saida.status)}
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-muted">{typeof saida.descricao === 'string' ? saida.descricao : s.tipo}</p>
                    )}
                    {s.erro && <p className="text-xs text-danger">{s.erro}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
