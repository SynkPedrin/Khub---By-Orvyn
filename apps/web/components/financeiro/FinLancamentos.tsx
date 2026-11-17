'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { Button, Modal, Select, SkeletonRows, Textarea, useToast } from '@/components/kit';
import { Paginacao, usePaginacao } from '@/components/kit';
import {
  FORMAS,
  ROTULO_FORMA,
  financeiro,
  pedeSenha,
  type Categoria,
  type Colaborador,
  type FormaPagamento,
  type NovaTransacao,
  type Produto,
  type Transacao,
} from '@/lib/financeiro';
import { ORIGEM_LABEL, dataBR, falhaDeCarga, mensagemFin, money, parseValor, valorParaCampo, type FalhaCarga } from './fin-utils';
import { FinAviso, FinFalha } from './FinEstado';
import { useSenhaFinanceiro } from './SenhaFinanceiro';

/** Categoria em que se informa QUAL produto/item foi vendido (autocompletar do estoque). */
const ehDeProduto = (c: Categoria | undefined) => !!c && /produt|outr/i.test(c.nome);

const hojeLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

interface Form {
  tipo: 'entrada' | 'saida';
  categoriaId: string;
  produto: Produto | null;
  produtoTexto: string;
  quantidade: number;
  descricao: string;
  valor: string;
  forma: FormaPagamento | '';
  parcelas: number;
  profissionalId: string;
  data: string;
  pendente: boolean;
}

const vazio = (tipo: 'entrada' | 'saida' = 'entrada'): Form => ({
  tipo,
  categoriaId: '',
  produto: null,
  produtoTexto: '',
  quantidade: 1,
  descricao: '',
  valor: '',
  forma: '',
  parcelas: 1,
  profissionalId: '',
  data: hojeLocal(),
  pendente: false,
});

/**
 * Caixa da recepção (ADR-0051): registrar venda/saída em poucos toques, com
 * forma de pagamento (crédito com parcelas), produto do estoque com
 * autocompletar e a colaboradora que gera comissão. Editar, cancelar e
 * desfazer recebimento pedem a senha do financeiro.
 */
