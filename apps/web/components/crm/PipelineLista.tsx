'use client';

import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { Button, Confirm, Menu, useToast, type MenuEntry } from '@/components/kit';
import { Quando } from '@/components/revenue/Quando';
import { moeda } from '@/lib/format';
import {
  LIMITE_MASSA, linhasDoQuadro, mensagemDeErro, ordenarLinhas, pipelineApi,
  type AcaoMassa, type ColunaOrdem, type DadosPerda, type Ordem, type Quadro,
} from '@/lib/pipeline';
import { MotivoPerdaModal } from './MotivoPerdaModal';
import type { Dono } from './PipelineFiltros';

interface Props {
  quadro: Quadro;
  donos: Dono[];
  /** Etapas do funil em exibição (destino de "Mover para"). */
  etapas: { id: string; nome: string; cor: string }[];
  onAbrir: (dealId: string) => void;
  onAlterado: () => void;
}

const COLUNAS: { key: ColunaOrdem; label: string; num?: boolean }[] = [
  { key: 'titulo', label: 'Título' },
  { key: 'contato', label: 'Contato' },
  { key: 'etapa', label: 'Etapa' },
  { key: 'valor', label: 'Valor', num: true },
  { key: 'dono', label: 'Dono' },
  { key: 'origem', label: 'Origem' },
  { key: 'criado', label: 'Criado' },
  { key: 'ultimoContato', label: 'Último contato' },
];

const STATUS_PILL: Record<string, { label: string; cls: string }> = {
  ganho: { label: 'Ganho', cls: 'pill-success' },
  perdido: { label: 'Perdido', cls: 'pill-danger' },
};

/**
 * Visão Lista do Pipeline (Q2.1): tabela ordenável com seleção múltipla e
 * ações em massa (`POST /crm/deals/bulk`, até 1.000 por vez, auditado).
 */
