'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, Field, Input, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { Confirm, Select, SkeletonRows } from '@/components/kit';
import { Paginacao, usePaginacao } from '@/components/kit';
import { financeiro, type Categoria, type MembroComissao, type NovaTransacao, type Transacao } from '@/lib/financeiro';
import { ORIGEM_LABEL, dataBR, falhaDeCarga, mensagemFin, money, parseValor, valorParaCampo, type FalhaCarga } from './fin-utils';
import { FinAviso, FinFalha } from './FinEstado';

interface FormLancamento {
  tipo: 'entrada' | 'saida';
  descricao: string;
  valor: string;
  categoriaId: string;
  data: string;
  status: 'pago' | 'pendente';
  responsavelId: string;
  observacao: string;
}

const FORM_VAZIO: FormLancamento = { tipo: 'entrada', descricao: '', valor: '', categoriaId: '', data: '', status: 'pago', responsavelId: '', observacao: '' };

function formDe(t: Transacao): FormLancamento {
  return {
    tipo: t.tipo,
    descricao: t.descricao,
    valor: valorParaCampo(t.valorCentavos),
    categoriaId: t.categoriaId ?? '',
    data: t.dataCompetencia.slice(0, 10),
    status: t.status,
    responsavelId: t.responsavelId ?? '',
    observacao: t.observacao ?? '',
  };
}

/** Só os campos que mudaram (PATCH parcial; o tipo nunca muda). */
function diferencas(t: Transacao, f: FormLancamento, valorCentavos: number): Partial<NovaTransacao> {
  const d: Partial<NovaTransacao> = {};
  if (f.descricao.trim() !== t.descricao) d.descricao = f.descricao.trim();
  if (valorCentavos !== t.valorCentavos) d.valorCentavos = valorCentavos;
  if ((f.categoriaId || null) !== t.categoriaId) d.categoriaId = f.categoriaId || null;
  if (f.data && f.data !== t.dataCompetencia.slice(0, 10)) d.dataCompetencia = f.data;
  if (f.status !== t.status) d.status = f.status;
  if (t.tipo === 'entrada' && (f.responsavelId || null) !== t.responsavelId) d.responsavelId = f.responsavelId || null;
  if ((f.observacao.trim() || null) !== t.observacao) d.observacao = f.observacao.trim() || null;
  return d;
}

/**
 * Entradas e saídas (fluxo de caixa): lista do período com filtro por tipo/
 * status, novo lançamento manual, edição, marcar pago/pendente e excluir.
 * Lançamentos que vieram da agenda, de cobrança, de comissão paga ou de
 * importação aparecem com a origem.
 */