export function FinLancamentos({ de, ate, tick, onMudou }: { de: string; ate: string; tick: number; onMudou: () => void }) {
  const toast = useToast();
  const senha = useSenhaFinanceiro();
  const [lista, setLista] = useState<Transacao[] | null>(null);
  const [hoje, setHoje] = useState<Transacao[] | null>(null);
  const pg = usePaginacao(lista, 25);
  const [falha, setFalha] = useState<FalhaCarga | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [colaboradores, setColaboradores] = useState<Colaborador[]>([]);
  const [filtroTipo, setFiltroTipo] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const [form, setForm] = useState<Form>(vazio());
  const [editando, setEditando] = useState<Transacao | null>(null);
  const [cancelar, setCancelar] = useState<Transacao | null>(null);
  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const recarregar = () => setTentativa((t) => t + 1);

  useEffect(() => {
    let vivo = true;
    setLista(null);
    setFalha(null);
    financeiro
      .transacoes({ de, ate, tipo: filtroTipo || undefined, status: filtroStatus || undefined })
      .then((l) => vivo && setLista(l))
      .catch((e) => vivo && setFalha(falhaDeCarga(e, 'os lançamentos')));
    financeiro.transacoes({ de: hojeLocal(), ate: hojeLocal() }).then((l) => vivo && setHoje(l)).catch(() => vivo && setHoje([]));
    return () => {
      vivo = false;
    };
  }, [de, ate, filtroTipo, filtroStatus, tick, tentativa]);

  useEffect(() => {
    financeiro.categorias().then(setCategorias).catch(() => setCategorias([]));
    financeiro.colaboradores(true).then(setColaboradores).catch(() => setColaboradores([]));
  }, []);

  const categoriasDoTipo = useMemo(() => categorias.filter((c) => c.tipo === form.tipo), [categorias, form.tipo]);
  const categoria = categorias.find((c) => c.id === form.categoriaId);
  const comProduto = ehDeProduto(categoria);

  // Categoria padrão do tipo (Serviços para venda), para a recepção já começar digitando o valor.
  useEffect(() => {
    if (form.categoriaId || !categoriasDoTipo.length || editando) return;
    const padrao = categoriasDoTipo.find((c) => /servi/i.test(c.nome)) ?? categoriasDoTipo[0];
    setForm((f) => ({ ...f, categoriaId: padrao.id }));
  }, [categoriasDoTipo, form.categoriaId, editando]);

  const valorCentavos = parseValor(form.valor);

  const escolherProduto = (p: Produto | null, texto: string) => {
    setForm((f) => ({
      ...f,
      produto: p,
      produtoTexto: texto,
      valor: p && p.precoCentavos > 0 ? valorParaCampo(Math.round(p.precoCentavos * f.quantidade)) : f.valor,
    }));
  };
  const mudarQuantidade = (q: number) => {
    const quantidade = Math.max(1, Math.min(999, q));
    setForm((f) => ({ ...f, quantidade, valor: f.produto && f.produto.precoCentavos > 0 ? valorParaCampo(Math.round(f.produto.precoCentavos * quantidade)) : f.valor }));
  };

  const descricaoFinal = () => {
    if (comProduto) {
      const nome = form.produto?.nome ?? form.produtoTexto.trim();
      if (nome) return `${form.quantidade > 1 ? `${form.quantidade}x ` : ''}${nome}`;
    }
    return form.descricao.trim() || categoria?.nome || (form.tipo === 'entrada' ? 'Venda' : 'Saída');
  };

  const registrar = async () => {
    setMsg(null);
    if (valorCentavos <= 0) { setMsg('Informe o valor, por exemplo 45,00.'); return; }
    if (comProduto && !form.produto && !form.produtoTexto.trim()) { setMsg('Diga qual produto ou item foi vendido.'); return; }
    if (form.tipo === 'entrada' && !form.forma && !form.pendente) { setMsg('Escolha a forma de pagamento.'); return; }
    const dados: NovaTransacao = {
      tipo: form.tipo,
      descricao: descricaoFinal().slice(0, 200),
      valorCentavos,
      categoriaId: form.categoriaId || null,
      dataCompetencia: form.data || null,
      status: form.pendente ? 'pendente' : 'pago',
      formaPagamento: form.forma || null,
      parcelas: form.forma === 'credito' ? form.parcelas : null,
      produtoId: comProduto ? form.produto?.id ?? null : null,
      quantidade: comProduto && form.produto ? form.quantidade : null,
      profissionalId: form.tipo === 'entrada' ? form.profissionalId || null : null,
    };
    setBusy('salvar');
    try {
      if (editando) {
        if (!(await senha.garantir('Para editar uma venda, digite a senha do financeiro.'))) return;
        const { tipo: _t, ...patch } = dados;
        await financeiro.atualizarTransacao(editando.id, patch);
        toast.success('Lançamento atualizado');
        setEditando(null);
      } else {
        await financeiro.criarTransacao(dados);
        toast.success(form.tipo === 'entrada' ? `Venda registrada: ${money(valorCentavos)}` : `Saída registrada: ${money(valorCentavos)}`);
      }
      setForm(vazio(form.tipo));
      recarregar();
      onMudou();
    } catch (e) {
      setMsg(pedeSenha(e) ? 'Senha do financeiro necessária.' : mensagemFin(e, 'registrar'));
    } finally {
      setBusy(null);
    }
  };

  const editar = async (t: Transacao) => {
    if (!(await senha.garantir('Para editar uma venda, digite a senha do financeiro.'))) return;
    setEditando(t);
    setForm({
      tipo: t.tipo,
      categoriaId: t.categoriaId ?? '',
      produto: t.produtoId ? { id: t.produtoId, nome: t.produtoNome ?? t.descricao, categoria: null, precoCentavos: 0, custoCentavos: 0, estoque: 0, estoqueMinimo: 0, ativo: true, vendas30d: 0 } : null,
      produtoTexto: t.produtoNome ?? '',
      quantidade: t.quantidade ?? 1,
      descricao: t.descricao,
      valor: valorParaCampo(t.valorCentavos),
      forma: t.formaPagamento ?? '',
      parcelas: t.parcelas ?? 1,
      profissionalId: t.profissionalId ?? '',
      data: t.dataCompetencia.slice(0, 10),
      pendente: t.status === 'pendente',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const pedirCancelamento = async (t: Transacao) => {
    if (!(await senha.garantir('Para cancelar uma venda, digite a senha do financeiro.'))) return;
    setMotivo('');
    setCancelar(t);
  };

  const confirmarCancelamento = async () => {
    if (!cancelar) return;
    setBusy('cancelar');
    try {
      await financeiro.cancelarTransacao(cancelar.id, motivo.trim() || null);
      toast.success('Venda cancelada', { description: 'Saiu dos totais; o estoque e a comissão foram desfeitos.' });
      setCancelar(null);
      recarregar();
      onMudou();
    } catch (e) {
      setMsg(mensagemFin(e, 'cancelar'));
      setCancelar(null);
    } finally {
      setBusy(null);
    }
  };

  const receber = async (t: Transacao) => {
    setBusy(t.id);
    try {
      await financeiro.statusTransacao(t.id, 'pago');
      recarregar();
      onMudou();
    } catch (e) {
      setMsg(mensagemFin(e, 'marcar como recebido'));
    } finally {
      setBusy(null);
    }
  };

  const doDia = useMemo(() => {
    const pagos = (hoje ?? []).filter((t) => t.status === 'pago');
    const ent = pagos.filter((t) => t.tipo === 'entrada');
    const porForma = new Map<string, number>();
    for (const t of ent) porForma.set(t.formaPagamento ?? 'nao_informada', (porForma.get(t.formaPagamento ?? 'nao_informada') ?? 0) + t.valorCentavos);
    return {
      vendas: ent.length,
      entradas: ent.reduce((a, t) => a + t.valorCentavos, 0),
      saidas: pagos.filter((t) => t.tipo === 'saida').reduce((a, t) => a + t.valorCentavos, 0),
      porForma: [...porForma.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [hoje]);

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[440px_minmax(0,1fr)]">
      {/* ------------------------- lançamento ------------------------- */}
      <section className="card space-y-4 p-5 xl:sticky xl:top-4" aria-label="Registrar no caixa">
        <div className="flex items-center justify-between gap-2">
          <h2 className="t-title">{editando ? 'Editar lançamento' : form.tipo === 'entrada' ? 'Nova venda' : 'Nova saída'}</h2>
          {editando && (
            <button type="button" className="text-xs font-medium text-muted hover:text-fg" onClick={() => { setEditando(null); setForm(vazio(form.tipo)); }}>
              Cancelar edição
            </button>
          )}
        </div>

        {!editando && (
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo">
            {(['entrada', 'saida'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={form.tipo === t}
                onClick={() => setForm(vazio(t))}
                className={cx(
                  'flex h-11 items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition',
                  form.tipo === t
                    ? t === 'entrada' ? 'border-success-border bg-success-soft text-success' : 'border-danger-border bg-danger-soft text-danger'
                    : 'border-line text-muted hover:text-fg',
                )}
              >
                <Icon name={t === 'entrada' ? 'trend' : 'finance'} size={16} /> {t === 'entrada' ? 'Entrada (venda)' : 'Saída'}
              </button>
            ))}
          </div>
        )}

        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">Categoria</p>
          <div className="flex flex-wrap gap-1.5">
            {categoriasDoTipo.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={form.categoriaId === c.id}
                onClick={() => setForm((f) => ({ ...f, categoriaId: c.id, produto: ehDeProduto(c) ? f.produto : null }))}
                className={cx('h-8 rounded-full border px-3 text-[13px] font-medium transition', form.categoriaId === c.id ? 'border-brand-border bg-brand-soft text-brand' : 'border-line text-muted hover:text-fg')}
              >
                {c.nome}
              </button>
            ))}
          </div>
        </div>

        {comProduto ? (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <BuscaProduto valor={form.produto} texto={form.produtoTexto} onEscolher={escolherProduto} />
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted">Qtd.</p>
              <div className="flex h-11 items-center rounded-xl border border-line">
                <button type="button" className="h-full w-9 text-lg text-muted hover:text-fg" onClick={() => mudarQuantidade(form.quantidade - 1)} aria-label="Menos um">−</button>
                <span className="w-8 text-center font-semibold tabular">{form.quantidade}</span>
                <button type="button" className="h-full w-9 text-lg text-muted hover:text-fg" onClick={() => mudarQuantidade(form.quantidade + 1)} aria-label="Mais um">+</button>
              </div>
            </div>
          </div>
        ) : (
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted">Descrição</span>
            <input className="input h-11" value={form.descricao} maxLength={200} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder={form.tipo === 'entrada' ? 'Ex.: Escova, Maria' : 'Ex.: Aluguel de novembro'} />
          </label>
        )}

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-muted">Valor</span>
          <div className="relative">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg font-semibold text-muted">R$</span>
            <input
              className="input h-14 pl-12 text-2xl font-bold tabular"
              value={form.valor}
              onChange={(e) => setForm({ ...form, valor: e.target.value })}
              placeholder="0,00"
              inputMode="decimal"
              aria-label="Valor em reais"
            />
          </div>
        </label>

        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">Forma de pagamento</p>
          <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Forma de pagamento">
            {FORMAS.map((f) => (
              <button
                key={f.valor}
                type="button"
                role="radio"
                aria-checked={form.forma === f.valor}
                onClick={() => setForm({ ...form, forma: form.forma === f.valor ? '' : f.valor })}
                className={cx(
                  'inline-flex h-11 items-center justify-center gap-1 rounded-xl border text-sm font-semibold transition',
                  form.forma === f.valor ? 'border-brand bg-brand-soft font-bold text-brand shadow-[inset_0_0_0_1px_var(--brand)]' : 'border-line text-fg hover:bg-surface2',
                )}
              >
                {form.forma === f.valor && <Icon name="check" size={14} />}
                {f.rotulo}
              </button>
            ))}
          </div>
          {form.forma === 'credito' && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-muted">Parcelas</span>
              <div className="w-36">
                <Select
                  size="sm"
                  value={String(form.parcelas)}
                  onChange={(v) => setForm({ ...form, parcelas: Number(v) })}
                  options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: i === 0 ? 'À vista (1x)' : `${i + 1}x` }))}
                  aria-label="Parcelas"
                />
              </div>
              {form.parcelas > 1 && valorCentavos > 0 && <span className="text-xs text-muted">{form.parcelas}x de {money(Math.round(valorCentavos / form.parcelas))}</span>}
            </div>
          )}
        </div>

        {form.tipo === 'entrada' && (
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted">Profissional (comissão)</span>
            {colaboradores.length ? (
              <Select
                value={form.profissionalId}
                onChange={(v) => setForm({ ...form, profissionalId: v })}
                placeholder="Nenhuma"
                options={colaboradores.map((c) => ({ value: c.id, label: `${c.nome} · ${String(c.comissaoPercent).replace('.', ',')}%` }))}
              />
            ) : (
              <p className="rounded-xl border border-dashed border-line px-3 py-2 text-xs text-muted">Nenhuma colaboradora com comissão configurada. Configure o % em Comissões.</p>
            )}
          </label>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <label className="inline-flex items-center gap-2 text-muted">
            <Icon name="calendar" size={14} />
            <input type="date" className="input h-9 w-[150px]" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} aria-label="Data" />
          </label>
          <label className="inline-flex items-center gap-2 text-muted">
            <input type="checkbox" className="checkbox" checked={form.pendente} onChange={(e) => setForm({ ...form, pendente: e.target.checked })} />
            {form.tipo === 'entrada' ? 'Ainda não recebido' : 'Ainda não pago'}
          </label>
        </div>

        {msg && <FinAviso texto={msg} />}

        <Button onClick={registrar} loading={busy === 'salvar'} className="h-12 w-full text-base">
          <Icon name="check" size={17} /> {editando ? 'Salvar alterações' : form.tipo === 'entrada' ? `Registrar venda${valorCentavos > 0 ? ` · ${money(valorCentavos)}` : ''}` : `Registrar saída${valorCentavos > 0 ? ` · ${money(valorCentavos)}` : ''}`}
        </Button>
      </section>

      {/* ------------------------- movimento ------------------------- */}
      <div className="min-w-0 space-y-4">
        <section className="card p-5" aria-label="Movimento de hoje">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="t-title">Hoje</h2>
            <span className="text-xs text-muted">{new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}</span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Resumo rotulo="Vendas" valor={String(doDia.vendas)} />
            <Resumo rotulo="Entrou" valor={money(doDia.entradas)} tom="text-success" />
            <Resumo rotulo="Saiu" valor={money(doDia.saidas)} tom="text-danger" />
          </div>
          {doDia.porForma.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {doDia.porForma.map(([f, v]) => (
                <span key={f} className="inline-flex items-center gap-1.5 rounded-full bg-surface2 px-3 py-1 text-xs">
                  <span className="font-semibold text-fg">{ROTULO_FORMA[f] ?? f}</span>
                  <span className="tabular text-muted">{money(v)}</span>
                </span>
              ))}
            </div>
          )}
        </section>

        <section className="card overflow-hidden p-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
            <h2 className="mr-auto font-bold text-fg">Lançamentos do período</h2>
            <div className="w-40"><Select size="sm" value={filtroTipo} onChange={setFiltroTipo} options={[{ value: '', label: 'Entradas e saídas' }, { value: 'entrada', label: 'Só entradas' }, { value: 'saida', label: 'Só saídas' }]} aria-label="Filtrar por tipo" /></div>
            <div className="w-40"><Select size="sm" value={filtroStatus} onChange={setFiltroStatus} options={[{ value: '', label: 'Todos' }, { value: 'pago', label: 'Recebidos/pagos' }, { value: 'pendente', label: 'Pendentes' }, { value: 'cancelada', label: 'Cancelados' }]} aria-label="Filtrar por status" /></div>
          </div>
          {falha ? (
            <FinFalha falha={falha} onTentar={recarregar} />
          ) : (
            <ul className="divide-y divide-line">
              {pg.fatia?.map((t) => (
                <Linha key={t.id} t={t} busy={busy === t.id} onEditar={() => editar(t)} onCancelar={() => pedirCancelamento(t)} onReceber={() => receber(t)} />
              ))}
              {lista && lista.length === 0 && <li className="px-5 py-10 text-center text-sm text-muted">Nenhum lançamento no período.</li>}
              {!lista && <li><SkeletonRows rows={5} label="Carregando lançamentos" /></li>}
            </ul>
          )}
          {lista && !falha && <Paginacao pagina={pg.pagina} totalPaginas={pg.totalPaginas} total={pg.total} tamanho={pg.tamanho} onPagina={pg.setPagina} onTamanho={pg.setTamanho} rotulo="lançamentos" />}
        </section>
      </div>

      <Modal
        open={!!cancelar}
        onClose={() => setCancelar(null)}
        title="Cancelar este lançamento?"
        size="sm"
        description={cancelar ? `${cancelar.descricao} · ${money(cancelar.valorCentavos)}. Ele continua no histórico como cancelado, sai dos totais, devolve o produto ao estoque e remove a comissão.` : undefined}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelar(null)}>Voltar</Button>
            <Button variant="danger" onClick={confirmarCancelamento} loading={busy === 'cancelar'}>Cancelar lançamento</Button>
          </>
        }
      >
        <Textarea rows={2} maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (opcional): ex.: cliente desistiu, valor errado" aria-label="Motivo do cancelamento" />
      </Modal>
    </div>
  );
}

