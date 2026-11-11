'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Button, Select, Tabs, useToast } from '@/components/kit';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { EmptyState, ErrorState } from '@/components/revenue/States';
import { agenda, type Compromisso, type StatusAgenda } from '@/lib/agenda';
import { ApiError } from '@/lib/api-error';
import { useAuth } from '@/lib/auth';
import { crm } from '@/lib/crm';
import { hora } from '@/lib/format';
import { settingsApi, type Member } from '@/lib/settings';
import {
  STATUS_ATIVOS,
  STATUS_LABEL,
  STATUS_ORDEM,
  STATUS_PILL,
  TIPO_LABEL,
  TIPO_ORDEM,
  TIPO_TOM,
  chaveDia,
  classesEvento,
  inicioDaSemana,
  mensagemErro,
  rotuloDia,
  rotuloMes,
  rotuloSemana,
  somarDias,
} from './agenda-utils';
import {
  ALTURA_HORA,
  DIAS_LISTA,
  dataNoDia,
  diasDaVisao,
  encaixar,
  eventosDoDia,
  janelaDaVisao,
  mesmoDia,
  minutosDoPixel,
  moverEvento,
  navegar,
  posicionarDia,
  redimensionarEvento,
  type Visao,
} from './calendario-layout';
import { CompromissoModal } from './CompromissoModal';
import { DetalheCompromisso } from './DetalheCompromisso';

const VISOES: { value: Visao; label: string }[] = [
  { value: 'dia', label: 'Dia' },
  { value: 'semana', label: 'Semana' },
  { value: 'mes', label: 'Mês' },
  { value: 'lista', label: 'Lista' },
];
const VISOES_MOBILE: Visao[] = ['dia', 'lista'];
const DIAS_CURTOS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
/** Status visíveis ao abrir: tudo menos cancelado (como no Google Agenda). */
const STATUS_PADRAO: StatusAgenda[] = ['agendado', 'confirmado', 'concluido', 'faltou'];

function useCelular(): boolean {
  const [cel, setCel] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const f = () => setCel(mq.matches);
    f();
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, []);
  return cel;
}

/** Relógio que bate a cada minuto (linha do "agora"). */
function useAgora(): Date {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return agora;
}

/**
 * Agenda real (modo não demo): Dia / Semana / Mês / Lista sobre `/v1/agenda`.
 * Clicar num horário vazio cria; arrastar move; puxar a borda de baixo muda a
 * duração; choque de horário (409) desfaz com aviso. No celular: Dia e Lista.
 */