export function FinLancamentos({ de, ate, tick, onMudou }: { de: string; ate: string; tick: number; onMudou: () => void }) {
  const [lista, setLista] = useState<Transacao[] | null>(null);
  const pg = usePaginacao(lista, 25);
  const [falha, setFalha] = useState<FalhaCarga | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [equipe, setEquipe] = useState<MembroComissao[]>([]);
  const [avisoAux, setAvisoAux] = useState<string | null>(null);
  const [filtroTipo, setFiltroTipo] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const [aberto, setAberto] = useState(false);
  const [editando, setEditando] = useState<Transacao | null>(null);
  const [excluir, setExcluir] = useState<Transacao | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState<FormLancamento>(FORM_VAZIO);
  const [tentativa, setTentativa] = useState(0);

  const load = () => setTentativa((t) => t + 1);

  useEffect(() => {
    let vivo = true;
    setLista(null);
    setFalha(null);
    financeiro
      .transacoes({ de, ate, tipo: filtroTipo || undefined, status: filtroStatus || undefined })
      .then((l) => vivo && setLista(l))
      .catch((e) => vivo && setFalha(falhaDeCarga(e, 'os lançamentos')));
    return () => {
      vivo = false;
    };
  }, [de, ate, filtroTipo, filtroStatus, tick, tentativa]);

  useEffect(() => {
    const faltou: string[] = [];
    Promise.all([
      financeiro.categorias().then(setCategorias).catch(() => faltou.push('as categorias')),
      financeiro.equipeComissoes().then(setEquipe).catch(() => faltou.push('a equipe')),
    ]).then(() => setAvisoAux(faltou.length ? `Não consegui carregar ${faltou.join(' e ')}: os campos de categoria e profissional podem ficar incompletos.` : null));
  }, []);

  const categoriasDoTipo = useMemo(() => categorias.filter((c) => c.tipo === form.tipo), [categorias, form.tipo]);
  const nomesEquipe = useMemo(() => new Map(equipe.map((m) => [m.identityId, m.nome])), [equipe]);

  const abrirNovo = () => {
    setEditando(null);
    setForm(FORM_VAZIO);
    setMsg(null);
    setAberto(true);
  };
  const abrirEdicao = (t: Transacao) => {
    setEditando(t);
    setForm(formDe(t));
    setMsg(null);
    setAberto(true);
  };
  const fechar = () => {
    setAberto(false);
    setEditando(null);
  };

  const salvar = async () => {
    const valorCentavos = parseValor(form.valor);
    if (!form.descricao.trim()) { setMsg('Preencha a descrição.'); return; }
    if (valorCentavos <= 0) { setMsg('Informe um valor válido, por exemplo 199,90.'); return; }
    setBusy('salvar'); setMsg(null);
    try {
      if (editando) {
        const patch = diferencas(editando, form, valorCentavos);
        if (Object.keys(patch).length > 0) await financeiro.atualizarTransacao(editando.id, patch);
      } else {
        await financeiro.criarTransacao({
          tipo: form.tipo,
          descricao: form.descricao.trim(),
          valorCentavos,
          categoriaId: form.categoriaId || null,
          dataCompetencia: form.data || null,
          status: form.status,
          responsavelId: form.tipo === 'entrada' ? form.responsavelId || null : null,
          observacao: form.observacao.trim() || null,
        });
      }
      fechar();
      setForm(FORM_VAZIO);
      load(); onMudou();
    } catch (e) { setMsg(mensagemFin(e, 'salvar o lançamento')); } finally { setBusy(null); }
  };

  const marcar = async (t: Transacao, status: 'pago' | 'pendente') => {
    setBusy(t.id); setMsg(null);
    try {
      await financeiro.statusTransacao(t.id, status);
      load(); onMudou();
    } catch (e) { setMsg(mensagemFin(e, 'mudar o status')); } finally { setBusy(null); }
  };

  const confirmarExclusao = async () => {
    if (!excluir) return;
    setBusy('excluir'); setMsg(null);
    try {
      await financeiro.removerTransacao(excluir.id);
      setExcluir(null);
      load(); onMudou();
    } catch (e) {
      setExcluir(null);
      setMsg(mensagemFin(e, 'excluir o lançamento'));
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-40"><Select value={filtroTipo} onChange={setFiltroTipo} options={[{ value: '', label: 'Entradas e saídas' }, { value: 'entrada', label: 'Só entradas' }, { value: 'saida', label: 'Só saídas' }]} aria-label="Filtrar por tipo" /></div>
        <div className="w-40"><Select value={filtroStatus} onChange={setFiltroStatus} options={[{ value: '', label: 'Pagos e pendentes' }, { value: 'pago', label: 'Só pagos' }, { value: 'pendente', label: 'Só pendentes' }]} aria-label="Filtrar por status" /></div>
        <div className="flex-1" />
        <Button onClick={() => (aberto && !editando ? fechar() : abrirNovo())}><Icon name="plus" size={16} /> Novo lançamento</Button>
      </div>

      {avisoAux && <FinAviso texto={avisoAux} />}
      {msg && <FinAviso texto={msg} />}

      {aberto && (
        <Card className="p-6">
          <h2 className="mb-3 font-bold text-fg">{editando ? 'Editar lançamento' : 'Novo lançamento'}</h2>
          {editando ? (
            <p className="mb-3 text-xs text-muted">
              {editando.tipo === 'entrada' ? 'Entrada' : 'Saída'}
              {editando.origem !== 'manual' ? ` gerada por ${ORIGEM_LABEL[editando.origem] ?? editando.origem}` : ''}. O tipo não muda; para trocar, exclua e crie de novo.
            </p>
          ) : (
            <div className="mb-3 flex gap-2">
              {(['entrada', 'saida'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={form.tipo === t}
                  onClick={() => setForm({ ...form, tipo: t, categoriaId: '', responsavelId: t === 'saida' ? '' : form.responsavelId })}
                  className={cx(
                    'rounded-xl border px-4 py-2 text-sm font-semibold',
                    form.tipo === t
                      ? t === 'entrada' ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'border-red-500/50 bg-red-500/10 text-red-500 dark:text-red-400'
                      : 'border-line text-muted hover:text-fg',
                  )}
                >
                  {t === 'entrada' ? 'Entrada' : 'Saída'}
                </button>
              ))}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2"><Field label="Descrição"><Input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder={form.tipo === 'entrada' ? 'Corte + escova, Maria' : 'Aluguel do mês'} maxLength={200} autoFocus /></Field></div>
            <Field label="Valor (R$)"><Input value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} placeholder="199,90" inputMode="decimal" /></Field>
            <Field label="Categoria">
              <Select value={form.categoriaId} onChange={(v) => setForm({ ...form, categoriaId: v })} options={[{ value: '', label: 'Sem categoria' }, ...categoriasDoTipo.map((c) => ({ value: c.id, label: c.nome }))]} />
            </Field>
            <Field label="Data"><Input type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })} /></Field>
            <Field label="Status">
              <Select value={form.status} onChange={(v) => setForm({ ...form, status: v as 'pago' | 'pendente' })} options={[{ value: 'pago', label: form.tipo === 'entrada' ? 'Recebido' : 'Pago' }, { value: 'pendente', label: 'Pendente' }]} />
            </Field>
            {form.tipo === 'entrada' && (
              <Field label="Profissional (gera comissão)" hint="Se tiver % configurada, a comissão entra automática.">
                <Select value={form.responsavelId} onChange={(v) => setForm({ ...form, responsavelId: v })} options={[{ value: '', label: 'Ninguém' }, ...equipe.map((m) => ({ value: m.identityId, label: m.nome }))]} />
              </Field>
            )}
            <Field label="Observação (opcional)"><Input value={form.observacao} onChange={(e) => setForm({ ...form, observacao: e.target.value })} placeholder="Detalhe interno" maxLength={500} /></Field>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" onClick={fechar}>Cancelar</Button>
            <Button onClick={salvar} disabled={busy === 'salvar'}>{busy === 'salvar' ? 'Salvando…' : editando ? 'Salvar alterações' : 'Salvar lançamento'}</Button>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <div className="border-b border-line px-5 py-3"><h2 className="font-bold text-fg">Lançamentos do período</h2></div>
        {falha ? (
          <FinFalha falha={falha} onTentar={load} />
        ) : (
          <div className="divide-y divide-line">
            {pg.fatia?.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-xl', t.tipo === 'entrada' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-red-500/10 text-red-500 dark:text-red-400')}>
                  <Icon name={t.tipo === 'entrada' ? 'trend' : 'finance'} size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-fg">{t.descricao}</p>
                  <p className="text-[11px] text-muted">
                    {dataBR(t.dataCompetencia)}
                    {t.categoria ? ` · ${t.categoria.nome}` : ''}
                    {t.responsavelId ? ` · ${nomesEquipe.get(t.responsavelId) ?? 'equipe'}` : ''}
                    {t.origem !== 'manual' ? ` · ${ORIGEM_LABEL[t.origem] ?? t.origem}` : ''}
                  </p>
                </div>
                <p className={cx('text-sm font-semibold', t.tipo === 'entrada' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400')}>
                  {t.tipo === 'entrada' ? '+' : '−'} {money(t.valorCentavos)}
                </p>
                <Badge tone={t.status === 'pago' ? 'green' : 'amber'}>{t.status === 'pago' ? (t.tipo === 'entrada' ? 'recebido' : 'pago') : 'pendente'}</Badge>
                <div className="flex items-center gap-1.5">
                  {t.status === 'pendente' && (
                    <button onClick={() => marcar(t, 'pago')} disabled={busy === t.id} className="rounded-lg border border-emerald-500/40 px-2.5 py-1 text-[11px] font-semibold text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400">
                      {t.tipo === 'entrada' ? 'Marcar recebido' : 'Marcar pago'}
                    </button>
                  )}
                  {t.status === 'pago' && t.origem === 'manual' && (
                    <button onClick={() => marcar(t, 'pendente')} disabled={busy === t.id} className="rounded-lg px-2 py-1 text-[11px] font-semibold text-muted hover:text-fg">Voltar pendente</button>
                  )}
                  <button onClick={() => abrirEdicao(t)} className="rounded-lg p-1.5 text-muted hover:bg-surface2 hover:text-fg" aria-label={`Editar ${t.descricao}`}><Icon name="edit" size={14} /></button>
                  <button onClick={() => setExcluir(t)} className="rounded-lg p-1.5 text-muted hover:bg-surface2 hover:text-red-500" aria-label={`Excluir ${t.descricao}`}><Icon name="trash" size={14} /></button>
                </div>
              </div>
            ))}
            {lista && lista.length === 0 && <p className="px-5 py-10 text-center text-sm text-muted">Nenhum lançamento no período. Crie o primeiro acima ou importe uma planilha.</p>}
            {!lista && <SkeletonRows rows={4} label="Carregando lançamentos" />}
          </div>
        )}
        {lista && !falha && <Paginacao pagina={pg.pagina} totalPaginas={pg.totalPaginas} total={pg.total} tamanho={pg.tamanho} onPagina={pg.setPagina} onTamanho={pg.setTamanho} rotulo="lançamentos" />}
      </Card>

      <Confirm
        open={!!excluir}
        onClose={() => setExcluir(null)}
        onConfirm={confirmarExclusao}
        loading={busy === 'excluir'}
        title="Excluir lançamento?"
        description={
          excluir
            ? `${excluir.descricao} (${money(excluir.valorCentavos)}) sai do fluxo de caixa.${excluir.tipo === 'entrada' ? ' A comissão prevista ligada a ela também é removida.' : ''}${excluir.origem === 'comissao' ? ' A comissão volta a ficar a pagar.' : ''}`
            : undefined
        }
      />
    </div>
  );
}