function Resumo({ rotulo, valor, tom }: { rotulo: string; valor: string; tom?: string }) {
  return (
    <div className="rounded-xl bg-surface2 px-3 py-2.5">
      <p className="text-xs text-muted">{rotulo}</p>
      <p className={cx('mt-0.5 truncate text-lg font-bold tabular', tom ?? 'text-fg')}>{valor}</p>
    </div>
  );
}

function Linha({ t, busy, onEditar, onCancelar, onReceber }: { t: Transacao; busy: boolean; onEditar: () => void; onCancelar: () => void; onReceber: () => void }) {
  const cancelada = t.status === 'cancelada';
  const entrada = t.tipo === 'entrada';
  return (
    <li className={cx('flex flex-wrap items-center gap-3 px-5 py-3', cancelada && 'opacity-60')}>
      <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', entrada ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger')}>
        <Icon name={entrada ? 'trend' : 'finance'} size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cx('truncate font-semibold text-fg', cancelada && 'line-through')}>{t.descricao}</p>
        <p className="truncate text-[11.5px] text-muted">
          {dataBR(t.dataCompetencia)}
          {t.categoria ? ` · ${t.categoria.nome}` : ''}
          {t.profissionalNome ? ` · ${t.profissionalNome}` : ''}
          {t.origem !== 'manual' ? ` · ${ORIGEM_LABEL[t.origem] ?? t.origem}` : ''}
          {cancelada && t.motivoCancelamento ? ` · motivo: ${t.motivoCancelamento}` : ''}
        </p>
      </div>
      {t.formaPagamento && (
        <span className="rounded-full bg-surface2 px-2.5 py-0.5 text-[11.5px] font-semibold text-fg">
          {ROTULO_FORMA[t.formaPagamento]}
          {t.formaPagamento === 'credito' && t.parcelas && t.parcelas > 1 ? ` ${t.parcelas}x` : ''}
        </span>
      )}
      <p className={cx('w-28 text-right text-sm font-bold tabular', entrada ? 'text-success' : 'text-danger', cancelada && 'line-through')}>
        {entrada ? '+' : '−'} {money(t.valorCentavos)}
      </p>
      <span className={cx('w-24 text-center text-[11px] font-semibold', cancelada ? 'text-danger' : t.status === 'pendente' ? 'text-warning' : 'text-muted')}>
        {cancelada ? 'cancelado' : t.status === 'pendente' ? 'pendente' : entrada ? 'recebido' : 'pago'}
      </span>
      <div className="flex w-[104px] items-center justify-end gap-1">
        {t.status === 'pendente' && (
          <button onClick={onReceber} disabled={busy} className="rounded-lg border border-success-border px-2 py-1 text-[11px] font-semibold text-success hover:bg-success-soft">
            {entrada ? 'Receber' : 'Pagar'}
          </button>
        )}
        {!cancelada && t.origem !== 'comissao' && (
          <>
            <button onClick={onEditar} className="rounded-lg p-1.5 text-muted hover:bg-surface2 hover:text-fg" aria-label={`Editar ${t.descricao}`}><Icon name="edit" size={14} /></button>
            <button onClick={onCancelar} className="rounded-lg p-1.5 text-muted hover:bg-surface2 hover:text-danger" aria-label={`Cancelar ${t.descricao}`}><Icon name="close" size={14} /></button>
          </>
        )}
      </div>
    </li>
  );
}

