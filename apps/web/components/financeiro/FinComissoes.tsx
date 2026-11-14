'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, Input, cx } from '@/components/ui';
import { Confirm, SkeletonRows } from '@/components/kit';
import { Paginacao, usePaginacao } from '@/components/kit';
import { financeiro, type ComissaoGerada, type ComissoesMes, type MembroComissao } from '@/lib/financeiro';
import { competenciaAtual, dataBR, falhaDeCarga, lerPercentual, mensagemFin, money, type FalhaCarga } from './fin-utils';
import { FinAviso, FinFalha } from './FinEstado';

const ROLE_LABEL: Record<string, string> = { owner: 'Dona(o)', admin: 'Admin', manager: 'Gerente', member: 'Membro', viewer: 'Visualização' };

const percentParaCampo = (n: number) => (n ? String(n).replace('.', ',') : '');

/**
 * Comissões da equipe: cargo e % de cada membro e as comissões geradas na
 * competência escolhida. Pagar lança a saída no caixa automaticamente;
 * estornar desfaz o pagamento (a comissão volta a prevista e a saída sai do caixa).
 */
export function FinComissoes() {
  const [equipe, setEquipe] = useState<MembroComissao[] | null>(null);
  const [falhaEquipe, setFalhaEquipe] = useState<FalhaCarga | null>(null);
  const [mes, setMes] = useState(competenciaAtual());
  const [geradas, setGeradas] = useState<ComissoesMes | null>(null);
  const pg = usePaginacao(geradas?.itens, 25);
  const [falhaGeradas, setFalhaGeradas] = useState<FalhaCarga | null>(null);
  const [edicao, setEdicao] = useState<Record<string, { cargo: string; percent: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [estornar, setEstornar] = useState<ComissaoGerada | null>(null);
  const [tentativa, setTentativa] = useState(0);

  const loadEquipe = () => {
    setFalhaEquipe(null);
    financeiro.equipeComissoes().then((m) => {
      setEquipe(m);
      setEdicao(Object.fromEntries(m.map((x) => [x.identityId, { cargo: x.cargo ?? '', percent: percentParaCampo(x.comissaoPercent) }])));
    }).catch((e) => setFalhaEquipe(falhaDeCarga(e, 'a equipe')));
  };
  const loadGeradas = () => setTentativa((t) => t + 1);

  useEffect(loadEquipe, []);
  useEffect(() => {
    let vivo = true;
    setGeradas(null);
    setFalhaGeradas(null);
    financeiro
      .comissoesGeradas(mes)
      .then((g) => vivo && setGeradas(g))
      .catch((e) => vivo && setFalhaGeradas(falhaDeCarga(e, 'as comissões do mês')));
    return () => {
      vivo = false;
    };
  }, [mes, tentativa]);

  const salvar = async (m: MembroComissao) => {
    const e = edicao[m.identityId];
    const percent = lerPercentual(e?.percent ?? '');
    if (percent === null) { setMsg('O percentual precisa estar entre 0 e 100, com no máximo 2 casas decimais (ex.: 12,5).'); setOk(null); return; }
    setBusy(m.identityId); setMsg(null); setOk(null);
    try {
      await financeiro.definirComissao(m.identityId, { cargo: e?.cargo.trim() || null, comissaoPercent: percent });
      setOk(`Comissão de ${m.nome} salva.`);
      loadEquipe();
    } catch (err) { setMsg(mensagemFin(err, 'salvar a comissão')); } finally { setBusy(null); }
  };

  const pagar = async (id: string) => {
    setBusy(id); setMsg(null); setOk(null);
    try {
      await financeiro.pagarComissao(id);
      setOk('Comissão paga. A saída já está no fluxo de caixa.');
      loadGeradas();
    } catch (e) { setMsg(mensagemFin(e, 'marcar a comissão como paga')); } finally { setBusy(null); }
  };

  const confirmarEstorno = async () => {
    if (!estornar) return;
    setBusy('estornar'); setMsg(null); setOk(null);
    try {
      await financeiro.estornarComissao(estornar.id);
      setEstornar(null);
      setOk('Pagamento estornado. A comissão voltou para a pagar.');
      loadGeradas();
    } catch (e) {
      setEstornar(null);
      setMsg(mensagemFin(e, 'estornar o pagamento'));
    } finally { setBusy(null); }
  };

  const totalMes = geradas?.porMembro.reduce((n, m) => n + m.totalCentavos, 0) ?? 0;
  const pagoMes = geradas?.porMembro.reduce((n, m) => n + m.pagoCentavos, 0) ?? 0;

  return (
    <div className="space-y-4">
      {msg && <FinAviso texto={msg} />}
      {ok && <FinAviso texto={ok} tom="ok" />}

      <Card className="overflow-hidden p-0">
        <div className="border-b border-line px-5 py-3">
          <h2 className="font-bold text-fg">Equipe: cargo e comissão</h2>
          <p className="mt-0.5 text-xs text-muted">A % vale sobre cada entrada recebida atribuída ao profissional (atendimento concluído na agenda ou lançamento manual). O valor é arredondado ao centavo.</p>
        </div>
        {falhaEquipe ? (
          <FinFalha falha={falhaEquipe} onTentar={loadEquipe} />
        ) : (
          <div className="divide-y divide-line">
            {equipe?.map((m) => (
              <div key={m.identityId} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-fg">{m.nome}</p>
                  <p className="text-[11px] text-muted">{m.email} · {ROLE_LABEL[m.role] ?? m.role}</p>
                </div>
                <div className="w-40">
                  <Input
                    value={edicao[m.identityId]?.cargo ?? ''}
                    onChange={(e) => setEdicao({ ...edicao, [m.identityId]: { ...edicao[m.identityId], cargo: e.target.value } })}
                    placeholder="Cargo (ex.: Cabeleireira)"
                    maxLength={80}
                    aria-label={`Cargo de ${m.nome}`}
                  />
                </div>
                <div className="flex w-28 items-center gap-1">
                  <Input
                    value={edicao[m.identityId]?.percent ?? ''}
                    onChange={(e) => setEdicao({ ...edicao, [m.identityId]: { ...edicao[m.identityId], percent: e.target.value } })}
                    placeholder="0"
                    inputMode="decimal"
                    aria-label={`Comissão de ${m.nome} em porcento`}
                    aria-invalid={lerPercentual(edicao[m.identityId]?.percent ?? '') === null}
                  />
                  <span className="text-sm text-muted">%</span>
                </div>
                <Button onClick={() => salvar(m)} disabled={busy === m.identityId}>{busy === m.identityId ? 'Salvando…' : 'Salvar'}</Button>
              </div>
            ))}
            {equipe && equipe.length === 0 && <p className="px-5 py-10 text-center text-sm text-muted">Nenhum membro na equipe ainda.</p>}
            {!equipe && <SkeletonRows rows={3} label="Carregando equipe" />}
          </div>
        )}
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div>
            <h2 className="font-bold text-fg">Comissões do mês</h2>
            <p className="mt-0.5 text-xs text-muted">Geradas automaticamente pelas entradas de cada profissional.</p>
          </div>
          <input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} className="input w-40" aria-label="Mês das comissões" />
        </div>

        {falhaGeradas ? (
          <FinFalha falha={falhaGeradas} onTentar={loadGeradas} />
        ) : (
          <>
            {geradas && (
              <div className="grid gap-3 border-b border-line px-5 py-4 sm:grid-cols-3">
                <div><p className="text-xs text-muted">Total em comissões</p><p className="text-lg font-semibold text-fg">{money(totalMes)}</p></div>
                <div><p className="text-xs text-muted">Já pago</p><p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">{money(pagoMes)}</p></div>
                <div><p className="text-xs text-muted">A pagar</p><p className="text-lg font-semibold text-amber-600 dark:text-amber-400">{money(totalMes - pagoMes)}</p></div>
              </div>
            )}

            <div className="divide-y divide-line">
              {pg.fatia?.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-fg">{c.nome}</p>
                    <p className="text-[11px] text-muted">
                      {c.descricao ?? 'Entrada'}{c.dataCompetencia ? ` · ${dataBR(c.dataCompetencia)}` : ''} · {String(c.percent).replace('.', ',')}% de {money(c.baseCentavos)}
                      {c.status === 'paga' && c.pagoEm ? ` · paga em ${dataBR(c.pagoEm)}` : ''}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-fg">{money(c.valorCentavos)}</p>
                  <Badge tone={c.status === 'paga' ? 'green' : 'amber'}>{c.status === 'paga' ? 'paga' : 'prevista'}</Badge>
                  {c.status !== 'paga' ? (
                    <button onClick={() => pagar(c.id)} disabled={busy === c.id} className={cx('rounded-lg border border-emerald-500/40 px-2.5 py-1 text-[11px] font-semibold text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400')}>
                      {busy === c.id ? 'Pagando…' : 'Pagar'}
                    </button>
                  ) : (
                    <button onClick={() => setEstornar(c)} className="rounded-lg px-2 py-1 text-[11px] font-semibold text-muted hover:text-fg">Estornar pagamento</button>
                  )}
                </div>
              ))}
              {geradas && geradas.itens.length === 0 && (
                <p className="px-5 py-10 text-center text-sm text-muted">Nenhuma comissão gerada neste mês. Atribua entradas aos profissionais com % configurada.</p>
              )}
              {!geradas && <SkeletonRows rows={3} label="Carregando comissões" />}
            </div>
            {geradas && <Paginacao pagina={pg.pagina} totalPaginas={pg.totalPaginas} total={pg.total} tamanho={pg.tamanho} onPagina={pg.setPagina} onTamanho={pg.setTamanho} rotulo="comissões" />}
          </>
        )}
      </Card>

      <Confirm
        open={!!estornar}
        onClose={() => setEstornar(null)}
        onConfirm={confirmarEstorno}
        loading={busy === 'estornar'}
        tone="primary"
        confirmLabel="Estornar"
        title="Estornar o pagamento desta comissão?"
        description={estornar ? `A comissão de ${estornar.nome} (${money(estornar.valorCentavos)}) volta a ficar a pagar e a saída correspondente sai do fluxo de caixa.` : undefined}
      />
    </div>
  );
}