export function PipelineLista({ quadro, donos, etapas, onAbrir, onAlterado }: Props) {
  const toast = useToast();
  const [ordem, setOrdem] = useState<Ordem>({ coluna: 'criado', dir: 'desc' });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [perdendo, setPerdendo] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const nomeDono = useMemo(() => {
    const m = new Map(donos.map((d) => [d.identityId, d.nome]));
    return (id: string | null) => (id ? m.get(id) ?? 'Ex-membro' : '');
  }, [donos]);
  const linhas = useMemo(() => ordenarLinhas(linhasDoQuadro(quadro, nomeDono), ordem), [quadro, nomeDono, ordem]);

  // seleção só guarda o que ainda está na tela (filtro mudou, negócio saiu)
  useEffect(() => {
    setSel((atual) => {
      const vis = new Set(linhas.map((l) => l.id));
      const prox = new Set([...atual].filter((id) => vis.has(id)));
      return prox.size === atual.size ? atual : prox;
    });
  }, [linhas]);

  const todos = linhas.length > 0 && sel.size === linhas.length;
  const alguns = sel.size > 0 && !todos;
  const excede = sel.size > LIMITE_MASSA;
  const qtd = `${sel.size} ${sel.size === 1 ? 'negócio' : 'negócios'}`;

  const ordenar = (c: ColunaOrdem) =>
    setOrdem((o) => (o.coluna === c ? { coluna: c, dir: o.dir === 'asc' ? 'desc' : 'asc' } : { coluna: c, dir: c === 'valor' || c === 'criado' || c === 'ultimoContato' ? 'desc' : 'asc' }));

  const executar = async (acao: AcaoMassa, params: Record<string, unknown>, ok: (afetados: number) => string) => {
    setOcupado(true);
    try {
      const r = await pipelineApi.bulk([...sel], acao, params);
      toast.success(ok(r.afetados), r.ignorados ? { description: `${r.ignorados} já ${r.ignorados === 1 ? 'estava' : 'estavam'} assim.` } : undefined);
      setSel(new Set());
      onAlterado();
    } catch (e) {
      toast.error('Não foi possível aplicar a ação.', { description: mensagemDeErro(e) });
      throw e;
    } finally {
      setOcupado(false);
    }
  };
  const n = (k: number, um: string, varios: string) => `${k} ${k === 1 ? um : varios}`;

  const moverItens: MenuEntry[] = [
    { type: 'label', id: 'r', label: 'Mover para' },
    ...etapas.map((e) => ({ id: e.id, label: e.nome, color: e.cor, onSelect: () => void executar('etapa', { stageId: e.id }, (k) => `${n(k, 'negócio movido', 'negócios movidos')} para ${e.nome}.`).catch(() => undefined) })),
  ];
  const donoItens: MenuEntry[] = [
    { type: 'label', id: 'r', label: 'Atribuir dono' },
    ...donos.map((d) => ({ id: d.identityId, label: d.nome, onSelect: () => void executar('dono', { ownerId: d.identityId }, (k) => `${n(k, 'negócio atribuído', 'negócios atribuídos')} a ${d.nome}.`).catch(() => undefined) })),
    { type: 'separator', id: 's' },
    { id: 'nenhum', label: 'Sem dono', onSelect: () => void executar('dono', { ownerId: null }, (k) => `${n(k, 'negócio ficou', 'negócios ficaram')} sem dono.`).catch(() => undefined) },
  ];

  return (
    <>
      {sel.size > 0 && (
        <div role="region" aria-label="Ações em massa" className="sticky top-2 z-dropdown mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-brand bg-surface p-2.5 shadow-sm">
          <span className="px-1.5 text-sm font-semibold text-fg tabular">{qtd} selecionado{sel.size === 1 ? '' : 's'}</span>
          {excede ? (
            <span className="text-xs text-danger">Selecione no máximo {LIMITE_MASSA.toLocaleString('pt-BR')} por vez.</span>
          ) : (
            <>
              <Menu label="Mover selecionados para etapa" trigger={<span className="flex items-center gap-1.5"><Icon name="arrowRight" size={14} />Mover</span>} items={moverItens} triggerClassName="btn btn-sm" disabled={ocupado} />
              <Menu label="Atribuir dono aos selecionados" trigger={<span className="flex items-center gap-1.5"><Icon name="user" size={14} />Dono</span>} items={donoItens} triggerClassName="btn btn-sm" disabled={ocupado} />
              <Button size="sm" icon="trophy" disabled={ocupado} onClick={() => void executar('ganho', {}, (k) => `${n(k, 'negócio marcado', 'negócios marcados')} como ganho.`).catch(() => undefined)}>Ganho</Button>
              <Button size="sm" icon="minus" disabled={ocupado} onClick={() => setPerdendo(true)}>Perdido</Button>
              <Button size="sm" variant="danger" icon="trash" disabled={ocupado} onClick={() => setExcluindo(true)}>Excluir</Button>
            </>
          )}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSel(new Set())}>Limpar seleção</Button>
        </div>
      )}

      <div className="card overflow-x-auto scrollbar-thin">
        <table className="tbl">
          <thead>
            <tr>
              <th className="w-10">
                <input
                  type="checkbox"
                  className="checkbox"
                  aria-label="Selecionar todos os negócios da lista"
                  checked={todos}
                  ref={(el) => { if (el) el.indeterminate = alguns; }}
                  onChange={() => setSel(todos ? new Set() : new Set(linhas.map((l) => l.id)))}
                />
              </th>
              {COLUNAS.map((c) => {
                const ativa = ordem.coluna === c.key;
                return (
                  <th key={c.key} className={cx(c.num && 'text-right')} aria-sort={ativa ? (ordem.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" className={cx('inline-flex items-center gap-1 hover:text-fg', c.num && 'flex-row-reverse', ativa && 'text-fg')} onClick={() => ordenar(c.key)}>
                      {c.label}
                      <Icon name={ativa && ordem.dir === 'asc' ? 'arrowUp' : 'arrowDown'} size={12} className={ativa ? 'opacity-100' : 'opacity-0'} aria-hidden />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => {
              const marcado = sel.has(l.id);
              const pill = STATUS_PILL[l.status];
              return (
                <tr key={l.id} className={cx('cursor-pointer', marcado && 'bg-brand-softer')} onClick={() => onAbrir(l.id)}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="checkbox"
                      aria-label={`Selecionar ${l.titulo}`}
                      checked={marcado}
                      onChange={() => setSel((s) => { const p = new Set(s); if (p.has(l.id)) p.delete(l.id); else p.add(l.id); return p; })}
                    />
                  </td>
                  <td className="max-w-[260px]">
                    <button type="button" className="block max-w-full truncate text-left font-medium text-fg hover:underline" onClick={(e) => { e.stopPropagation(); onAbrir(l.id); }}>{l.titulo}</button>
                    {pill && (
                      <span className={cx('pill mt-1 h-5 px-1.5 text-2xs', pill.cls)} title={l.motivoPerda ?? undefined}>
                        {pill.label}{l.status === 'perdido' && l.motivoPerda ? `: ${l.motivoPerda}` : ''}
                      </span>
                    )}
                  </td>
                  <td className="text-muted">{l.contato === '-' ? '' : l.contato}</td>
                  <td>
                    <span className="pill h-6 gap-1.5 px-2 text-xs">
                      <span className="h-2 w-2 rounded-full" style={{ background: l.cor }} aria-hidden />
                      {l.etapa}
                    </span>
                  </td>
                  <td className="text-right font-semibold tabular text-fg">{moeda(l.valor)}</td>
                  <td className="text-sm">{l.dono || <span className="text-faint">Sem dono</span>}</td>
                  <td className="text-sm text-muted">{l.origem}</td>
                  <td><Quando data={l.createdAt} formato="data" className="text-sm text-muted" /></td>
                  <td>{l.ultimoContatoAt ? <Quando data={l.ultimoContatoAt} className="text-sm text-muted" /> : <span className="text-sm text-faint">Nunca</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <MotivoPerdaModal
        open={perdendo}
        alvo={qtd}
        onClose={() => setPerdendo(false)}
        onConfirm={async (d: DadosPerda) => {
          await executar('perdido', { motivoPerdaId: d.motivoPerdaId, motivoPerdaObs: d.motivoPerdaObs }, (k) => `${n(k, 'negócio marcado', 'negócios marcados')} como perdido.`);
          setPerdendo(false);
        }}
      />
      <Confirm
        open={excluindo}
        onClose={() => setExcluindo(false)}
        loading={ocupado}
        title={`Excluir ${qtd}?`}
        description="Os negócios, suas tarefas e notas somem. Os contatos continuam no CRM. Não dá para desfazer."
        confirmLabel={`Excluir ${qtd}`}
        onConfirm={async () => {
          await executar('excluir', {}, (k) => `${n(k, 'negócio excluído', 'negócios excluídos')}.`).catch(() => undefined);
          setExcluindo(false);
        }}
      />
    </>
  );
}