/**
 * Produto com autocompletar: vai sugerindo conforme digita (estoque do
 * salão). Escolher preenche o preço; texto livre também vale (item fora do
 * cadastro).
 */
function BuscaProduto({ valor, texto, onEscolher }: { valor: Produto | null; texto: string; onEscolher: (p: Produto | null, texto: string) => void }) {
  const [sugestoes, setSugestoes] = useState<Produto[]>([]);
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buscar = useCallback((q: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      financeiro.produtos({ q, limite: 8 }).then((l) => { setSugestoes(l); setAtivo(0); }).catch(() => setSugestoes([]));
    }, 180);
  }, []);

  const teclas = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!aberto || !sugestoes.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setAtivo((a) => Math.min(a + 1, sugestoes.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setAtivo((a) => Math.max(a - 1, 0)); }
    if (e.key === 'Enter') { e.preventDefault(); const p = sugestoes[ativo]; if (p) { onEscolher(p, p.nome); setAberto(false); } }
    if (e.key === 'Escape') setAberto(false);
  };

  return (
    <div className="relative">
      <p className="mb-1.5 text-xs font-medium text-muted">Produto / item</p>
      <input
        className="input h-11"
        value={texto}
        onChange={(e) => { onEscolher(null, e.target.value); setAberto(true); buscar(e.target.value); }}
        onFocus={() => { setAberto(true); buscar(texto); }}
        onBlur={() => setTimeout(() => setAberto(false), 150)}
        onKeyDown={teclas}
        placeholder="Digite: pão de mel, shampoo…"
        aria-label="Produto ou item"
        role="combobox"
        aria-expanded={aberto}
        aria-autocomplete="list"
        aria-controls="produtos-sugestoes"
      />
      {valor && <span className="absolute right-3 top-[38px] text-[11px] font-semibold text-success">do estoque</span>}
      {aberto && sugestoes.length > 0 && (
        <ul id="produtos-sugestoes" role="listbox" className="lg-popover absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-line bg-surface p-1 shadow-lg">
          {sugestoes.map((p, i) => (
            <li
              key={p.id}
              role="option"
              aria-selected={i === ativo}
              onMouseDown={(e) => { e.preventDefault(); onEscolher(p, p.nome); setAberto(false); }}
              onMouseEnter={() => setAtivo(i)}
              className={cx('flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm', i === ativo ? 'bg-brand-softer' : '')}
            >
              <span className="min-w-0 flex-1 truncate font-medium text-fg">{p.nome}</span>
              <span className={cx('text-[11px] tabular', p.estoque <= 0 ? 'text-danger' : 'text-muted')}>{p.estoque <= 0 ? 'sem estoque' : `${p.estoque} em estoque`}</span>
              {p.precoCentavos > 0 && <span className="font-semibold tabular text-fg">{money(p.precoCentavos)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
