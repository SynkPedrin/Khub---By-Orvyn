'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { Button, Skeleton, useToast } from '@/components/kit';
import { APROVACAO, codigo, daily, horaLocal, inicioDoDia, prazoDoDia, ymd, type ItemCalendario } from '@/lib/agency-daily';
import { useDaily } from './DailyContext';
import { EventoModal } from './EventoModal';
import { FiltroSelect } from './pecas';

type Visao = 'mes' | 'semana';
type Origem = ItemCalendario['origem'];
type Evento = Extract<ItemCalendario, { origem: 'evento' }>;

const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const ORIGEM: Record<Origem, { rotulo: string; chip: string; ponto: string }> = {
  evento: { rotulo: 'Eventos', chip: 'bg-info-soft text-info', ponto: 'bg-info' },
  prazo: { rotulo: 'Prazos de entrega', chip: 'bg-warning-soft text-warning', ponto: 'bg-warning' },
  publicacao: { rotulo: 'Publicações', chip: 'bg-[color-mix(in_srgb,var(--ch-instagram)_14%,transparent)] text-channel-instagram', ponto: 'bg-channel-instagram' },
};

/** Dias visíveis: mês = 6 semanas a partir do domingo; semana = 7 dias. */
function diasVisiveis(ancora: Date, visao: Visao): Date[] {
  const inicio = visao === 'mes' ? new Date(ancora.getFullYear(), ancora.getMonth(), 1) : new Date(ancora);
  inicio.setDate(inicio.getDate() - inicio.getDay());
  return Array.from({ length: visao === 'mes' ? 42 : 7 }, (_, i) => new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i));
}

const diaDoItem = (it: ItemCalendario) => ymd(new Date(it.inicio));
const ordem = (it: ItemCalendario) => (it.origem === 'evento' && it.diaInteiro ? 0 : it.origem === 'prazo' ? 1 : 2);

/**
 * Calendário da agência: eventos da equipe, prazos de entrega e datas de
 * publicação do Studio. Arrastar um item para outro dia reagenda (evento
 * mantém o horário e a duração; prazo e publicação mudam só o dia).
 */
