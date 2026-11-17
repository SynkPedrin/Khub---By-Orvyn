'use client';

import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { Button, Modal, SkeletonRows, useToast } from '@/components/kit';
import { Paginacao, usePaginacao } from '@/components/kit';
import { financeiro, type Produto } from '@/lib/financeiro';
import { mensagemFin, money, parseValor, valorParaCampo } from './fin-utils';

type Acao = { tipo: 'novo' } | { tipo: 'editar'; p: Produto } | { tipo: 'entrada'; p: Produto } | { tipo: 'ajuste'; p: Produto };

/**
 * Produtos e estoque (ADR-0051): o que o salão vende no caixa. A venda no
 * caixa baixa o estoque sozinha; aqui entra mercadoria, ajusta a contagem e
 * cadastra/edita preço.
 */
export function FinProdutos() {
  const toast = useToast();
  const [lista, setLista] = useState<Produto[] | null>(null);
  const [busca, setBusca] = useState('');
  const [inativos, setInativos] = useState(false);
  const [acao, setAcao] = useState<Acao | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const recarregar = () => setTentativa((t) => t + 1);

  useEffect(() => {
    let vivo = true;
    setLista(null);
    financeiro.produtos({ limite: 2000, inativos }).then((l) => vivo && setLista(l)).catch(() => vivo && setLista([]));
    return () => {
      vivo = false;
    };
  }, [inativos, tentativa]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (!lista) return null;
    return q ? lista.filter((p) => p.nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q)) : lista;
  }, [lista, busca]);
  const pg = usePaginacao(filtrados, 25);
  const semEstoque = (lista ?? []).filter((p) => p.ativo && p.estoque <= 0).length;
  const baixo = (lista ?? []).filter((p) => p.ativo && p.estoque > 0 && p.estoqueMinimo > 0 && p.estoque <= p.estoqueMinimo).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi rotulo="Produtos" valor={lista ? String(lista.filter((p) => p.ativo).length) : '–'} />
        <Kpi rotulo="Sem estoque" valor={lista ? String(semEstoque) : '–'} tom={semEstoque ? 'text-danger' : undefined} />
        <Kpi rotulo="Estoque baixo" valor={lista ? String(baixo) : '–'} tom={baixo ? 'text-warning' : undefined} />
        <Kpi rotulo="Vendidos (30 dias)" valor={lista ? String(lista.reduce((a, p) => a + p.vendas30d, 0)) : '–'} />
      </div>

      <section className="card overflow-hidden p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
          <label className="relative min-w-[220px] flex-1 sm:max-w-sm">
            <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <input type="search" className="input h-9 pl-8" placeholder="Buscar produto" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar produto" />
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" className="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} /> Mostrar inativos
          </label>
          <Button onClick={() => setAcao({ tipo: 'novo' })} className="ml-auto"><Icon name="plus" size={15} /> Novo produto</Button>
        </div>
        <div className="hidden grid-cols-[minmax(0,1fr)_110px_110px_90px_200px] gap-3 border-b border-line px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-faint md:grid">
          <span>Produto</span><span className="text-right">Preço</span><span className="text-right">Estoque</span><span className="text-right">30 dias</span><span />
        </div>
        <ul className="divide-y divide-line">
          {pg.fatia?.map((p) => (
            <li key={p.id} className={cx('grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 py-2.5 md:grid-cols-[minmax(0,1fr)_110px_110px_90px_200px]', !p.ativo && 'opacity-50')}>
              <div className="min-w-0">
                <p className="truncate font-medium text-fg">{p.nome}</p>
                <p className="text-[11px] text-muted md:hidden">{p.precoCentavos ? money(p.precoCentavos) : 'sem preço'} · estoque {p.estoque}</p>
              </div>
              <span className="hidden text-right tabular md:block">{p.precoCentavos ? money(p.precoCentavos) : <span className="text-faint">–</span>}</span>
              <span className={cx('hidden text-right font-semibold tabular md:block', p.estoque <= 0 ? 'text-danger' : p.estoqueMinimo > 0 && p.estoque <= p.estoqueMinimo ? 'text-warning' : 'text-fg')}>{p.estoque}</span>
              <span className="hidden text-right tabular text-muted md:block">{p.vendas30d}</span>
              <div className="flex justify-end gap-1">
                <button className="rounded-lg border border-line px-2 py-1 text-[11.5px] font-semibold text-fg hover:bg-surface2" onClick={() => setAcao({ tipo: 'entrada', p })}>+ Entrada</button>
                <button className="rounded-lg border border-line px-2 py-1 text-[11.5px] font-semibold text-fg hover:bg-surface2" onClick={() => setAcao({ tipo: 'ajuste', p })}>Contagem</button>
                <button className="rounded-lg p-1.5 text-muted hover:bg-surface2 hover:text-fg" onClick={() => setAcao({ tipo: 'editar', p })} aria-label={`Editar ${p.nome}`}><Icon name="edit" size={14} /></button>
              </div>
            </li>
          ))}
          {filtrados && filtrados.length === 0 && <li className="px-5 py-10 text-center text-sm text-muted">{busca ? 'Nenhum produto com esse nome.' : 'Nenhum produto cadastrado.'}</li>}
          {!filtrados && <li><SkeletonRows rows={6} label="Carregando produtos" /></li>}
        </ul>
        {filtrados && <Paginacao pagina={pg.pagina} totalPaginas={pg.totalPaginas} total={pg.total} tamanho={pg.tamanho} onPagina={pg.setPagina} onTamanho={pg.setTamanho} rotulo="produtos" />}
      </section>

      <AcaoProduto acao={acao} onFechar={() => setAcao(null)} onFeito={(t) => { toast.success(t); setAcao(null); recarregar(); }} />
    </div>
  );
}

