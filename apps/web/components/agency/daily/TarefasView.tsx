'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { Button, SkeletonRows, useToast } from '@/components/kit';
import {
  PRIORIDADE,
  PRIORIDADE_ORDEM,
  STATUS,
  STATUS_ORDEM,
  TIPO,
  TIPO_ORDEM,
  TOM,
  codigo,
  daily,
  faixaPrazo,
  prazoDoDia,
  ymd,
  type NovaTarefa,
  type Prioridade,
  type Status,
  type Tarefa,
  type Tipo,
  type Tom,
} from '@/lib/agency-daily';
import { useDaily } from './DailyContext';
import { Concluir, Contadores, FiltroSelect, Pessoa, Ponto, Prazo, PrioridadeFlag, StatusPill, Tipo as TipoTag, Vazio } from './pecas';

type Visao = 'lista' | 'quadro';
type Agrupar = 'prazo' | 'status' | 'responsavel' | 'prioridade' | 'cliente' | 'nenhum';
const AGRUPAR: Record<Agrupar, string> = { prazo: 'Prazo', status: 'Status', responsavel: 'Responsável', prioridade: 'Prioridade', cliente: 'Cliente', nenhum: 'Nenhum' };

interface Grupo {
  chave: string;
  rotulo: string;
  tom?: Tom;
  tarefas: Tarefa[];
  /** Valores aplicados a uma tarefa criada direto neste grupo. */
  padrao: Partial<NovaTarefa>;
  recolhido?: boolean;
}

const FAIXAS: { chave: string; rotulo: string; tom: Tom }[] = [
  { chave: 'atrasada', rotulo: 'Atrasadas', tom: 'danger' },
  { chave: 'hoje', rotulo: 'Hoje', tom: 'warning' },
  { chave: 'amanha', rotulo: 'Amanhã', tom: 'brand' },
  { chave: 'semana', rotulo: 'Próximos 7 dias', tom: 'info' },
  { chave: 'depois', rotulo: 'Mais adiante', tom: 'neutro' },
  { chave: 'sem', rotulo: 'Sem prazo', tom: 'neutro' },
];

const lerPreferencia = <T extends string>(chave: string, validos: readonly T[], padrao: T): T => {
  try {
    const v = localStorage.getItem(chave);
    return v && (validos as readonly string[]).includes(v) ? (v as T) : padrao;
  } catch {
    return padrao;
  }
};
const gravarPreferencia = (chave: string, v: string) => {
  try {
    localStorage.setItem(chave, v);
  } catch {
    /* preferência é só conveniência */
  }
};

/**
 * Lista/quadro de tarefas do Daily. `minhas` = atribuídas a mim (inclui
 * subtarefas), agrupadas por prazo; `todas` = operação inteira, por status.
 */
