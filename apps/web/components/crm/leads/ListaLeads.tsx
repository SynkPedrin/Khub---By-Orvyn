'use client';

import { AvatarContato } from '@/components/inbox/AvatarContato';
import { LOGO_FONTE, ROTULO_FONTE } from '@/components/crm/OrigemLead';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from '@/components/icons';
import { Avatar, cx } from '@/components/ui';
import { Button, Confirm, Menu, Modal, PaginacaoCursor, Select, SkeletonRows, Switch, useToast, type MenuEntry } from '@/components/kit';
import { EmptyState, ErrorState } from '@/components/revenue/States';
import { Quando } from '@/components/revenue/Quando';
import { ApiError } from '@/lib/api-error';
import { crm, type Atendente } from '@/lib/crm';
import { funisApi, type FunilConfig } from '@/lib/comercial';
import { customFields, type CampoDef } from '@/lib/custom-fields';
import { moeda, numero } from '@/lib/format';
import {
  COLUNAS, COLUNAS_PADRAO, ORDENS, contarFiltros, contatos,
  type AcaoMassa, type ColunaId, type ContatoLista, type FiltroContatos, type ListaSalva, type OrdemContatos,
} from '@/lib/contatos';
import { TagsEditor, useCatalogoTags } from './TagsEditor';

const CHAVE_COLUNAS = 'khub.leads.colunas';
/** Mesmo teto do backend (`LIMITE_MASSA`). */
const LIMITE_MASSA = 5000;

function lerColunas(): ColunaId[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(CHAVE_COLUNAS) ?? 'null');
    if (Array.isArray(v) && v.every((c) => typeof c === 'string')) return ['nome', ...(v as ColunaId[]).filter((c) => c !== 'nome')];
  } catch { /* preferência local: sem ela, as colunas padrão */ }
  return COLUNAS_PADRAO;
}
function gravarColunas(c: ColunaId[]) {
  try { window.localStorage.setItem(CHAVE_COLUNAS, JSON.stringify(c)); } catch { /* preferência local, best-effort */ }
}

const mensagem = (e: unknown, padrao: string) => (e instanceof ApiError && e.message && !/^Erro \d+$/.test(e.message) ? e.message : padrao);

type ModalAberto = null | 'tag_add' | 'tag_remove' | 'etapa' | 'dono' | 'excluir' | 'salvar' | 'apagar_lista';

/**
 * Lista REAL de Leads (Q2.2): busca, filtros, ordenação, cursor, colunas,
 * listas salvas e ações em massa. Cada linha leva ao perfil 360
 * (`/contatos/[id]`): é lá que o lead real vive.
 */