function Kpi({ rotulo, valor, tom }: { rotulo: string; valor: string; tom?: string }) {
  return (
    <div className="card px-4 py-3">
      <p className="text-xs text-muted">{rotulo}</p>
      <p className={cx('mt-0.5 text-2xl font-bold tabular', tom ?? 'text-fg')}>{valor}</p>
    </div>
  );
}

function AcaoProduto({ acao, onFechar, onFeito }: { acao: Acao | null; onFechar: () => void; onFeito: (t: string) => void }) {
  const [nome, setNome] = useState('');
  const [preco, setPreco] = useState('');
  const [minimo, setMinimo] = useState('');
  const [ativo, setAtivo] = useState(true);
  const [qtd, setQtd] = useState('');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    setErro(null);
    setQtd('');
    setMotivo('');
    if (acao && acao.tipo !== 'novo') {
      setNome(acao.p.nome);
      setPreco(acao.p.precoCentavos ? valorParaCampo(acao.p.precoCentavos) : '');
      setMinimo(acao.p.estoqueMinimo ? String(acao.p.estoqueMinimo) : '');
      setAtivo(acao.p.ativo);
      if (acao.tipo === 'ajuste') setQtd(String(acao.p.estoque));
    } else {
      setNome('');
      setPreco('');
      setMinimo('');
      setAtivo(true);
    }
  }, [acao]);

  if (!acao) return null;
  const titulo = acao.tipo === 'novo' ? 'Novo produto' : acao.tipo === 'editar' ? `Editar ${acao.p.nome}` : acao.tipo === 'entrada' ? `Entrada: ${acao.p.nome}` : `Contagem: ${acao.p.nome}`;

  const salvar = async () => {
    setErro(null);
    setSalvando(true);
    try {
      if (acao.tipo === 'novo' || acao.tipo === 'editar') {
        if (!nome.trim()) throw new Error('Informe o nome do produto.');
        const dados = { nome: nome.trim(), precoCentavos: preco.trim() ? parseValor(preco) : 0, estoqueMinimo: minimo.trim() ? Number(minimo.replace(',', '.')) || 0 : 0 };
        if (acao.tipo === 'novo') await financeiro.criarProduto(dados);
        else await financeiro.atualizarProduto(acao.p.id, { ...dados, ativo });
        onFeito(acao.tipo === 'novo' ? 'Produto cadastrado' : 'Produto atualizado');
      } else {
        const q = Number(qtd.replace(',', '.'));
        if (!Number.isFinite(q) || q < 0 || (acao.tipo === 'entrada' && q === 0)) throw new Error('Informe uma quantidade válida.');
        await financeiro.movimentarEstoque(acao.p.id, { tipo: acao.tipo, quantidade: q, motivo: motivo.trim() || null });
        onFeito(acao.tipo === 'entrada' ? `Entrada de ${q} registrada` : `Estoque ajustado para ${q}`);
      }
    } catch (e) {
      setErro(e instanceof Error && !(e as { status?: number }).status ? e.message : mensagemFin(e, 'salvar'));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal
      open
      onClose={onFechar}
      title={titulo}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
          <Button onClick={salvar} loading={salvando}>Salvar</Button>
        </>
      }
    >
      <div className="space-y-3">
        {(acao.tipo === 'novo' || acao.tipo === 'editar') && (
          <>
            <label className="block"><span className="mb-1 block text-xs font-medium text-muted">Nome</span><input className="input" value={nome} maxLength={160} onChange={(e) => setNome(e.target.value)} autoFocus /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="mb-1 block text-xs font-medium text-muted">Preço de venda (R$)</span><input className="input" value={preco} onChange={(e) => setPreco(e.target.value)} placeholder="0,00" inputMode="decimal" /></label>
              <label className="block"><span className="mb-1 block text-xs font-medium text-muted">Estoque mínimo</span><input className="input" value={minimo} onChange={(e) => setMinimo(e.target.value)} placeholder="0" inputMode="decimal" /></label>
            </div>
            {acao.tipo === 'editar' && (
              <label className="inline-flex items-center gap-2 text-sm text-muted"><input type="checkbox" className="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Ativo (aparece no caixa)</label>
            )}
          </>
        )}
        {(acao.tipo === 'entrada' || acao.tipo === 'ajuste') && (
          <>
            <p className="text-sm text-muted">Estoque agora: <span className="font-semibold text-fg">{acao.p.estoque}</span></p>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">{acao.tipo === 'entrada' ? 'Quantidade que chegou' : 'Quantidade contada na prateleira'}</span>
              <input className="input h-11 text-lg font-semibold" value={qtd} onChange={(e) => setQtd(e.target.value)} inputMode="decimal" autoFocus />
            </label>
            <label className="block"><span className="mb-1 block text-xs font-medium text-muted">Observação (opcional)</span><input className="input" value={motivo} maxLength={200} onChange={(e) => setMotivo(e.target.value)} placeholder={acao.tipo === 'entrada' ? 'Ex.: nota do fornecedor 123' : 'Ex.: contagem de novembro'} /></label>
          </>
        )}
        {erro && <p className="text-sm font-medium text-danger" role="alert">{erro}</p>}
      </div>
    </Modal>
  );
}