export function CalendarioView() {
  const { base, versao, recarregar, abrirTarefa } = useDaily();
  const toast = useToast();
  const [visao, setVisao] = useState<Visao>('mes');
  const [ancora, setAncora] = useState(() => inicioDoDia());
  const [itens, setItens] = useState<ItemCalendario[] | null>(null);
  const [erro, setErro] = useState(false);
  const [cliente, setCliente] = useState('');
  const [meus, setMeus] = useState(false);
  const [ocultos, setOcultos] = useState<Origem[]>([]);
  const [modal, setModal] = useState<{ evento: Evento | null; dia: string | null } | null>(null);
  const [arrastando, setArrastando] = useState<ItemCalendario | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);
  const pode = !!base?.podeEditar;

  const dias = useMemo(() => diasVisiveis(ancora, visao), [ancora, visao]);

  const carregar = useCallback(() => {
    setErro(false);
    const de = dias[0];
    const ate = new Date(dias[dias.length - 1].getFullYear(), dias[dias.length - 1].getMonth(), dias[dias.length - 1].getDate() + 1);
    daily
      .calendario(de.toISOString(), ate.toISOString(), { cliente, meus })
      .then((r) => setItens(r.itens))
      .catch(() => setErro(true));
  }, [dias, cliente, meus]);
  useEffect(() => {
    carregar();
  }, [carregar, versao]);

  const porDia = useMemo(() => {
    const m = new Map<string, ItemCalendario[]>();
    for (const it of itens ?? []) {
      if (ocultos.includes(it.origem)) continue;
      const k = diaDoItem(it);
      m.set(k, [...(m.get(k) ?? []), it]);
    }
    for (const l of m.values()) l.sort((a, b) => ordem(a) - ordem(b) || a.inicio.localeCompare(b.inicio));
    return m;
  }, [itens, ocultos]);

  const navegar = (passo: number) => {
    setAncora((a) => (visao === 'mes' ? new Date(a.getFullYear(), a.getMonth() + passo, 1) : new Date(a.getFullYear(), a.getMonth(), a.getDate() + 7 * passo)));
  };

  const titulo = useMemo(() => {
    if (visao === 'mes') {
      const t = ancora.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      return t.charAt(0).toUpperCase() + t.slice(1);
    }
    const a = dias[0];
    const b = dias[6];
    const mes = (d: Date) => d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
    return a.getMonth() === b.getMonth() ? `${a.getDate()} a ${b.getDate()} de ${mes(b)} ${b.getFullYear()}` : `${a.getDate()} ${mes(a)} a ${b.getDate()} ${mes(b)} ${b.getFullYear()}`;
  }, [ancora, dias, visao]);

  const abrir = (it: ItemCalendario) => {
    if (it.origem === 'evento') setModal({ evento: it, dia: null });
    else abrirTarefa(it.id);
  };

  const reagendar = async (it: ItemCalendario, dia: string) => {
    if (diaDoItem(it) === dia) return;
    const [y, m, d] = dia.split('-').map(Number);
    const antigo = new Date(it.inicio);
    const novo = new Date(y, m - 1, d, antigo.getHours(), antigo.getMinutes());
    // Otimista: move o chip na hora.
    setItens((l) => l?.map((x) => (x.chave === it.chave ? ({ ...x, inicio: novo.toISOString() } as ItemCalendario) : x)) ?? l);
    try {
      if (it.origem === 'evento') {
        const delta = novo.getTime() - antigo.getTime();
        await daily.atualizarEvento(it.id, { inicioEm: novo.toISOString(), fimEm: it.fim ? new Date(new Date(it.fim).getTime() + delta).toISOString() : null });
      } else if (it.origem === 'prazo') {
        await daily.atualizar(it.id, { prazoEm: prazoDoDia(dia) });
      } else {
        await daily.atualizar(it.id, { publicarEm: novo.toISOString() });
      }
      toast.success('Reagendado', { description: `${it.titulo} → ${novo.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' })}` });
      recarregar();
    } catch (e) {
      toast.error('Não foi possível reagendar', { description: e instanceof Error ? e.message : '' });
      carregar();
    }
  };

  const hoje = ymd(new Date());
  const mesAtual = ancora.getMonth();

  const celula = (dia: Date, alta: boolean) => {
    const k = ymd(dia);
    const lista = porDia.get(k) ?? [];
    const limite = alta ? lista.length : 3;
    const fora = visao === 'mes' && dia.getMonth() !== mesAtual;
    return (
      <div
        key={k}
        onDragOver={(e) => {
          if (!arrastando) return;
          e.preventDefault();
          setAlvo(k);
        }}
        onDragLeave={() => setAlvo((a) => (a === k ? null : a))}
        onDrop={(e) => {
          e.preventDefault();
          if (arrastando) void reagendar(arrastando, k);
          setArrastando(null);
          setAlvo(null);
        }}
        onDoubleClick={() => pode && setModal({ evento: null, dia: k })}
        className={cx(
          'group relative flex min-w-0 flex-col gap-1 border-b border-r border-line p-1.5 transition',
          alta ? 'min-h-[420px]' : 'min-h-[118px]',
          fora && 'bg-surface2/50',
          alvo === k && 'bg-brand-softer',
        )}
      >
        <div className="flex items-center justify-between">
          <span
            className={cx(
              'grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs tabular',
              k === hoje ? 'bg-brand-soft font-semibold text-brand ring-1 ring-brand-border' : fora ? 'text-faint' : 'text-muted',
            )}
          >
            {alta ? `${SEMANA[dia.getDay()]} ${dia.getDate()}` : dia.getDate()}
          </span>
          {pode && (
            <button
              type="button"
              onClick={() => setModal({ evento: null, dia: k })}
              aria-label={`Novo evento em ${dia.toLocaleDateString('pt-BR')}`}
              className="grid h-6 w-6 place-items-center rounded-full text-faint opacity-0 transition hover:bg-surface hover:text-fg focus:opacity-100 group-hover:opacity-100"
            >
              <Icon name="plus" size={13} />
            </button>
          )}
        </div>
        {lista.slice(0, limite).map((it) => (
          <Chip key={it.chave} it={it} arrastavel={pode} onAbrir={() => abrir(it)} onArrastar={setArrastando} arrastando={arrastando?.chave === it.chave} />
        ))}
        {lista.length > limite && (
          <button
            type="button"
            onClick={() => {
              setAncora(dia);
              setVisao('semana');
            }}
            className="rounded-md px-1.5 py-0.5 text-left text-[11.5px] font-medium text-muted hover:bg-surface hover:text-fg"
          >
            +{lista.length - limite} mais
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" iconOnly icon="arrowLeft" aria-label="Anterior" onClick={() => navegar(-1)} />
          <Button size="sm" variant="secondary" onClick={() => setAncora(inicioDoDia())}>Hoje</Button>
          <Button size="sm" variant="ghost" iconOnly icon="arrowRight" aria-label="Próximo" onClick={() => navegar(1)} />
        </div>
        <h2 className="t-section min-w-[180px]">{titulo}</h2>
        <FiltroSelect rotulo="Cliente" icone="building" valor={cliente} onChange={setCliente} opcoes={[{ value: 'interno', label: 'Interno (sem cliente)' }, ...(base?.clientes ?? []).map((c) => ({ value: c.id, label: c.nome }))]} />
        <label className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-[12.5px] text-muted">
          <input type="checkbox" className="checkbox" checked={meus} onChange={(e) => setMeus(e.target.checked)} /> Só os meus
        </label>
        <div className="ml-auto flex items-center gap-2">
          <div className="segbar" role="tablist" aria-label="Visualização">
            {(['mes', 'semana'] as Visao[]).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={visao === v} className="seg" onClick={() => setVisao(v)}>
                {v === 'mes' ? 'Mês' : 'Semana'}
              </button>
            ))}
          </div>
          {pode && <Button size="sm" icon="plus" onClick={() => setModal({ evento: null, dia: ymd(visao === 'mes' && ancora.getMonth() !== new Date().getMonth() ? ancora : new Date()) })}>Novo evento</Button>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {(Object.keys(ORIGEM) as Origem[]).map((o) => {
          const ativo = !ocultos.includes(o);
          return (
            <button
              key={o}
              type="button"
              aria-pressed={ativo}
              onClick={() => setOcultos((l) => (ativo ? [...l, o] : l.filter((x) => x !== o)))}
              className={cx('inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 font-medium transition', ativo ? 'border-line text-fg' : 'border-dashed border-line text-faint line-through')}
            >
              <span className={cx('h-2 w-2 rounded-full', ORIGEM[o].ponto)} /> {ORIGEM[o].rotulo}
              {itens && <span className="tabular text-faint">{itens.filter((i) => i.origem === o).length}</span>}
            </button>
          );
        })}
        <span className="ml-auto hidden text-faint md:inline">Arraste para reagendar · clique duas vezes num dia para criar evento</span>
      </div>

      {erro ? (
        <div className="card p-8 text-center text-sm text-muted">
          Não foi possível carregar o calendário. <button type="button" className="font-medium text-brand hover:underline" onClick={carregar}>Tentar de novo</button>
        </div>
      ) : (
        <div className="card relative overflow-hidden p-0">
          <div className="scrollbar-thin overflow-x-auto">
            <div className="min-w-[720px]">
              {visao === 'mes' && (
                <div className="grid grid-cols-7 border-b border-line bg-surface2/60">
                  {SEMANA.map((d) => (
                    <span key={d} className="border-r border-line px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint last:border-r-0">{d}</span>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-7 [&>*:nth-child(7n)]:border-r-0">{dias.map((d) => celula(d, visao === 'semana'))}</div>
            </div>
          </div>
          {!itens && (
            <div className="absolute inset-x-0 top-10 flex justify-center">
              <Skeleton className="h-6 w-40 rounded-full" />
            </div>
          )}
        </div>
      )}

      <EventoModal aberto={!!modal} evento={modal?.evento ?? null} dia={modal?.dia ?? null} onClose={() => setModal(null)} onSalvo={recarregar} />
    </div>
  );
}

function Chip({ it, arrastavel, arrastando, onAbrir, onArrastar }: { it: ItemCalendario; arrastavel: boolean; arrastando: boolean; onAbrir: () => void; onArrastar: (it: ItemCalendario | null) => void }) {
  const atrasado = it.origem === 'prazo' && !it.concluida && new Date(it.inicio).getTime() < inicioDoDia().getTime();
  const feito = it.origem !== 'evento' && it.concluida;
  const hora = it.origem === 'evento' && !it.diaInteiro ? horaLocal(it.inicio) : it.origem === 'publicacao' ? horaLocal(it.inicio) : null;
  const detalhe =
    it.origem === 'evento'
      ? [it.local, it.participantes.map((p) => p.nome).join(', ')].filter(Boolean).join(' · ')
      : it.origem === 'publicacao'
        ? APROVACAO[it.aprovacao].label
        : it.responsavel?.nome ?? 'Sem responsável';
  return (
    <button
      type="button"
      draggable={arrastavel}
      onDragStart={(e) => {
        onArrastar(it);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', it.chave);
      }}
      onDragEnd={() => onArrastar(null)}
      onClick={(e) => {
        e.stopPropagation();
        onAbrir();
      }}
      title={`${it.titulo}${it.cliente ? ` · ${it.cliente.nome}` : ''}${detalhe ? ` · ${detalhe}` : ''}`}
      className={cx(
        'flex w-full min-w-0 items-center gap-1 rounded-md px-1.5 py-[3px] text-left text-[11.5px] font-medium leading-tight transition hover:brightness-95',
        atrasado ? 'bg-danger-soft text-danger' : feito ? 'bg-success-soft text-success' : ORIGEM[it.origem].chip,
        arrastando && 'opacity-40',
      )}
    >
      {it.origem === 'prazo' && <Icon name={feito ? 'check' : 'flame'} size={11} className="shrink-0" />}
      {it.origem === 'publicacao' && <Icon name="send" size={11} className="shrink-0" />}
      {hora && <span className="shrink-0 tabular opacity-80">{hora}</span>}
      <span className={cx('truncate', feito && 'line-through')}>
        {it.origem !== 'evento' && <span className="font-mono opacity-70">{codigo(it.numero)} </span>}
        {it.titulo}
      </span>
    </button>
  );
}