export function AgendaCalendario() {
  const toast = useToast();
  const { user } = useAuth();
  const celular = useCelular();
  const agora = useAgora();

  const [visao, setVisao] = useState<Visao>('semana');
  const [ref, setRef] = useState(() => new Date());
  const [itens, setItens] = useState<Compromisso[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [membros, setMembros] = useState<Member[]>([]);
  const [responsavel, setResponsavel] = useState('');
  const [statusVisiveis, setStatusVisiveis] = useState<StatusAgenda[]>(STATUS_PADRAO);
  const [nomes, setNomes] = useState<Record<string, string | null>>({});
  const [aberto, setAberto] = useState<{ id: string; ancora: DOMRect | null } | null>(null);
  const [modal, setModal] = useState<{ compromisso?: Compromisso; inicio?: Date } | null>(null);
  const pedido = useRef(0);
  const contatosPedidos = useRef(new Set<string>());

  // No celular só Dia e Lista cabem com qualidade.
  useEffect(() => {
    if (celular && !VISOES_MOBILE.includes(visao)) setVisao('dia');
  }, [celular, visao]);

  useEffect(() => {
    settingsApi
      .members()
      .then((r) => setMembros(r.members))
      .catch(() => setMembros([]));
  }, []);
  const euId = useMemo(
    () => membros.find((m) => user?.email && m.email.toLowerCase() === user.email.toLowerCase())?.identityId ?? null,
    [membros, user?.email],
  );
  const nomeMembro = useCallback(
    (id: string | null) => {
      if (!id) return null;
      const m = membros.find((x) => x.identityId === id);
      return m ? m.nome || m.email : 'Membro removido';
    },
    [membros],
  );

  const janela = useMemo(() => janelaDaVisao(visao, ref), [visao, ref]);

  const carregar = useCallback(
    async (silencioso = false) => {
      const id = ++pedido.current;
      if (!silencioso) {
        setItens(null);
        setErro(null);
      }
      try {
        const lista = await agenda.compromissos({
          de: janela.de.toISOString(),
          ate: janela.ate.toISOString(),
          ...(responsavel ? { responsavelId: responsavel } : {}),
        });
        if (id !== pedido.current) return;
        setItens(lista);
        setErro(null);
      } catch (e) {
        if (id !== pedido.current) return;
        setErro(mensagemErro(e, 'carregar a agenda'));
        setItens(null);
      }
    },
    [janela, responsavel],
  );

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Nome do contato: o payload traz só o id; busca uma vez por contato.
  useEffect(() => {
    if (!itens) return;
    const faltando = [...new Set(itens.map((c) => c.contactId).filter((x): x is string => !!x))].filter((cid) => !contatosPedidos.current.has(cid));
    if (!faltando.length) return;
    faltando.forEach((cid) => contatosPedidos.current.add(cid));
    void Promise.allSettled(faltando.map((cid) => crm.contact(cid))).then((res) =>
      setNomes((prev) => {
        const prox = { ...prev };
        res.forEach((r, i) => {
          prox[faltando[i]] = r.status === 'fulfilled' ? r.value.nome : null;
        });
        return prox;
      }),
    );
  }, [itens]);

  const visiveis = useMemo(() => (itens ?? []).filter((c) => statusVisiveis.includes(c.status)), [itens, statusVisiveis]);
  const selecionado = aberto ? (itens ?? []).find((c) => c.id === aberto.id) ?? null : null;

  const trocar = (c: Compromisso) => setItens((prev) => prev?.map((x) => (x.id === c.id ? c : x)) ?? prev);

  // ---------------------------------------------------------------- ações
  const mover = async (c: Compromisso, inicio: string, fim: string) => {
    if (inicio === c.inicio && fim === c.fim) return;
    trocar({ ...c, inicio, fim }); // otimista
    try {
      const novo = await agenda.atualizar(c.id, { inicio, fim });
      trocar(novo);
      toast.success(inicio === c.inicio ? 'Duração alterada' : 'Compromisso movido', {
        description: `${rotuloDia(new Date(novo.inicio))}, das ${hora(novo.inicio)} às ${hora(novo.fim)}`,
      });
    } catch (e) {
      trocar(c); // rollback
      const ocupado = e instanceof ApiError && e.status === 409;
      toast.error(ocupado ? 'Horário ocupado' : 'Não foi possível mover', {
        description: ocupado ? 'Já existe um compromisso nesse horário. Voltamos para o horário anterior.' : mensagemErro(e, 'mover o compromisso'),
      });
      if (e instanceof ApiError && e.status === 404) void carregar(true);
    }
  };

  const mudarStatus = async (c: Compromisso, s: StatusAgenda) => {
    try {
      const novo = await agenda.status(c.id, s);
      trocar(novo);
      const titulo: Record<StatusAgenda, string> = {
        agendado: 'Compromisso reativado',
        confirmado: 'Compromisso confirmado',
        concluido: 'Compromisso concluído',
        cancelado: 'Compromisso cancelado',
        faltou: 'Falta registrada',
      };
      toast.success(titulo[s], s === 'faltou' ? { description: 'As automações de recuperação de falta foram acionadas.' } : undefined);
      if (!statusVisiveis.includes(s)) setAberto(null);
    } catch (e) {
      toast.error('Não foi possível alterar o status', { description: mensagemErro(e, 'alterar o status') });
      if (e instanceof ApiError && e.status === 404) {
        setAberto(null);
        void carregar(true);
      }
    }
  };

  const excluir = async (c: Compromisso) => {
    try {
      await agenda.remover(c.id);
      setItens((prev) => prev?.filter((x) => x.id !== c.id) ?? prev);
      setAberto(null);
      toast.success('Compromisso excluído');
    } catch (e) {
      toast.error('Não foi possível excluir', { description: mensagemErro(e, 'excluir o compromisso') });
    }
  };

  const sincronizar = async (c: Compromisso): Promise<'ok' | 'conectar' | 'erro'> => {
    try {
      const r = await agenda.sincronizar(c.id);
      trocar({ ...c, googleEventId: r.googleEventId });
      toast.success('Enviado ao Google Calendar');
      return 'ok';
    } catch (e) {
      if (e instanceof ApiError && e.configRequired) return 'conectar';
      toast.error('Não foi possível sincronizar', { description: mensagemErro(e, 'sincronizar') });
      return 'erro';
    }
  };

  const criarEm = (inicio: Date) => {
    setAberto(null);
    setModal({ inicio });
  };

  const aoSalvar = (c: Compromisso, modo: 'criado' | 'editado') => {
    setModal(null);
    toast.success(modo === 'criado' ? 'Compromisso criado' : 'Compromisso atualizado', {
      description: `${rotuloDia(new Date(c.inicio))}, às ${hora(c.inicio)}`,
    });
    const ini = new Date(c.inicio);
    if (ini < janela.de || ini > janela.ate) setRef(ini);
    else void carregar(true);
  };

  // ---------------------------------------------------------------- título
  const titulo = useMemo(() => {
    if (visao === 'dia') return rotuloDia(ref);
    if (visao === 'semana') return rotuloSemana(inicioDaSemana(ref));
    if (visao === 'mes') return rotuloMes(ref).replace(/^./, (l) => l.toUpperCase());
    const fim = somarDias(ref, DIAS_LISTA - 1);
    return `${ref.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })} a ${fim.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }, [visao, ref]);

  const hojeNaJanela = agora >= janela.de && agora <= janela.ate;
  const dias = useMemo(() => diasDaVisao(visao, ref), [visao, ref]);
  const total = visiveis.length;
  const abrir = (id: string, ancora: DOMRect | null) => setAberto({ id, ancora });

  return (
    <div className="space-y-3">
      {/* Barra de navegação */}
      <div className="card flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setRef(new Date())} disabled={hojeNaJanela && visao !== 'lista'}>
            Hoje
          </Button>
          <div className="flex items-center">
            <Button size="sm" variant="ghost" icon="arrowLeft" iconOnly aria-label="Período anterior" onClick={() => setRef((r) => navegar(visao, r, -1))} />
            <Button size="sm" variant="ghost" icon="arrowRight" iconOnly aria-label="Próximo período" onClick={() => setRef((r) => navegar(visao, r, 1))} />
          </div>
          <h2 className="min-w-0 truncate text-base font-semibold text-fg" aria-live="polite">
            {titulo}
          </h2>
          <label className="inline-flex">
            <span className="sr-only">Ir para a data</span>
            <input
              type="date"
              className="input h-8 w-[150px] text-sm"
              value={chaveDia(ref)}
              onChange={(e) => {
                const [a, m, d] = e.target.value.split('-').map(Number);
                if (a && m && d) setRef(new Date(a, m - 1, d));
              }}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs
            idBase="agenda-visao"
            label="Visualização da agenda"
            variant="segmented"
            value={visao}
            onChange={(v) => {
              setVisao(v);
              setAberto(null);
            }}
            items={VISOES.filter((v) => !celular || VISOES_MOBILE.includes(v.value))}
          />
          <Button size="sm" variant="primary" icon="plus" onClick={() => setModal({})}>
            Novo
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex items-center gap-2">
          <label htmlFor="agenda-responsavel" className="text-sm text-muted">
            Responsável
          </label>
          <Select
            id="agenda-responsavel"
            size="sm"
            className="w-auto min-w-[180px]"
            value={responsavel}
            onChange={setResponsavel}
            options={[
              { value: '', label: 'Toda a equipe' },
              ...membros.map((m) => ({ value: m.identityId, label: m.identityId === euId ? `${m.nome || m.email} (você)` : m.nome || m.email })),
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar por status">
          {STATUS_ORDEM.map((s) => {
            const on = statusVisiveis.includes(s);
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                onClick={() => setStatusVisiveis((prev) => (on ? prev.filter((x) => x !== s) : [...prev, s]))}
                className={cx('btn btn-sm h-7 px-2.5 text-xs', on ? 'btn-soft' : 'btn-ghost text-faint line-through')}
              >
                {STATUS_LABEL[s]}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted sm:ml-auto" aria-live="polite">
          {itens === null ? (erro ? 'Agenda indisponível' : 'Carregando…') : total === 1 ? '1 compromisso' : `${total} compromissos`}
        </p>
      </div>

      {erro ? (
        <div className="card">
          <ErrorState title="Não foi possível carregar a agenda" description={erro} onRetry={() => void carregar()} />
        </div>
      ) : itens === null ? (
        <div className="card space-y-2 p-4" aria-busy="true">
          <span className="sr-only">Carregando compromissos…</span>
          <div className="skeleton h-8 w-full rounded-md" />
          <div className="skeleton h-[420px] w-full rounded-md" />
        </div>
      ) : visao === 'mes' ? (
        <GradeMes
          dias={dias}
          mesRef={ref}
          eventos={visiveis}
          agora={agora}
          onAbrir={abrir}
          onDia={(d) => {
            setRef(d);
            setVisao('dia');
          }}
          onCriar={(d) => criarEm(dataNoDia(d, 9 * 60))}
        />
      ) : visao === 'lista' ? (
        <Lista dias={dias} eventos={visiveis} nomes={nomes} nomeMembro={nomeMembro} onAbrir={abrir} onNovo={() => setModal({})} />
      ) : (
        <GradeHorarios dias={dias} eventos={visiveis} agora={agora} nomes={nomes} permitirArraste={!celular} onAbrir={abrir} onCriar={criarEm} onMover={mover} />
      )}

      {/* Legenda de tipos */}
      {itens !== null && !erro && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legenda de tipos">
          {TIPO_ORDEM.map((t) => (
            <li key={t} className="flex items-center gap-1.5">
              <span className={cx('h-2 w-2 rounded-full', TIPO_TOM[t].ponto)} aria-hidden />
              {TIPO_LABEL[t]}
            </li>
          ))}
        </ul>
      )}

      {selecionado && aberto && (
        <DetalheCompromisso
          c={selecionado}
          ancora={aberto.ancora}
          nomeContato={selecionado.contactId ? nomes[selecionado.contactId] : undefined}
          nomeResponsavel={nomeMembro(selecionado.responsavelId)}
          onFechar={() => setAberto(null)}
          acoes={{
            onStatus: mudarStatus,
            onReagendar: (c) => {
              setAberto(null);
              setModal({ compromisso: c });
            },
            onExcluir: excluir,
            onSincronizar: sincronizar,
          }}
        />
      )}

      <CompromissoModal
        open={!!modal}
        onClose={() => setModal(null)}
        onSaved={aoSalvar}
        compromisso={modal?.compromisso ?? null}
        inicioSugerido={modal?.inicio}
        membros={membros}
        euId={euId}
        nomeContato={modal?.compromisso?.contactId ? nomes[modal.compromisso.contactId] : null}
      />
    </div>
  );
}

/* ================================================================ Dia/Semana */

interface Arraste {
  id: string;
  modo: 'mover' | 'redim';
  x0: number;
  y0: number;
  original: Compromisso;
  moveu: boolean;
}

function GradeHorarios({
  dias,
  eventos,
  agora,
  nomes,
  permitirArraste,
  onAbrir,
  onCriar,
  onMover,
}: {
  dias: Date[];
  eventos: Compromisso[];
  agora: Date;
  nomes: Record<string, string | null>;
  permitirArraste: boolean;
  onAbrir: (id: string, ancora: DOMRect | null) => void;
  onCriar: (inicio: Date) => void;
  onMover: (c: Compromisso, inicio: string, fim: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const corpo = useRef<HTMLDivElement>(null);
  const arraste = useRef<Arraste | null>(null);
  const previaRef = useRef<{ id: string; inicio: string; fim: string } | null>(null);
  const [previa, setPreviaState] = useState<{ id: string; inicio: string; fim: string } | null>(null);
  const setPrevia = (p: { id: string; inicio: string; fim: string } | null) => {
    previaRef.current = p;
    setPreviaState(p);
  };
  const semana = dias.length > 1;

  // Abre rolado perto do horário útil (ou de agora, se hoje está visível).
  const chaveVisao = `${chaveDia(dias[0])}:${dias.length}`;
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const hojeVisivel = dias.some((d) => mesmoDia(d, new Date()));
    const h = hojeVisivel ? Math.max(0, new Date().getHours() - 1) : 7;
    el.scrollTop = h * ALTURA_HORA;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveVisao]);

  const comPrevia = previa ? eventos.map((e) => (e.id === previa.id ? { ...e, inicio: previa.inicio, fim: previa.fim } : e)) : eventos;

  const iniciar = (e: ReactPointerEvent<HTMLElement>, c: Compromisso, modo: Arraste['modo']) => {
    if (e.button !== 0) return;
    // Toque não arrasta (conflita com a rolagem): toque abre o detalhe pelo clique.
    if (!permitirArraste || e.pointerType === 'touch' || !STATUS_ATIVOS.includes(c.status)) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    arraste.current = { id: c.id, modo, x0: e.clientX, y0: e.clientY, original: c, moveu: false };
  };

  const mexer = (e: ReactPointerEvent<HTMLElement>) => {
    const a = arraste.current;
    if (!a) return;
    const dx = e.clientX - a.x0;
    const dy = e.clientY - a.y0;
    if (!a.moveu && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    a.moveu = true;
    const deltaMin = encaixar((dy / ALTURA_HORA) * 60);
    if (a.modo === 'redim') {
      setPrevia({ id: a.id, ...redimensionarEvento(a.original, deltaMin) });
      return;
    }
    // Largura de uma coluna de dia = (largura do corpo − coluna de horas) / dias.
    const larguraCorpo = corpo.current?.getBoundingClientRect().width ?? 0;
    const largura = (larguraCorpo - 56) / dias.length;
    const deltaDias = semana && largura > 0 ? Math.round(dx / largura) : 0;
    setPrevia({ id: a.id, ...moverEvento(a.original, deltaMin, deltaDias) });
  };

  const soltar = (e: ReactPointerEvent<HTMLElement>, c: Compromisso) => {
    const a = arraste.current;
    arraste.current = null;
    if (!a) return;
    e.stopPropagation();
    const p = previaRef.current;
    setPrevia(null);
    if (a.moveu && p) onMover(a.original, p.inicio, p.fim);
    else if (!a.moveu) onAbrir(c.id, e.currentTarget.closest('[data-evento]')?.getBoundingClientRect() ?? null);
  };

  const cancelar = () => {
    arraste.current = null;
    setPrevia(null);
  };

  const horas = Array.from({ length: 24 }, (_, h) => h);
  const minAgora = agora.getHours() * 60 + agora.getMinutes();
  const colsGrid = { gridTemplateColumns: `56px repeat(${dias.length}, minmax(0, 1fr))` };

  return (
    <section className="card overflow-hidden" aria-label="Grade de horários">
      <div className={cx('min-w-0', semana && 'overflow-x-auto')}>
        <div className={cx(semana && 'min-w-[720px]')}>
          {/* Cabeçalho dos dias */}
          <div className="grid border-b border-line" style={colsGrid}>
            <div aria-hidden />
            {dias.map((d) => {
              const hoje = mesmoDia(d, agora);
              return (
                <div key={chaveDia(d)} className="border-l border-line py-2 text-center">
                  <p className="text-xs text-muted">{DIAS_CURTOS[(d.getDay() + 6) % 7]}</p>
                  <p
                    className={cx('mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-base font-semibold tabular', hoje ? 'bg-brand text-white' : 'text-fg')}
                    aria-current={hoje ? 'date' : undefined}
                  >
                    {d.getDate()}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Corpo rolável */}
          <div ref={scroller} className="max-h-[min(70vh,720px)] overflow-y-auto scrollbar-thin">
            <div ref={corpo} className="grid" style={colsGrid}>
              <div aria-hidden>
                {horas.map((h) => (
                  <div key={h} className="relative pr-2 text-right" style={{ height: ALTURA_HORA }}>
                    {h > 0 && <span className="relative -top-2 text-2xs tabular text-faint">{String(h).padStart(2, '0')}:00</span>}
                  </div>
                ))}
              </div>
              {dias.map((dia) => {
                const blocos = posicionarDia(comPrevia, dia);
                const hoje = mesmoDia(dia, agora);
                return (
                  <div
                    key={chaveDia(dia)}
                    className="relative cursor-cell border-l border-line"
                    style={{ height: ALTURA_HORA * 24 }}
                    onClick={(e) => {
                      if (e.target !== e.currentTarget) return;
                      const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
                      onCriar(dataNoDia(dia, minutosDoPixel(y)));
                    }}
                    title="Clique num horário vazio para criar"
                  >
                    {horas.map((h) => (
                      <div key={h} className="pointer-events-none absolute inset-x-0 border-b border-line" style={{ top: (h + 1) * ALTURA_HORA - 1 }} aria-hidden />
                    ))}
                    {hoje && (
                      <div className="pointer-events-none absolute inset-x-0 z-[2] flex items-center" style={{ top: (minAgora / 60) * ALTURA_HORA - 1 }} aria-hidden>
                        <span className="-ml-1 h-2.5 w-2.5 rounded-full bg-danger" />
                        <span className="h-0.5 flex-1 bg-danger" />
                      </div>
                    )}
                    {blocos.map((b) => {
                      const c = b.evento;
                      const alturaPx = (b.alturaMin / 60) * ALTURA_HORA;
                      const tom = TIPO_TOM[c.tipo] ?? TIPO_TOM.outro;
                      const arrastavel = permitirArraste && STATUS_ATIVOS.includes(c.status);
                      const emPrevia = previa?.id === c.id;
                      return (
                        <div
                          key={c.id}
                          data-evento
                          className={cx(
                            'group absolute z-[1] select-none overflow-hidden rounded-md border border-l-[3px] border-line px-1.5 py-0.5 text-left shadow-sm',
                            classesEvento(c),
                            arrastavel ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                            emPrevia && 'z-[3] shadow-lg ring-2 ring-brand',
                          )}
                          style={{
                            top: (b.topoMin / 60) * ALTURA_HORA + 1,
                            height: Math.max(alturaPx - 2, 18),
                            left: `calc(${(b.coluna / b.colunas) * 100}% + 2px)`,
                            width: `calc(${100 / b.colunas}% - 4px)`,
                          }}
                          role="button"
                          tabIndex={0}
                          aria-label={`${c.titulo}, ${hora(c.inicio)} às ${hora(c.fim)}, ${STATUS_LABEL[c.status]}`}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onAbrir(c.id, e.currentTarget.getBoundingClientRect());
                            }
                          }}
                          onPointerDown={(e) => iniciar(e, c, 'mover')}
                          onPointerMove={mexer}
                          onPointerUp={(e) => soltar(e, c)}
                          onPointerCancel={cancelar}
                          onClick={(e) => {
                            // Sem arraste (toque, compromisso inativo): o clique abre o detalhe.
                            if (!arrastavel || (e.nativeEvent as PointerEvent).pointerType === 'touch') onAbrir(c.id, e.currentTarget.getBoundingClientRect());
                          }}
                        >
                          <span className="flex items-center gap-1">
                            <Icon name={tom.icone} size={11} className="shrink-0 opacity-70" />
                            <span className="truncate text-xs font-semibold leading-tight">{c.titulo}</span>
                          </span>
                          {alturaPx >= 36 && (
                            <span className="block truncate text-2xs tabular leading-tight opacity-80">
                              {hora(c.inicio)} às {hora(c.fim)}
                              {c.contactId && nomes[c.contactId] ? ` · ${nomes[c.contactId]}` : ''}
                            </span>
                          )}
                          {arrastavel && (
                            <span
                              className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize opacity-0 group-hover:opacity-100"
                              onPointerDown={(e) => iniciar(e, c, 'redim')}
                              onPointerMove={mexer}
                              onPointerUp={(e) => soltar(e, c)}
                              onPointerCancel={cancelar}
                              aria-hidden
                            >
                              <span className="mx-auto mt-0.5 block h-1 w-6 rounded-full bg-line-strong" />
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      {eventos.length === 0 && <p className="border-t border-line px-4 py-2.5 text-xs text-muted">Nada agendado neste período. Clique num horário vazio para criar.</p>}
    </section>
  );
}

/* ================================================================ Mês */

function GradeMes({
  dias,
  mesRef,
  eventos,
  agora,
  onAbrir,
  onDia,
  onCriar,
}: {
  dias: Date[];
  mesRef: Date;
  eventos: Compromisso[];
  agora: Date;
  onAbrir: (id: string, ancora: DOMRect | null) => void;
  onDia: (d: Date) => void;
  onCriar: (d: Date) => void;
}) {
  const MAX = 3;
  return (
    <section className="card overflow-hidden" aria-label="Mês">
      <div className="grid grid-cols-7 border-b border-line">
        {DIAS_CURTOS.map((d) => (
          <p key={d} className="py-2 text-center text-xs font-medium text-muted">
            {d}
          </p>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {dias.map((d, i) => {
          const doDia = eventosDoDia(eventos, d);
          const foraDoMes = d.getMonth() !== mesRef.getMonth();
          const hoje = mesmoDia(d, agora);
          return (
            <div
              key={chaveDia(d)}
              className={cx('min-h-[104px] cursor-cell border-line p-1.5', i % 7 !== 0 && 'border-l', i >= 7 && 'border-t', foraDoMes && 'bg-surface2')}
              onClick={(e) => {
                if (e.target === e.currentTarget) onCriar(d);
              }}
            >
              <button
                type="button"
                onClick={() => onDia(d)}
                className={cx(
                  'mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold tabular',
                  hoje ? 'bg-brand text-white' : foraDoMes ? 'text-faint hover:bg-surface3' : 'text-fg hover:bg-surface3',
                )}
                aria-label={`Abrir ${rotuloDia(d)}`}
                aria-current={hoje ? 'date' : undefined}
              >
                {d.getDate()}
              </button>
              <ul className="space-y-0.5">
                {doDia.slice(0, MAX).map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={(e) => onAbrir(c.id, e.currentTarget.getBoundingClientRect())}
                      className={cx(
                        'flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-2xs hover:bg-surface3',
                        (c.status === 'cancelado' || c.status === 'faltou') && 'line-through opacity-70',
                      )}
                    >
                      <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', (TIPO_TOM[c.tipo] ?? TIPO_TOM.outro).ponto)} aria-hidden />
                      <span className="tabular text-muted">{hora(c.inicio)}</span>
                      <span className="truncate text-fg">{c.titulo}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {doDia.length > MAX && (
                <button type="button" onClick={() => onDia(d)} className="mt-0.5 px-1 text-2xs font-medium text-brand hover:underline">
                  +{doDia.length - MAX} mais
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ================================================================ Lista */

function Lista({
  dias,
  eventos,
  nomes,
  nomeMembro,
  onAbrir,
  onNovo,
}: {
  dias: Date[];
  eventos: Compromisso[];
  nomes: Record<string, string | null>;
  nomeMembro: (id: string | null) => string | null;
  onAbrir: (id: string, ancora: DOMRect | null) => void;
  onNovo: () => void;
}) {
  const comEventos = dias.map((d) => ({ d, lista: eventosDoDia(eventos, d) })).filter((x) => x.lista.length > 0);
  if (!comEventos.length) {
    return (
      <div className="card">
        <EmptyState
          icon="calendar"
          title="Nenhum compromisso neste período"
          description="Reuniões, ligações e visitas marcadas pela equipe ou pelos agentes de IA aparecem aqui."
          action={
            <Button size="sm" variant="primary" icon="plus" onClick={onNovo}>
              Novo compromisso
            </Button>
          }
        />
      </div>
    );
  }
  return (
    <div className="card divide-y divide-line">
      {comEventos.map(({ d, lista }) => (
        <section key={chaveDia(d)} className="px-4 py-3 sm:px-5" aria-label={rotuloDia(d)}>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
            {rotuloDia(d)}
            {mesmoDia(d, new Date()) && <span className="pill pill-brand">Hoje</span>}
          </h3>
          <ul className="space-y-1.5">
            {lista.map((c) => {
              const tom = TIPO_TOM[c.tipo] ?? TIPO_TOM.outro;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={(e) => onAbrir(c.id, e.currentTarget.getBoundingClientRect())}
                    className={cx('flex w-full items-start gap-3 rounded-md border border-l-[3px] border-line px-3 py-2 text-left hover:bg-surface2', tom.barra)}
                  >
                    <span className="w-[92px] shrink-0 text-sm tabular text-muted">
                      {hora(c.inicio)} às {hora(c.fim)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cx('block truncate text-sm font-medium', c.status === 'cancelado' ? 'text-muted line-through' : 'text-fg')}>{c.titulo}</span>
                      <span className="block truncate text-xs text-muted">
                        {[TIPO_LABEL[c.tipo], c.contactId ? nomes[c.contactId] : null, nomeMembro(c.responsavelId)].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className={cx(STATUS_PILL[c.status], 'shrink-0')}>{STATUS_LABEL[c.status]}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