export function TarefasView({ escopo }: { escopo: 'minhas' | 'todas' }) {
  const { base, versao, recarregar, abrirTarefa, novaTarefa } = useDaily();
  const toast = useToast();
  const [tarefas, setTarefas] = useState<Tarefa[] | null>(null);
  const [erro, setErro] = useState(false);
  const [visao, setVisao] = useState<Visao>('lista');
  const [agrupar, setAgrupar] = useState<Agrupar>(escopo === 'minhas' ? 'prazo' : 'status');
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [cliente, setCliente] = useState('');
  const [responsavel, setResponsavel] = useState('');
  const [prioridade, setPrioridade] = useState<Prioridade | ''>('');
  const [tipo, setTipo] = useState<Tipo | ''>('');
  const [prazo, setPrazo] = useState<'' | 'atrasadas' | 'hoje' | 'semana' | 'sem'>('');
  const [concluidas, setConcluidas] = useState(escopo === 'todas');
  const [arquivadas, setArquivadas] = useState(false);
  const pode = !!base?.podeEditar;

  useEffect(() => {
    setVisao(lerPreferencia<Visao>(`daily.${escopo}.visao`, ['lista', 'quadro'], 'lista'));
    setAgrupar(lerPreferencia(`daily.${escopo}.agrupar`, Object.keys(AGRUPAR) as Agrupar[], escopo === 'minhas' ? 'prazo' : 'status'));
  }, [escopo]);

  useEffect(() => {
    const t = setTimeout(() => setBuscaAplicada(busca.trim()), 250);
    return () => clearTimeout(t);
  }, [busca]);

  const carregar = useCallback(() => {
    setErro(false);
    daily
      .tarefas({
        escopo,
        q: buscaAplicada,
        cliente,
        responsavel: escopo === 'todas' ? responsavel : '',
        prioridade,
        tipo,
        prazo,
        arquivadas: arquivadas ? '1' : '',
      })
      .then(setTarefas)
      .catch(() => setErro(true));
  }, [escopo, buscaAplicada, cliente, responsavel, prioridade, tipo, prazo, arquivadas]);

  useEffect(() => {
    carregar();
  }, [carregar, versao]);

  const visiveis = useMemo(() => (tarefas ?? []).filter((t) => concluidas || visao === 'quadro' || t.status !== 'concluida'), [tarefas, concluidas, visao]);

  const atualizarLocal = (id: string, patch: Partial<Tarefa>) => setTarefas((l) => l?.map((t) => (t.id === id ? { ...t, ...patch } : t)) ?? l);

  const concluir = async (t: Tarefa) => {
    const status: Status = t.status === 'concluida' ? 'a_fazer' : 'concluida';
    atualizarLocal(t.id, { status });
    try {
      await daily.atualizar(t.id, { status });
      if (status === 'concluida') toast.success(`${codigo(t.numero)} concluída`);
      recarregar();
    } catch {
      toast.error('Não foi possível atualizar a tarefa');
      carregar();
    }
  };

  const mover = async (t: Tarefa, status: Status, posicao: number) => {
    if (t.status === status && t.posicao === posicao) return;
    atualizarLocal(t.id, { status, posicao });
    try {
      await daily.atualizar(t.id, { status, posicao });
      recarregar();
    } catch {
      toast.error('Não foi possível mover a tarefa');
      carregar();
    }
  };

  const criarRapido = async (titulo: string, padrao: Partial<NovaTarefa>) => {
    try {
      await daily.criar({
        titulo,
        responsavelId: escopo === 'minhas' ? base?.eu : responsavel && responsavel !== 'nenhum' ? (responsavel === 'eu' ? base?.eu : responsavel) : null,
        clientId: cliente && cliente !== 'interno' ? cliente : null,
        ...(tipo ? { tipo } : {}),
        ...(prioridade ? { prioridade } : {}),
        ...padrao,
      });
      recarregar();
    } catch (e) {
      toast.error('Não foi possível criar', { description: e instanceof Error ? e.message : '' });
    }
  };

  const grupos = useMemo(() => agruparTarefas(visiveis, agrupar, base?.eu), [visiveis, agrupar, base?.eu]);
  const filtrando = !!(buscaAplicada || cliente || responsavel || prioridade || tipo || prazo || arquivadas);

  const resumo = useMemo(() => {
    const abertas = (tarefas ?? []).filter((t) => t.status !== 'concluida');
    const inicioSemana = new Date();
    inicioSemana.setDate(inicioSemana.getDate() - 7);
    return [
      { rotulo: 'Atrasadas', valor: abertas.filter((t) => faixaPrazo(t.prazoEm, false) === 'atrasada').length, tom: 'danger' as Tom, prazo: 'atrasadas' as const },
      { rotulo: 'Para hoje', valor: abertas.filter((t) => faixaPrazo(t.prazoEm, false) === 'hoje').length, tom: 'warning' as Tom, prazo: 'hoje' as const },
      { rotulo: 'Próximos 7 dias', valor: abertas.filter((t) => ['amanha', 'semana'].includes(faixaPrazo(t.prazoEm, false))).length, tom: 'info' as Tom, prazo: 'semana' as const },
      { rotulo: 'Concluídas na semana', valor: (tarefas ?? []).filter((t) => t.concluidaEm && new Date(t.concluidaEm) >= inicioSemana).length, tom: 'success' as Tom, prazo: '' as const },
    ];
  }, [tarefas]);

  return (
    <div className="space-y-4">
      {escopo === 'minhas' && !filtrando && tarefas && (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {resumo.map((r) => (
            <button
              key={r.rotulo}
              type="button"
              onClick={() => r.prazo && setPrazo(r.prazo)}
              disabled={!r.prazo}
              className="card flex items-center gap-3 px-4 py-3 text-left transition enabled:hover:border-line-strong disabled:cursor-default"
            >
              <Ponto tom={r.tom} className="h-2.5 w-2.5" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-muted">{r.rotulo}</span>
                <span className="t-kpi block text-2xl tabular">{r.valor}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="search-field relative min-w-[200px] flex-1 sm:max-w-xs">
          <span className="sr-only">Buscar tarefas</span>
          <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input type="search" className="input h-8 pl-8 text-[13px]" placeholder="Buscar por título, cliente ou #número" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </label>
        <FiltroSelect rotulo="Cliente" icone="building" valor={cliente} onChange={setCliente} opcoes={[{ value: 'interno', label: 'Interno (sem cliente)' }, ...(base?.clientes ?? []).map((c) => ({ value: c.id, label: c.nome }))]} />
        {escopo === 'todas' && (
          <FiltroSelect
            rotulo="Responsável"
            icone="user"
            valor={responsavel}
            onChange={setResponsavel}
            opcoes={[{ value: 'eu', label: 'Eu' }, { value: 'nenhum', label: 'Sem responsável' }, ...(base?.membros ?? []).filter((m) => m.id !== base?.eu).map((m) => ({ value: m.id, label: m.nome }))]}
          />
        )}
        <FiltroSelect rotulo="Prazo" icone="calendar" valor={prazo} onChange={setPrazo} opcoes={[{ value: 'atrasadas', label: 'Atrasadas' }, { value: 'hoje', label: 'Hoje' }, { value: 'semana', label: 'Próximos 7 dias' }, { value: 'sem', label: 'Sem prazo' }]} />
        <FiltroSelect rotulo="Prioridade" icone="flame" valor={prioridade} onChange={setPrioridade} opcoes={PRIORIDADE_ORDEM.map((p) => ({ value: p, label: PRIORIDADE[p].label }))} />
        <FiltroSelect rotulo="Tipo" icone="tag" valor={tipo} onChange={setTipo} opcoes={TIPO_ORDEM.map((t) => ({ value: t, label: TIPO[t].label }))} />
        {filtrando && (
          <button
            type="button"
            className="text-xs font-medium text-brand hover:underline"
            onClick={() => {
              setBusca('');
              setCliente('');
              setResponsavel('');
              setPrioridade('');
              setTipo('');
              setPrazo('');
              setArquivadas(false);
            }}
          >
            Limpar filtros
          </button>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {visao === 'lista' && (
            <label className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-[12.5px] text-muted">
              <Icon name="layout" size={13} /> Agrupar
              <select
                className="bg-transparent font-medium text-fg outline-none"
                value={agrupar}
                onChange={(e) => {
                  setAgrupar(e.target.value as Agrupar);
                  gravarPreferencia(`daily.${escopo}.agrupar`, e.target.value);
                }}
              >
                {(Object.keys(AGRUPAR) as Agrupar[]).filter((a) => !(escopo === 'minhas' && a === 'responsavel')).map((a) => (
                  <option key={a} value={a}>
                    {AGRUPAR[a]}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="segbar" role="tablist" aria-label="Visualização">
            {(['lista', 'quadro'] as Visao[]).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={visao === v}
                className="seg"
                onClick={() => {
                  setVisao(v);
                  gravarPreferencia(`daily.${escopo}.visao`, v);
                }}
              >
                <Icon name={v === 'lista' ? 'list' : 'grid'} size={14} /> {v === 'lista' ? 'Lista' : 'Quadro'}
              </button>
            ))}
          </div>
          {pode && (
            <Button size="sm" icon="plus" onClick={() => novaTarefa(escopo === 'minhas' ? { responsavelId: base?.eu } : {})}>
              Nova tarefa
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
        {visao === 'lista' && (
          <label className="inline-flex items-center gap-1.5">
            <input type="checkbox" className="checkbox" checked={concluidas} onChange={(e) => setConcluidas(e.target.checked)} /> Mostrar concluídas
          </label>
        )}
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" className="checkbox" checked={arquivadas} onChange={(e) => setArquivadas(e.target.checked)} /> Só arquivadas
        </label>
        {tarefas && (
          <span className="ml-auto tabular">
            {visiveis.length} {visiveis.length === 1 ? 'tarefa' : 'tarefas'}
            {tarefas.length >= 500 && ' (mostrando as 500 primeiras; refine os filtros)'}
          </span>
        )}
      </div>

      {erro ? (
        <Vazio icone="alert" titulo="Não foi possível carregar" texto="Verifique a conexão e tente de novo." acao={<Button size="sm" variant="secondary" onClick={carregar}>Tentar de novo</Button>} />
      ) : !tarefas ? (
        <div className="card p-4"><SkeletonRows rows={6} /></div>
      ) : visao === 'quadro' ? (
        <Quadro tarefas={visiveis} pode={pode} onAbrir={abrirTarefa} onMover={mover} onCriar={(status) => novaTarefa({ status, ...(escopo === 'minhas' ? { responsavelId: base?.eu } : {}) })} />
      ) : visiveis.length === 0 ? (
        <Vazio
          icone={filtrando ? 'filter' : 'check2'}
          titulo={filtrando ? 'Nenhuma tarefa com esses filtros' : escopo === 'minhas' ? 'Nada atribuído a você agora' : 'Nenhuma tarefa ainda'}
          texto={filtrando ? 'Ajuste ou limpe os filtros para ver mais.' : 'Crie a primeira tarefa da equipe: entregas de clientes, conteúdos, reuniões.'}
          acao={pode && !filtrando && <Button size="sm" icon="plus" onClick={() => novaTarefa(escopo === 'minhas' ? { responsavelId: base?.eu } : {})}>Nova tarefa</Button>}
        />
      ) : (
        <div className="space-y-4">
          {grupos.map((g) => (
            <GrupoLista key={g.chave} grupo={g} pode={pode && !arquivadas} mostrarResponsavel={escopo === 'todas'} onAbrir={abrirTarefa} onConcluir={concluir} onCriar={(titulo) => criarRapido(titulo, g.padrao)} />
          ))}
        </div>
      )}
    </div>
  );
}

function agruparTarefas(tarefas: Tarefa[], por: Agrupar, eu?: string): Grupo[] {
  if (por === 'nenhum') return [{ chave: 'todas', rotulo: 'Todas as tarefas', tarefas, padrao: {} }];
  if (por === 'status') {
    return STATUS_ORDEM.map((s) => ({ chave: s, rotulo: STATUS[s].label, tom: STATUS[s].tom, tarefas: tarefas.filter((t) => t.status === s), padrao: { status: s }, recolhido: s === 'concluida' }));
  }
  if (por === 'prioridade') {
    return PRIORIDADE_ORDEM.map((p) => ({ chave: p, rotulo: PRIORIDADE[p].label, tom: PRIORIDADE[p].tom, tarefas: tarefas.filter((t) => t.prioridade === p), padrao: { prioridade: p } })).filter((g) => g.tarefas.length);
  }
  if (por === 'prazo') {
    const ordenadas = [...tarefas].sort((a, b) => (a.prazoEm ?? '9').localeCompare(b.prazoEm ?? '9') || PRIORIDADE[b.prioridade].peso - PRIORIDADE[a.prioridade].peso);
    const abertas = ordenadas.filter((t) => t.status !== 'concluida');
    const hoje = ymd(new Date());
    const amanha = ymd(new Date(Date.now() + 86_400_000));
    const padraoFaixa: Record<string, Partial<NovaTarefa>> = { hoje: { prazoEm: prazoDoDia(hoje) }, amanha: { prazoEm: prazoDoDia(amanha) }, sem: {} };
    const grupos: Grupo[] = FAIXAS.map((f) => ({
      chave: f.chave,
      rotulo: f.rotulo,
      tom: f.tom,
      tarefas: abertas.filter((t) => faixaPrazo(t.prazoEm, false) === f.chave),
      padrao: padraoFaixa[f.chave] ?? {},
    })).filter((g) => g.tarefas.length || g.chave === 'hoje');
    const feitas = ordenadas.filter((t) => t.status === 'concluida');
    if (feitas.length) grupos.push({ chave: 'concluidas', rotulo: 'Concluídas', tom: 'success', tarefas: feitas, padrao: {}, recolhido: true });
    return grupos;
  }
  const mapa = new Map<string, Grupo>();
  for (const t of tarefas) {
    const ent = por === 'responsavel' ? t.responsavel : t.cliente;
    const chave = ent?.id ?? 'nenhum';
    let g = mapa.get(chave);
    if (!g) {
      g = {
        chave,
        rotulo: ent ? (por === 'responsavel' && ent.id === eu ? `${ent.nome} (você)` : ent.nome) : por === 'responsavel' ? 'Sem responsável' : 'Interno',
        tarefas: [],
        padrao: por === 'responsavel' ? { responsavelId: ent?.id ?? null } : { clientId: ent?.id ?? null },
      };
      mapa.set(chave, g);
    }
    g.tarefas.push(t);
  }
  return [...mapa.values()].sort((a, b) => (a.chave === 'nenhum' ? 1 : b.chave === 'nenhum' ? -1 : a.rotulo.localeCompare(b.rotulo, 'pt-BR')));
}

function GrupoLista({
  grupo,
  pode,
  mostrarResponsavel,
  onAbrir,
  onConcluir,
  onCriar,
}: {
  grupo: Grupo;
  pode: boolean;
  mostrarResponsavel: boolean;
  onAbrir: (id: string) => void;
  onConcluir: (t: Tarefa) => void;
  onCriar: (titulo: string) => Promise<void>;
}) {
  const [aberto, setAberto] = useState(!grupo.recolhido);
  const [novo, setNovo] = useState<string | null>(null);
  const criar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!novo?.trim()) return;
    const titulo = novo.trim();
    setNovo('');
    await onCriar(titulo);
  };
  return (
    <section className="card overflow-hidden p-0">
      <header className="flex items-center gap-2 px-4 py-2.5">
        <button type="button" onClick={() => setAberto((a) => !a)} aria-expanded={aberto} className="inline-flex min-w-0 items-center gap-2 text-left">
          <Icon name="chevronDown" size={14} className={cx('shrink-0 text-faint transition-transform', !aberto && '-rotate-90')} />
          {grupo.tom && <span className={cx('h-[18px] rounded-full px-2 text-[11.5px] font-semibold leading-[18px]', TOM[grupo.tom].pill)}>{grupo.rotulo}</span>}
          {!grupo.tom && <span className="truncate text-sm font-semibold text-fg">{grupo.rotulo}</span>}
          <span className="text-xs tabular text-faint">{grupo.tarefas.length}</span>
        </button>
        {pode && grupo.chave !== 'concluidas' && (
          <button type="button" onClick={() => { setAberto(true); setNovo(''); }} className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted hover:bg-surface2 hover:text-fg">
            <Icon name="plus" size={13} /> Adicionar
          </button>
        )}
      </header>
      {aberto && (
        <ul className="border-t border-line">
          {grupo.tarefas.map((t) => (
            <Linha key={t.id} t={t} pode={pode} mostrarResponsavel={mostrarResponsavel} onAbrir={onAbrir} onConcluir={onConcluir} />
          ))}
          {novo !== null && (
            <li className="border-t border-line px-4 py-2">
              <form onSubmit={criar} className="flex items-center gap-2.5">
                <span className="h-[18px] w-[18px] shrink-0 rounded-full border border-dashed border-line-strong" />
                <input
                  autoFocus
                  className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
                  placeholder="Nome da tarefa e Enter (Esc cancela)"
                  value={novo}
                  maxLength={200}
                  onChange={(e) => setNovo(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setNovo(null)}
                  onBlur={() => !novo.trim() && setNovo(null)}
                />
              </form>
            </li>
          )}
          {grupo.tarefas.length === 0 && novo === null && <li className="px-4 py-3 text-xs text-faint">Nada aqui.</li>}
        </ul>
      )}
    </section>
  );
}

function Linha({ t, pode, mostrarResponsavel, onAbrir, onConcluir }: { t: Tarefa; pode: boolean; mostrarResponsavel: boolean; onAbrir: (id: string) => void; onConcluir: (t: Tarefa) => void }) {
  const feita = t.status === 'concluida';
  return (
    <li className="border-t border-line first:border-t-0">
      {/* A linha inteira abre no clique (atalho de mouse); para teclado e leitor
          de tela o controle é o botão do título, sem botão dentro de botão. */}
      <div
        onClick={() => onAbrir(t.id)}
        className="group grid cursor-pointer grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 transition hover:bg-surface2 has-[:focus-visible]:bg-surface2 md:grid-cols-[18px_minmax(0,1fr)_150px_110px_130px_150px]"
      >
        <Concluir feita={feita} disabled={!pode} onClick={() => onConcluir(t)} />
        <div className="min-w-0">
          <p className={cx('flex min-w-0 items-center gap-2 text-sm', feita ? 'text-faint line-through' : 'text-fg')}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAbrir(t.id);
              }}
              className="truncate text-left font-medium outline-none focus-visible:underline"
            >
              {t.titulo}
            </button>
            <Contadores tarefa={t} />
          </p>
          <p className="mt-0.5 flex min-w-0 items-center gap-2 text-[11.5px] text-faint">
            <span className="font-mono">{codigo(t.numero)}</span>
            {t.parent && <span className="truncate">↳ {t.parent.titulo}</span>}
            <span className="truncate md:hidden">{t.cliente?.nome ?? 'Interno'}</span>
            <span className="md:hidden"><Prazo tarefa={t} compacto /></span>
          </p>
        </div>
        <span className="hidden min-w-0 truncate text-xs text-muted md:block">{t.cliente?.nome ?? <span className="text-faint">Interno</span>}</span>
        <span className="hidden md:block"><TipoTag tarefa={t} /></span>
        <span className="hidden md:block"><Prazo tarefa={t} /></span>
        <span className="flex items-center justify-end gap-2">
          <PrioridadeFlag prioridade={t.prioridade} />
          {mostrarResponsavel && <Pessoa pessoa={t.responsavel} />}
          <span className="hidden lg:inline-flex"><StatusPill status={t.status} /></span>
        </span>
      </div>
    </li>
  );
}

/** Quadro por status com arrastar e soltar nativo (sem lib nova). */
function Quadro({
  tarefas,
  pode,
  onAbrir,
  onMover,
  onCriar,
}: {
  tarefas: Tarefa[];
  pode: boolean;
  onAbrir: (id: string) => void;
  onMover: (t: Tarefa, status: Status, posicao: number) => void;
  onCriar: (status: Status) => void;
}) {
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);
  const porId = useMemo(() => new Map(tarefas.map((t) => [t.id, t])), [tarefas]);

  const soltar = (status: Status, antesDe: string | null) => {
    const t = arrastando ? porId.get(arrastando) : undefined;
    setArrastando(null);
    setAlvo(null);
    if (!t) return;
    const coluna = tarefas.filter((x) => x.status === status && x.id !== t.id).sort((a, b) => a.posicao - b.posicao);
    const i = antesDe ? coluna.findIndex((x) => x.id === antesDe) : -1;
    let posicao: number;
    if (i === -1) posicao = (coluna.at(-1)?.posicao ?? 0) + 1024;
    else if (i === 0) posicao = coluna[0].posicao - 1024;
    else posicao = (coluna[i - 1].posicao + coluna[i].posicao) / 2;
    onMover(t, status, posicao);
  };

  return (
    <div className="scrollbar-thin -mx-4 flex gap-3 overflow-x-auto px-4 pb-3 lg:-mx-8 lg:px-8">
      {STATUS_ORDEM.map((s) => {
        const coluna = tarefas.filter((t) => t.status === s).sort((a, b) => a.posicao - b.posicao);
        return (
          <section
            key={s}
            aria-label={STATUS[s].label}
            onDragOver={(e) => {
              if (!arrastando) return;
              e.preventDefault();
              setAlvo(`col:${s}`);
            }}
            onDrop={(e) => {
              e.preventDefault();
              soltar(s, null);
            }}
            className={cx('flex w-[280px] shrink-0 flex-col rounded-2xl border bg-surface2/60 p-2 transition', alvo === `col:${s}` ? 'border-brand-border bg-brand-softer' : 'border-line')}
          >
            <header className="mb-2 flex items-center gap-2 px-1.5 pt-1">
              <Ponto tom={STATUS[s].tom} />
              <span className="text-[13px] font-semibold text-fg">{STATUS[s].label}</span>
              <span className="text-xs tabular text-faint">{coluna.length}</span>
              {pode && (
                <button type="button" onClick={() => onCriar(s)} aria-label={`Nova tarefa em ${STATUS[s].label}`} className="ml-auto grid h-6 w-6 place-items-center rounded-full text-muted hover:bg-surface hover:text-fg">
                  <Icon name="plus" size={14} />
                </button>
              )}
            </header>
            <div className="flex min-h-[80px] flex-1 flex-col gap-2">
              {coluna.map((t) => (
                <article
                  key={t.id}
                  draggable={pode}
                  onDragStart={(e) => {
                    setArrastando(t.id);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', t.id);
                  }}
                  onDragEnd={() => {
                    setArrastando(null);
                    setAlvo(null);
                  }}
                  onDragOver={(e) => {
                    if (!arrastando || arrastando === t.id) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setAlvo(t.id);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    soltar(s, t.id);
                  }}
                  onClick={() => onAbrir(t.id)}
                  onKeyDown={(e) => e.key === 'Enter' && onAbrir(t.id)}
                  tabIndex={0}
                  className={cx(
                    'cursor-pointer rounded-xl border bg-surface p-3 text-left shadow-sm outline-none transition hover:border-line-strong focus-visible:ring-2 focus-visible:ring-brand/40',
                    arrastando === t.id && 'opacity-40',
                    alvo === t.id ? 'border-brand border-t-2' : 'border-line',
                  )}
                >
                  <p className="mb-1 flex items-center gap-1.5 text-[11px] text-faint">
                    <span className="font-mono">{codigo(t.numero)}</span>
                    <span className="truncate">· {t.cliente?.nome ?? 'Interno'}</span>
                  </p>
                  <p className={cx('line-clamp-3 text-[13.5px] font-medium leading-snug', t.status === 'concluida' ? 'text-faint line-through' : 'text-fg')}>{t.titulo}</p>
                  {t.parent && <p className="mt-0.5 truncate text-[11px] text-faint">↳ {t.parent.titulo}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <TipoTag tarefa={t} />
                    <PrioridadeFlag prioridade={t.prioridade} />
                    <Contadores tarefa={t} />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <Prazo tarefa={t} />
                    <Pessoa pessoa={t.responsavel} />
                  </div>
                </article>
              ))}
              {coluna.length === 0 && <p className="px-2 py-4 text-center text-xs text-faint">{pode ? 'Arraste uma tarefa para cá' : 'Vazio'}</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}
