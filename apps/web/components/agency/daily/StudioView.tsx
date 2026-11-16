'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { Button, SkeletonCards, useToast } from '@/components/kit';
import {
  APROVACAO,
  APROVACAO_ORDEM,
  PLATAFORMA,
  PLATAFORMA_ORDEM,
  TIPO,
  TIPOS_CONTEUDO,
  codigo,
  daily,
  faixaPrazo,
  rotuloDia,
  horaLocal,
  type Aprovacao,
  type Plataforma,
  type Tarefa,
  type Tipo,
} from '@/lib/agency-daily';
import { useDaily } from './DailyContext';
import { AprovacaoPill, FiltroSelect, Pessoa, Ponto, Vazio } from './pecas';

type Visao = 'quadro' | 'grade';

/**
 * Studio da agência: posts, carrosséis, Reels e criativos com legenda,
 * aprovação e publicação num fluxo só. O quadro é por etapa de aprovação;
 * arrastar muda a etapa (publicar conclui a tarefa).
 */
export function StudioView() {
  const { base, versao, recarregar, abrirTarefa, novaTarefa } = useDaily();
  const toast = useToast();
  const [itens, setItens] = useState<Tarefa[] | null>(null);
  const [erro, setErro] = useState(false);
  const [visao, setVisao] = useState<Visao>('quadro');
  const [cliente, setCliente] = useState('');
  const [tipo, setTipo] = useState<Tipo | ''>('');
  const [plataforma, setPlataforma] = useState<Plataforma | ''>('');
  const [aprovacao, setAprovacao] = useState<Aprovacao | ''>('');
  const [busca, setBusca] = useState('');
  const [q, setQ] = useState('');
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<Aprovacao | null>(null);
  const pode = !!base?.podeEditar;

  useEffect(() => {
    try {
      if (localStorage.getItem('daily.studio.visao') === 'grade') setVisao('grade');
    } catch {
      /* preferência opcional */
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setQ(busca.trim()), 250);
    return () => clearTimeout(t);
  }, [busca]);

  const carregar = useCallback(() => {
    setErro(false);
    daily
      .studio({ cliente, tipo, plataforma, aprovacao, q })
      .then(setItens)
      .catch(() => setErro(true));
  }, [cliente, tipo, plataforma, aprovacao, q]);
  useEffect(() => {
    carregar();
  }, [carregar, versao]);

  const resumo = useMemo(() => {
    const l = itens ?? [];
    const c = (f: (t: Tarefa) => boolean) => l.filter(f).length;
    return [
      { rotulo: 'Conteúdos', valor: l.length, icone: 'grid' as const },
      { rotulo: 'Em aprovação', valor: c((t) => ['revisao_interna', 'aguardando_aprovacao'].includes(t.conteudo?.aprovacao ?? '')), icone: 'eye' as const },
      { rotulo: 'Com ajustes', valor: c((t) => t.conteudo?.aprovacao === 'ajustes'), icone: 'alert' as const },
      { rotulo: 'Sem legenda', valor: c((t) => !!t.conteudo && t.conteudo.exigeLegenda && !t.conteudo.temLegenda && t.conteudo.aprovacao !== 'publicado'), icone: 'edit' as const },
    ];
  }, [itens]);

  const mover = async (id: string, destino: Aprovacao) => {
    const t = itens?.find((x) => x.id === id);
    if (!t || t.conteudo?.aprovacao === destino) return;
    setItens((l) => l?.map((x) => (x.id === id && x.conteudo ? { ...x, conteudo: { ...x.conteudo, aprovacao: destino } } : x)) ?? l);
    try {
      await daily.atualizar(id, { aprovacao: destino });
      if (destino === 'publicado') toast.success(`${codigo(t.numero)} publicado`);
      recarregar();
    } catch {
      toast.error('Não foi possível mudar a etapa');
      carregar();
    }
  };

  const filtrando = !!(cliente || tipo || plataforma || aprovacao || q);
  const novo = () => novaTarefa({ tipo: 'reel', responsavelId: base?.eu, ...(cliente ? { clientId: cliente } : {}) });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {resumo.map((r) => (
          <div key={r.rotulo} className="card flex items-center gap-3 px-4 py-3">
            <span className="icon-tile icon-tile-neutral h-9 w-9">
              <Icon name={r.icone} size={16} />
            </span>
            <span>
              <span className="block text-xs text-muted">{r.rotulo}</span>
              <span className="t-kpi block text-2xl tabular">{itens ? r.valor : '–'}</span>
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <span className="sr-only">Buscar conteúdos</span>
          <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input type="search" className="input h-8 pl-8 text-[13px]" placeholder="Buscar por título, legenda ou cliente" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </label>
        <FiltroSelect rotulo="Cliente" icone="building" valor={cliente} onChange={setCliente} opcoes={[{ value: 'interno', label: 'Interno (sem cliente)' }, ...(base?.clientes ?? []).map((c) => ({ value: c.id, label: c.nome }))]} />
        <FiltroSelect rotulo="Formato" icone="video" valor={tipo} onChange={setTipo} opcoes={TIPOS_CONTEUDO.map((t) => ({ value: t, label: TIPO[t].label }))} />
        <FiltroSelect rotulo="Plataforma" icone="instagram" valor={plataforma} onChange={setPlataforma} opcoes={PLATAFORMA_ORDEM.map((p) => ({ value: p, label: PLATAFORMA[p].label }))} />
        <FiltroSelect rotulo="Etapa" icone="target" valor={aprovacao} onChange={setAprovacao} opcoes={APROVACAO_ORDEM.map((a) => ({ value: a, label: APROVACAO[a].label }))} />
        <div className="ml-auto flex items-center gap-2">
          <div className="segbar" role="tablist" aria-label="Visualização">
            {(['quadro', 'grade'] as Visao[]).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={visao === v}
                className="seg"
                onClick={() => {
                  setVisao(v);
                  try {
                    localStorage.setItem('daily.studio.visao', v);
                  } catch {
                    /* opcional */
                  }
                }}
              >
                <Icon name={v === 'quadro' ? 'layout' : 'grid'} size={14} /> {v === 'quadro' ? 'Aprovação' : 'Grade'}
              </button>
            ))}
          </div>
          {pode && <Button size="sm" icon="plus" onClick={novo}>Novo conteúdo</Button>}
        </div>
      </div>

      {erro ? (
        <Vazio icone="alert" titulo="Não foi possível carregar o Studio" texto="Verifique a conexão e tente de novo." acao={<Button size="sm" variant="secondary" onClick={carregar}>Tentar de novo</Button>} />
      ) : !itens ? (
        <SkeletonCards />
      ) : itens.length === 0 ? (
        <Vazio
          icone="sparkles"
          titulo={filtrando ? 'Nenhum conteúdo com esses filtros' : 'Nenhum conteúdo ainda'}
          texto={filtrando ? 'Ajuste os filtros para ver mais.' : 'Crie posts, carrosséis, Reels e criativos para acompanhar legenda, aprovação e publicação.'}
          acao={pode && !filtrando && <Button size="sm" icon="plus" onClick={novo}>Novo conteúdo</Button>}
        />
      ) : visao === 'grade' ? (
        <div className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {itens.map((t) => (
            <CardConteudo key={t.id} t={t} onAbrir={() => abrirTarefa(t.id)} grade />
          ))}
        </div>
      ) : (
        <div className="scrollbar-thin -mx-4 flex gap-3 overflow-x-auto px-4 pb-3 lg:-mx-8 lg:px-8">
          {APROVACAO_ORDEM.map((a) => {
            const coluna = itens.filter((t) => (t.conteudo?.aprovacao ?? 'em_producao') === a);
            return (
              <section
                key={a}
                aria-label={APROVACAO[a].label}
                onDragOver={(e) => {
                  if (!arrastando) return;
                  e.preventDefault();
                  setAlvo(a);
                }}
                onDragLeave={() => setAlvo((x) => (x === a ? null : x))}
                onDrop={(e) => {
                  e.preventDefault();
                  if (arrastando) void mover(arrastando, a);
                  setArrastando(null);
                  setAlvo(null);
                }}
                className={cx('flex w-[280px] shrink-0 flex-col rounded-2xl border bg-surface2/60 p-2 transition', alvo === a ? 'border-brand-border bg-brand-softer' : 'border-line')}
              >
                <header className="mb-2 flex items-center gap-2 px-1.5 pt-1">
                  <Ponto tom={APROVACAO[a].tom} />
                  <span className="text-[13px] font-semibold text-fg">{APROVACAO[a].label}</span>
                  <span className="text-xs tabular text-faint">{coluna.length}</span>
                </header>
                <div className="flex min-h-[80px] flex-1 flex-col gap-2">
                  {coluna.map((t) => (
                    <div
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
                      className={cx(arrastando === t.id && 'opacity-40')}
                    >
                      <CardConteudo t={t} onAbrir={() => abrirTarefa(t.id)} />
                    </div>
                  ))}
                  {coluna.length === 0 && <p className="px-2 py-4 text-center text-xs text-faint">{pode ? 'Arraste um conteúdo para cá' : 'Vazio'}</p>}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CardConteudo({ t, onAbrir, grade }: { t: Tarefa; onAbrir: () => void; grade?: boolean }) {
  const c = t.conteudo;
  const atrasada = faixaPrazo(t.prazoEm, t.status === 'concluida') === 'atrasada';
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onAbrir}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onAbrir())}
      className="group cursor-pointer overflow-hidden rounded-xl border border-line bg-surface text-left shadow-sm outline-none transition hover:border-line-strong focus-visible:ring-2 focus-visible:ring-brand/40"
    >
      <div className={cx('relative grid place-items-center bg-brand-softer', grade ? 'aspect-[4/3]' : 'aspect-[16/8]')}>
        <Icon name={t.tipo === 'reel' ? 'video' : t.tipo === 'carrossel' ? 'copy' : 'grid'} size={26} className="text-brand opacity-50" />
        <span className="absolute left-2 top-2 rounded-md bg-surface/90 px-1.5 py-0.5 text-[11px] font-semibold text-fg shadow-sm">{TIPO[t.tipo].label}</span>
        {grade && c && <span className="absolute right-2 top-2"><AprovacaoPill aprovacao={c.aprovacao} /></span>}
      </div>
      <div className="p-3">
        <p className="mb-1 flex items-center gap-1.5 text-[11px] text-faint">
          <span className="font-mono">{codigo(t.numero)}</span>
          <span className="truncate">· {t.cliente?.nome ?? 'Interno'}</span>
          {t.comentarios > 0 && (
            <span className="ml-auto inline-flex items-center gap-0.5"><Icon name="chat" size={11} />{t.comentarios}</span>
          )}
        </p>
        <p className="line-clamp-2 text-[13.5px] font-semibold leading-snug text-fg">{t.titulo}</p>
        {c && c.plataformas.length > 0 && <p className="mt-0.5 truncate text-[11.5px] text-muted">{c.plataformas.map((p) => PLATAFORMA[p].label).join(', ')}</p>}
        <div className="mt-2 flex items-center gap-2">
          {c && (c.temLegenda ? (
            <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-success"><Icon name="check" size={12} /> Legenda pronta</span>
          ) : c.exigeLegenda ? (
            <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-warning"><Icon name="alert" size={12} /> Sem legenda</span>
          ) : (
            <span className="text-[11.5px] text-faint">Sem legenda (não exigida)</span>
          ))}
          <span className="ml-auto"><Pessoa pessoa={t.responsavel} /></span>
        </div>
        <dl className="mt-2.5 grid grid-cols-2 gap-2 text-[11.5px]">
          <div className="rounded-lg bg-brand-softer px-2 py-1.5">
            <dt className="flex items-center gap-1 font-semibold text-brand"><Icon name="send" size={11} /> Publicação</dt>
            <dd className="mt-0.5 font-semibold text-fg">
              {c?.publicadoEm ? `Publicado ${rotuloDia(c.publicadoEm)}` : c?.publicarEm ? `${rotuloDia(c.publicarEm)} ${horaLocal(c.publicarEm)}` : '–'}
            </dd>
          </div>
          <div className="rounded-lg border border-line px-2 py-1.5">
            <dt className="flex items-center gap-1 font-semibold text-muted"><Icon name="clock" size={11} /> Prazo</dt>
            <dd className={cx('mt-0.5 font-semibold', atrasada ? 'text-danger' : 'text-fg')}>{t.prazoEm ? rotuloDia(t.prazoEm) : '–'}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