export function ListaLeads({ versao, vazio }: { versao: number; vazio: ReactNode }) {
  const toast = useToast();
  const [busca, setBusca] = useState('');
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState<FiltroContatos>({});
  const [ordem, setOrdem] = useState<OrdemContatos>('recentes');
  const [colunas, setColunas] = useState<ColunaId[]>(COLUNAS_PADRAO);
  const [painel, setPainel] = useState(false);

  const [pagina, setPagina] = useState<{ items: ContatoLista[]; nextCursor: string | null } | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);
  const [carregandoMais, setCarregandoMais] = useState(false);
  // Paginação por cursor: cada posição guarda o cursor que abre aquela página (a 1ª é null).
  const [cursores, setCursores] = useState<(string | null)[]>([null]);
  const [recarga, setRecarga] = useState(0);

  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [todosDoFiltro, setTodosDoFiltro] = useState(false);
  const [modal, setModal] = useState<ModalAberto>(null);
  const [executando, setExecutando] = useState(false);

  const [listas, setListas] = useState<ListaSalva[]>([]);
  const [listaId, setListaId] = useState('');
  const [funis, setFunis] = useState<FunilConfig[]>([]);
  const [atendentes, setAtendentes] = useState<Atendente[]>([]);
  const [campos, setCampos] = useState<CampoDef[]>([]);
  const catalogo = useCatalogoTags();

  // dados de apoio: cada um falha sozinho (filtro some, a lista continua)
  useEffect(() => {
    setColunas(lerColunas());
    funisApi.listar().then(setFunis).catch(() => setFunis([]));
    crm.atendentes().then(setAtendentes).catch(() => setAtendentes([]));
    // campos personalizados (Q2.3): sem o endpoint (404) ou sem permissão, só os nativos
    customFields.list('contact').then((c) => setCampos(c.filter((x) => !x.arquivado))).catch(() => setCampos([]));
    contatos.listas().then(setListas).catch(() => setListas([]));
  }, []);

  // busca com espera entre teclas
  useEffect(() => {
    const t = window.setTimeout(() => setQ(busca.trim()), 300);
    return () => window.clearTimeout(t);
  }, [busca]);

  const filtroEfetivo = useMemo<FiltroContatos>(() => ({ ...filtro, ...(q ? { q } : {}) }), [filtro, q]);
  const chave = JSON.stringify([filtroEfetivo, ordem]);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    setErro(false);
    setCursores([null]);
    setMarcados(new Set());
    setTodosDoFiltro(false);
    const t = window.setTimeout(() => {
      contatos.listar(filtroEfetivo, { ordem, limit: 50 })
        .then((p) => vivo && setPagina(p))
        .catch(() => vivo && setErro(true))
        .finally(() => vivo && setCarregando(false));
    }, 150);
    return () => { vivo = false; window.clearTimeout(t); };
    // `chave` resume filtro + ordem
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, versao, recarga]);

  const abrirPagina = (cursor: string | null, depois: (p: { items: ContatoLista[]; nextCursor: string | null }) => void) => {
    setCarregandoMais(true);
    contatos.listar(filtroEfetivo, { ordem, limit: 50, ...(cursor ? { cursor } : {}) })
      .then((p) => {
        setPagina(p);
        depois(p);
        // cada página começa do topo: a lista não vira um scroll sem fim
        window.requestAnimationFrame(() => document.getElementById('conteudo')?.scrollTo({ top: 0, behavior: 'smooth' }));
      })
      .catch((e) => toast.error(mensagem(e, 'Não foi possível abrir essa página de leads.')))
      .finally(() => setCarregandoMais(false));
  };
  const irProxima = () => {
    const cursor = pagina?.nextCursor;
    if (cursor) abrirPagina(cursor, () => setCursores((c) => [...c, cursor]));
  };
  const irAnterior = () => {
    if (cursores.length > 1) abrirPagina(cursores[cursores.length - 2], () => setCursores((c) => c.slice(0, -1)));
  };

  const nomeDono = useMemo(() => new Map(atendentes.map((a) => [a.identityId, a.nome])), [atendentes]);
  const etapas = useMemo(() => funis.flatMap((f) => f.etapas.map((e) => ({ value: e.id, label: funis.length > 1 ? `${f.nome} · ${e.nome}` : e.nome }))), [funis]);
  const listaAtiva = listas.find((l) => l.id === listaId) ?? null;
  const nFiltros = contarFiltros(filtro);
  const temRecorte = nFiltros > 0 || !!q;

  const mudarFiltro = <K extends keyof FiltroContatos>(k: K, v: FiltroContatos[K] | '') =>
    setFiltro((f) => {
      const n = { ...f };
      if (v === '' || v === undefined) delete n[k];
      else n[k] = v as FiltroContatos[K];
      return n;
    });
  const limparFiltros = () => { setFiltro({}); setBusca(''); setQ(''); };

  const aplicarLista = (id: string) => {
    setListaId(id);
    const l = listas.find((x) => x.id === id);
    if (!l) { limparFiltros(); setOrdem('recentes'); setColunas(lerColunas()); return; }
    const { q: qLista, ...resto } = l.filtros;
    setFiltro(resto);
    setBusca(qLista ?? '');
    setQ(qLista ?? '');
    setOrdem(l.ordem);
    if (l.colunas.length) setColunas(['nome', ...(l.colunas.filter((c) => c !== 'nome') as ColunaId[])]);
  };

  const alternarColuna = (c: ColunaId) => setColunas((atual) => {
    const n = atual.includes(c) ? atual.filter((x) => x !== c) : [...atual, c];
    const ordenado: ColunaId[] = ['nome', ...COLUNAS.map((x) => x.id).filter((x) => n.includes(x))];
    gravarColunas(ordenado);
    return ordenado;
  });

  // ---------------- seleção
  const itens = pagina?.items ?? [];
  const todosDaPagina = itens.length > 0 && itens.every((c) => marcados.has(c.id));
  const qtdSelecionada = todosDoFiltro ? null : marcados.size;
  const alternar = (id: string) => { setTodosDoFiltro(false); setMarcados((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };
  const alternarPagina = () => { setTodosDoFiltro(false); setMarcados(todosDaPagina ? new Set() : new Set(itens.map((c) => c.id))); };
  const limparSelecao = () => { setMarcados(new Set()); setTodosDoFiltro(false); };
  const rotuloSelecao = todosDoFiltro ? 'todos os leads do filtro' : `${numero(marcados.size)} lead${marcados.size === 1 ? '' : 's'}`;

  const executar = async (acao: AcaoMassa, params: Record<string, unknown> = {}) => {
    setExecutando(true);
    try {
      const alvo = todosDoFiltro ? { filtro: filtroEfetivo } : { ids: [...marcados] };
      const r = await contatos.massa({ ...alvo, acao, params });
      const feito = acao === 'excluir' ? 'excluído(s)' : acao === 'etapa' ? 'movido(s) de etapa' : 'atualizado(s)';
      toast.success(`${numero(r.afetados)} lead(s) ${feito}.`, {
        description: r.ignorados ? `${numero(r.ignorados)} sem mudança${acao === 'etapa' ? ' (sem negócio aberto ou já na etapa)' : ''}.` : undefined,
      });
      setModal(null);
      limparSelecao();
      setRecarga((v) => v + 1);
    } catch (e) {
      toast.error(mensagem(e, 'Não foi possível concluir a ação em massa.'));
    } finally {
      setExecutando(false);
    }
  };

  const acoesNaoPerturbe: MenuEntry[] = [
    { id: 'np-on', label: 'Marcar não perturbe', icon: 'bell', onSelect: () => void executar('nao_perturbe', { ativo: true }) },
    { id: 'np-off', label: 'Desmarcar não perturbe', icon: 'refresh', onSelect: () => void executar('nao_perturbe', { ativo: false }) },
  ];
  const menuColunas: MenuEntry[] = [
    { type: 'label', id: 'l', label: 'Colunas visíveis' },
    ...COLUNAS.map((c): MenuEntry => ({ id: c.id, label: c.label, icon: colunas.includes(c.id) ? 'check' : undefined, onSelect: () => alternarColuna(c.id) })),
  ];

  // ---------------- listas salvas
  const salvarLista = async (dados: { nome: string; compartilhada: boolean; atualizar: boolean }) => {
    setExecutando(true);
    try {
      const corpo = { nome: dados.nome, filtros: filtroEfetivo, colunas: colunas.filter((c) => c !== 'nome'), ordem, compartilhada: dados.compartilhada };
      const v = dados.atualizar && listaAtiva ? await contatos.atualizarLista(listaAtiva.id, corpo) : await contatos.criarLista(corpo);
      setListas((ls) => [...ls.filter((l) => l.id !== v.id), v].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')));
      setListaId(v.id);
      setModal(null);
      toast.success(dados.atualizar ? 'Lista atualizada.' : 'Lista salva.');
    } catch (e) {
      toast.error(mensagem(e, 'Não foi possível salvar a lista.'));
    } finally {
      setExecutando(false);
    }
  };
  const apagarLista = async () => {
    if (!listaAtiva) return;
    setExecutando(true);
    try {
      await contatos.removerLista(listaAtiva.id);
      setListas((ls) => ls.filter((l) => l.id !== listaAtiva.id));
      setListaId('');
      setModal(null);
      toast.success('Lista excluída.');
    } catch (e) {
      toast.error(mensagem(e, 'Não foi possível excluir a lista.'));
    } finally {
      setExecutando(false);
    }
  };

  // ---------------- render
  if (!carregando && !erro && !temRecorte && !listaId && itens.length === 0) return <>{vazio}</>;

  return (
    <div className="space-y-4">
      {/* Barra de ferramentas */}
      <div className="card flex flex-wrap items-center gap-2 p-3">
        <Select
          aria-label="Lista salva"
          className="h-9 w-auto min-w-[180px]"
          value={listaId}
          onChange={aplicarLista}
          placeholder="Todos os leads"
          options={listas.map((l) => ({ value: l.id, label: l.minha ? l.nome : `${l.nome} (equipe)` }))}
        />
        <div className="relative min-w-[200px] flex-1">
          <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            type="search"
            className="input h-9 w-full pl-9"
            placeholder="Buscar por nome, e-mail ou telefone"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            aria-label="Buscar leads"
          />
        </div>
        <Button variant={painel || nFiltros ? 'soft' : 'secondary'} size="sm" icon="filter" onClick={() => setPainel((v) => !v)} aria-expanded={painel}>
          Filtros{nFiltros ? ` (${nFiltros})` : ''}
        </Button>
        <Select aria-label="Ordenar leads" className="h-9 w-auto" value={ordem} onChange={(v) => setOrdem(v as OrdemContatos)} options={ORDENS.map((o) => ({ value: o.value, label: o.label }))} />
        <Menu label="Escolher colunas" items={menuColunas} triggerClassName="btn btn-sm" menuClassName="w-56" trigger={<><Icon name="grid" size={15} /> Colunas</>} />
        <Menu
          label="Listas salvas"
          triggerClassName="btn btn-sm"
          trigger={<><Icon name="star" size={15} /> Salvar lista</>}
          items={[
            { id: 'nova', label: 'Salvar como nova lista', icon: 'plus', onSelect: () => setModal('salvar') },
            ...(listaAtiva?.minha
              ? ([
                  { id: 'atualizar', label: `Atualizar "${listaAtiva.nome}"`, icon: 'refresh', onSelect: () => void salvarLista({ nome: listaAtiva.nome, compartilhada: listaAtiva.compartilhada, atualizar: true }) },
                  { type: 'separator', id: 's' },
                  { id: 'apagar', label: 'Excluir esta lista', icon: 'trash', danger: true, onSelect: () => setModal('apagar_lista') },
                ] as MenuEntry[])
              : []),
          ]}
        />
        <Link href="/leads/duplicados" className="btn btn-sm">
          <Icon name="users" size={15} /> Duplicados
        </Link>
      </div>

      {painel && (
        <PainelFiltros filtro={filtro} mudar={mudarFiltro} setFiltro={setFiltro} limpar={limparFiltros} etapas={etapas} atendentes={atendentes} catalogo={catalogo.map((t) => t.name)} campos={campos} />
      )}

      {/* Ações em massa */}
      {(marcados.size > 0 || todosDoFiltro) && (
        <div className="card flex flex-wrap items-center gap-2 border-brand/40 bg-brand/5 p-3" role="region" aria-label="Ações em massa">
          <p className="mr-2 text-sm font-semibold text-fg">{todosDoFiltro ? 'Todos os leads do filtro selecionados' : `${numero(qtdSelecionada ?? 0)} selecionado(s)`}</p>
          <Button size="sm" icon="tag" onClick={() => setModal('tag_add')} disabled={executando}>Adicionar tag</Button>
          <Button size="sm" icon="minus" onClick={() => setModal('tag_remove')} disabled={executando}>Remover tag</Button>
          <Button size="sm" icon="pipeline" onClick={() => setModal('etapa')} disabled={executando || etapas.length === 0}>Mover etapa</Button>
          <Button size="sm" icon="user" onClick={() => setModal('dono')} disabled={executando}>Atribuir dono</Button>
          <Menu label="Não perturbe" items={acoesNaoPerturbe} triggerClassName="btn btn-sm" disabled={executando} trigger={<><Icon name="bell" size={15} /> Não perturbe</>} />
          <Button size="sm" variant="danger" icon="trash" onClick={() => setModal('excluir')} disabled={executando}>Excluir</Button>
          <Button size="sm" variant="ghost" onClick={limparSelecao} disabled={executando}>Limpar seleção</Button>
        </div>
      )}

      {/* Tabela */}
      <section className="card flex min-w-0 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="t-section">
            {listaAtiva ? listaAtiva.nome : 'Leads'}{' '}
            <span className="font-normal text-muted">({numero(itens.length)}{pagina?.nextCursor ? '+' : ''})</span>
          </h2>
          {temRecorte && <Button size="sm" variant="ghost" onClick={limparFiltros}>Limpar filtros</Button>}
        </div>

        {todosDaPagina && pagina?.nextCursor && !todosDoFiltro && (
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface2 px-4 py-2 text-sm text-muted">
            Os {numero(itens.length)} leads desta página estão selecionados.
            <button type="button" className="font-semibold text-brand hover:underline" onClick={() => setTodosDoFiltro(true)}>
              Selecionar todos os do filtro (até {numero(LIMITE_MASSA)})
            </button>
          </div>
        )}

        {carregando ? (
          <SkeletonRows rows={8} label="Carregando leads" />
        ) : erro ? (
          <ErrorState onRetry={() => setRecarga((v) => v + 1)} />
        ) : itens.length === 0 ? (
          <EmptyState
            icon="search"
            title="Nenhum lead encontrado"
            description="Nada corresponde à busca ou aos filtros. Ajuste o recorte ou limpe os filtros."
            action={<Button size="sm" onClick={limparFiltros}>Limpar filtros</Button>}
          />
        ) : (
          <div className="min-w-0 overflow-x-auto scrollbar-thin">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="w-10">
                    <input type="checkbox" className="checkbox" checked={todosDaPagina} onChange={alternarPagina} aria-label="Selecionar todos os leads desta página" />
                  </th>
                  <th>Nome</th>
                  {colunas.filter((c) => c !== 'nome').map((c) => (
                    <th key={c} className={c === 'valor' ? 'text-right' : undefined}>{COLUNAS.find((x) => x.id === c)?.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {itens.map((c) => (
                  <tr key={c.id} data-selected={marcados.has(c.id) || todosDoFiltro}>
                    <td>
                      <input type="checkbox" className="checkbox" checked={todosDoFiltro || marcados.has(c.id)} onChange={() => alternar(c.id)} aria-label={`Selecionar ${c.nome}`} />
                    </td>
                    <td className="whitespace-nowrap">
                      <Link href={`/contatos/${c.id}`} className="flex items-center gap-2.5 hover:text-brand">
                        <AvatarContato nome={c.nome} fotoUrl={(c as { fotoUrl?: string | null }).fotoUrl} contatoId={c.id} size={30} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-fg">{c.nome}</span>
                          {!colunas.includes('email') && c.email && <span className="block truncate text-xs text-muted">{c.email}</span>}
                        </span>
                      </Link>
                    </td>
                    {colunas.filter((col) => col !== 'nome').map((col) => (
                      <td key={col} className={col === 'valor' ? 'whitespace-nowrap text-right' : 'whitespace-nowrap'}>
                        <Celula c={c} coluna={col} dono={c.ownerId ? nomeDono.get(c.ownerId) ?? 'Membro da equipe' : null} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!carregando && pagina && (
          <PaginacaoCursor pagina={cursores.length} temProxima={!!pagina.nextCursor} carregando={carregandoMais} onAnterior={irAnterior} onProxima={irProxima} mostrando={itens.length} rotulo="leads" />
        )}
      </section>

      {/* Modais */}
      <ModalTag
        open={modal === 'tag_add' || modal === 'tag_remove'}
        remover={modal === 'tag_remove'}
        rotulo={rotuloSelecao}
        catalogo={catalogo}
        carregando={executando}
        onClose={() => setModal(null)}
        onConfirm={(tag) => executar(modal === 'tag_remove' ? 'tag_remove' : 'tag_add', { tag })}
      />
      <ModalEscolha
        open={modal === 'etapa'}
        titulo="Mover etapa"
        descricao={`Move o negócio aberto mais recente de ${rotuloSelecao}. Quem não tem negócio aberto fica como está.`}
        rotuloCampo="Etapa de destino"
        opcoes={etapas}
        carregando={executando}
        onClose={() => setModal(null)}
        onConfirm={(stageId) => executar('etapa', { stageId })}
        confirmar="Mover"
      />
      <ModalEscolha
        open={modal === 'dono'}
        titulo="Atribuir dono"
        descricao={`Define o responsável de ${rotuloSelecao}.`}
        rotuloCampo="Dono"
        opcoes={[{ value: 'nenhum', label: 'Sem dono' }, ...atendentes.map((a) => ({ value: a.identityId, label: a.nome }))]}
        carregando={executando}
        onClose={() => setModal(null)}
        onConfirm={(v) => executar('dono', { ownerId: v === 'nenhum' ? null : v })}
        confirmar="Atribuir"
      />
      <Confirm
        open={modal === 'excluir'}
        onClose={() => setModal(null)}
        onConfirm={() => executar('excluir')}
        loading={executando}
        title={`Excluir ${rotuloSelecao}?`}
        description="Tarefas e notas desses contatos somem junto. Negócios e conversas ficam, sem o vínculo. Não dá para desfazer."
        confirmLabel="Excluir"
        requireText={todosDoFiltro || marcados.size > 20 ? 'EXCLUIR' : undefined}
      />
      <ModalSalvarLista open={modal === 'salvar'} carregando={executando} onClose={() => setModal(null)} onSalvar={(nome, compartilhada) => salvarLista({ nome, compartilhada, atualizar: false })} />
      <Confirm
        open={modal === 'apagar_lista'}
        onClose={() => setModal(null)}
        onConfirm={apagarLista}
        loading={executando}
        title={`Excluir a lista "${listaAtiva?.nome ?? ''}"?`}
        description="Só a lista salva é excluída. Os leads continuam onde estão."
        confirmLabel="Excluir lista"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Celula({ c, coluna, dono }: { c: ContatoLista; coluna: ColunaId; dono: string | null }) {
  const vazio = <span className="text-faint">-</span>;
  switch (coluna) {
    case 'email': return c.email ? <span className="text-sm text-muted">{c.email}</span> : vazio;
    case 'telefone': return c.telefone ? <span className="text-sm tabular text-muted">{c.telefone}</span> : vazio;
    case 'empresa': return c.empresa ? <span className="text-sm text-muted">{c.empresa}</span> : vazio;
    case 'tags': {
      const todas = [...new Set([...(c.tags ?? [])])];
      if (!todas.length) return <span className="pill">{c.tag}</span>;
      return (
        <span className="flex max-w-[260px] flex-wrap gap-1">
          {todas.slice(0, 3).map((t) => <span key={t} className="pill">{t}</span>)}
          {todas.length > 3 && <span className="pill">+{todas.length - 3}</span>}
        </span>
      );
    }
    case 'etapa':
      return c.etapa ? (
        <span className="inline-flex items-center gap-1.5 text-sm text-fg">
          <span className="h-2 w-2 rounded-full" style={{ background: c.etapa.cor }} aria-hidden />
          {c.etapa.nome}
        </span>
      ) : vazio;
    case 'origem': {
      const logo = c.fonte ? LOGO_FONTE[c.fonte] : undefined;
      return c.origem ? (
        <span className="inline-flex items-center gap-1.5 text-sm text-muted" title={c.fonte ? (ROTULO_FONTE[c.fonte] ?? c.fonte) : undefined}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {logo && <img src={logo} alt="" width={16} height={16} className="h-4 w-4 shrink-0 rounded" />}
          <span className="truncate">{c.origem}</span>
        </span>
      ) : vazio;
    }
    case 'dono': return dono ? <span className="inline-flex items-center gap-1.5 text-sm text-fg"><Avatar name={dono} size={22} />{dono.split(' ')[0]}</span> : vazio;
    case 'valor': return c.valor > 0 ? <span className="text-sm font-semibold tabular text-fg">{moeda(c.valor)}</span> : vazio;
    case 'criadoEm': return c.createdAt ? <span className="text-sm text-muted">{new Date(c.createdAt).toLocaleDateString('pt-BR')}</span> : vazio;
    case 'ultimoContato': return c.ultimoContatoAt ? <Quando data={c.ultimoContatoAt} className="text-sm text-muted" /> : vazio;
    case 'naoPerturbe': return c.optedOutAt ? <span className="pill pill-warning">Não perturbe</span> : vazio;
    default: return vazio;
  }
}

/* ------------------------------------------------------------------ */

function PainelFiltros({
  filtro, mudar, setFiltro, limpar, etapas, atendentes, catalogo, campos,
}: {
  filtro: FiltroContatos;
  mudar: <K extends keyof FiltroContatos>(k: K, v: FiltroContatos[K] | '') => void;
  setFiltro: (f: (a: FiltroContatos) => FiltroContatos) => void;
  limpar: () => void;
  etapas: { value: string; label: string }[];
  atendentes: Atendente[];
  catalogo: string[];
  campos: CampoDef[];
}) {
  const [origem, setOrigem] = useState(filtro.origem ?? '');
  const ref = useRef(filtro.origem);
  useEffect(() => { if (filtro.origem !== ref.current) { ref.current = filtro.origem; setOrigem(filtro.origem ?? ''); } }, [filtro.origem]);
  useEffect(() => {
    const t = window.setTimeout(() => { ref.current = origem.trim() || undefined; mudar('origem', origem.trim()); }, 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origem]);

  const setCampo = useCallback((chave: string, valor: string) => setFiltro((f) => {
    const cf = { ...(f.cf ?? {}) };
    if (valor) cf[chave] = valor;
    else delete cf[chave];
    const n: FiltroContatos = { ...f, cf };
    if (!Object.keys(cf).length) delete n.cf;
    return n;
  }), [setFiltro]);

  return (
    <div className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
      <Campo rotulo="Etapa">
        <Select value={filtro.stageId ?? ''} onChange={(v) => mudar('stageId', v)} placeholder="Todas as etapas" options={etapas} />
      </Campo>
      <Campo rotulo="Origem">
        <input className="input" value={origem} onChange={(e) => setOrigem(e.target.value)} placeholder="Ex.: Meta Lead Ads" />
      </Campo>
      <Campo rotulo="Tag">
        <Select value={filtro.tag ?? ''} onChange={(v) => mudar('tag', v)} placeholder="Qualquer tag" options={catalogo.map((t) => ({ value: t, label: t }))} />
      </Campo>
      <Campo rotulo="Dono">
        <Select value={filtro.ownerId ?? ''} onChange={(v) => mudar('ownerId', v)} placeholder="Qualquer dono" options={[{ value: 'nenhum', label: 'Sem dono' }, ...atendentes.map((a) => ({ value: a.identityId, label: a.nome }))]} />
      </Campo>
      <Campo rotulo="Não perturbe">
        <Select value={filtro.naoPerturbe ?? ''} onChange={(v) => mudar('naoPerturbe', v as 'sim' | 'nao' | '')} placeholder="Todos" options={[{ value: 'sim', label: 'Só marcados' }, { value: 'nao', label: 'Só não marcados' }]} />
      </Campo>
      <Campo rotulo="Criado de">
        <input type="date" className="input" value={filtro.criadoDe ?? ''} max={filtro.criadoAte} onChange={(e) => mudar('criadoDe', e.target.value)} />
      </Campo>
      <Campo rotulo="Criado até">
        <input type="date" className="input" value={filtro.criadoAte ?? ''} min={filtro.criadoDe} onChange={(e) => mudar('criadoAte', e.target.value)} />
      </Campo>
      <div className="flex items-end">
        <Button size="sm" variant="ghost" onClick={limpar}>Limpar filtros</Button>
      </div>
      {campos.length > 0 && (
        <div className="sm:col-span-2 lg:col-span-4">
          <FiltrosCampos campos={campos} cf={filtro.cf ?? {}} setCampo={setCampo} />
        </div>
      )}
    </div>
  );
}

/** Filtro por campo personalizado (`cf_<chave>`; faixa com `_min`/`_max` para número, dinheiro e data). */
function FiltrosCampos({ campos, cf, setCampo }: { campos: CampoDef[]; cf: Record<string, string>; setCampo: (chave: string, valor: string) => void }) {
  const ativos = campos.filter((c) => Object.keys(cf).some((k) => k === c.chave || k === `${c.chave}_min` || k === `${c.chave}_max`));
  const [extra, setExtra] = useState<string[]>([]);
  const visiveis = campos.filter((c) => ativos.includes(c) || extra.includes(c.chave));
  const disponiveis = campos.filter((c) => !visiveis.includes(c));

  return (
    <div className="space-y-2 border-t border-line pt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Campos personalizados</p>
      {visiveis.map((c) => {
        const faixa = c.tipo === 'number' || c.tipo === 'money' || c.tipo === 'date';
        const tipoInput = c.tipo === 'date' ? 'date' : faixa ? 'number' : 'text';
        return (
          <div key={c.chave} className="flex flex-wrap items-center gap-2">
            <span className="w-40 truncate text-sm text-fg">{c.rotulo}</span>
            {faixa ? (
              <>
                <input type={tipoInput} className="input h-9 w-40" value={cf[`${c.chave}_min`] ?? ''} onChange={(e) => setCampo(`${c.chave}_min`, e.target.value)} aria-label={`${c.rotulo}: a partir de`} placeholder="A partir de" />
                <input type={tipoInput} className="input h-9 w-40" value={cf[`${c.chave}_max`] ?? ''} onChange={(e) => setCampo(`${c.chave}_max`, e.target.value)} aria-label={`${c.rotulo}: até`} placeholder="Até" />
              </>
            ) : c.tipo === 'boolean' ? (
              <Select className="h-9 w-40" value={cf[c.chave] ?? ''} onChange={(v) => setCampo(c.chave, v)} placeholder="Qualquer" options={[{ value: 'true', label: 'Sim' }, { value: 'false', label: 'Não' }]} aria-label={c.rotulo} />
            ) : c.opcoes.length ? (
              <Select className="h-9 w-56" value={cf[c.chave] ?? ''} onChange={(v) => setCampo(c.chave, v)} placeholder="Qualquer" options={c.opcoes.map((o) => ({ value: o, label: o }))} aria-label={c.rotulo} />
            ) : (
              <input className="input h-9 w-56" value={cf[c.chave] ?? ''} onChange={(e) => setCampo(c.chave, e.target.value)} aria-label={c.rotulo} placeholder="Igual a" />
            )}
            <Button size="sm" variant="ghost" iconOnly icon="close" aria-label={`Remover filtro ${c.rotulo}`} onClick={() => {
              setCampo(c.chave, ''); setCampo(`${c.chave}_min`, ''); setCampo(`${c.chave}_max`, '');
              setExtra((e) => e.filter((x) => x !== c.chave));
            }} />
          </div>
        );
      })}
      {disponiveis.length > 0 && (
        <Select className="h-9 w-56" value="" onChange={(v) => v && setExtra((e) => [...e, v])} placeholder="Adicionar campo ao filtro" options={disponiveis.map((c) => ({ value: c.chave, label: c.rotulo }))} aria-label="Adicionar campo personalizado ao filtro" />
      )}
    </div>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="text-xs font-medium text-muted">{rotulo}</span>
      {children}
    </label>
  );
}

/* ------------------------------------------------------------------ */

function ModalTag({ open, remover, rotulo, catalogo, carregando, onClose, onConfirm }: {
  open: boolean; remover: boolean; rotulo: string; catalogo: ReturnType<typeof useCatalogoTags>; carregando: boolean;
  onClose: () => void; onConfirm: (tag: string) => void;
}) {
  const [tag, setTag] = useState<string[]>([]);
  useEffect(() => { if (open) setTag([]); }, [open]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={remover ? 'Remover tag' : 'Adicionar tag'}
      description={remover ? `Tira a tag de ${rotulo}. Quem não tem a tag fica como está.` : `Aplica a tag em ${rotulo}. Automações com o gatilho "tag adicionada" disparam para quem ainda não tinha.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={carregando}>Cancelar</Button>
          <Button variant="primary" onClick={() => tag[0] && onConfirm(tag[0])} disabled={!tag[0]} loading={carregando}>{remover ? 'Remover' : 'Adicionar'}</Button>
        </>
      }
    >
      <TagsEditor value={tag} onChange={setTag} catalogo={catalogo} unica placeholder="Escolha ou digite a tag" ariaLabel="Tag" />
    </Modal>
  );
}

function ModalEscolha({ open, titulo, descricao, rotuloCampo, opcoes, carregando, onClose, onConfirm, confirmar }: {
  open: boolean; titulo: string; descricao: string; rotuloCampo: string; opcoes: { value: string; label: string }[];
  carregando: boolean; onClose: () => void; onConfirm: (v: string) => void; confirmar: string;
}) {
  const [v, setV] = useState('');
  useEffect(() => { if (open) setV(''); }, [open]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={titulo}
      description={descricao}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={carregando}>Cancelar</Button>
          <Button variant="primary" onClick={() => v && onConfirm(v)} disabled={!v} loading={carregando}>{confirmar}</Button>
        </>
      }
    >
      <Campo rotulo={rotuloCampo}>
        <Select value={v} onChange={setV} placeholder="Selecione" options={opcoes} />
      </Campo>
    </Modal>
  );
}

function ModalSalvarLista({ open, carregando, onClose, onSalvar }: { open: boolean; carregando: boolean; onClose: () => void; onSalvar: (nome: string, compartilhada: boolean) => void }) {
  const [nome, setNome] = useState('');
  const [compartilhada, setCompartilhada] = useState(false);
  useEffect(() => { if (open) { setNome(''); setCompartilhada(false); } }, [open]);
  const ok = nome.trim().length > 0 && nome.trim().length <= 80;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Salvar lista"
      description="Guarda a busca, os filtros, a ordem e as colunas atuais com um nome."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={carregando}>Cancelar</Button>
          <Button variant="primary" onClick={() => ok && onSalvar(nome.trim(), compartilhada)} disabled={!ok} loading={carregando}>Salvar</Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (ok) onSalvar(nome.trim(), compartilhada); }}>
        <Campo rotulo="Nome da lista">
          <input className={cx('input')} value={nome} maxLength={80} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Quentes sem dono" autoFocus />
        </Campo>
        <Switch checked={compartilhada} onChange={setCompartilhada} label="Compartilhar com a equipe" description="Todos da conta veem e usam; só você altera." />
      </form>
    </Modal>
  );
}
