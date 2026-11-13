'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { BarrasHorizontais } from '@/components/revenue/charts';
import { agentesApi, dataHora, inteiro, usd, ROTULO_INTENCAO, ROTULO_OBJECAO, type AnalyticsAgente } from '@/lib/agents';
import { Abas, Erro, Esqueleto, Metrica, Painel, Vazio, useCarga } from '../kit';
import type { SecaoProps } from '../editor';
import { duracao, porcento } from './Simulador';

type Periodo = '7' | '30' | '90';
type MetricaSerie = 'volume' | 'custo' | 'tokens';

const taxa = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const diaCurto = (s: string) => {
  const [a, m, d] = s.slice(0, 10).split('-');
  return a && m && d ? `${d}/${m}` : s;
};
const ROTULO_SENTIMENTO: Record<string, string> = { positivo: 'Positivo', neutro: 'Neutro', negativo: 'Negativo' };
const ROTULO_STATUS_FOLLOWUP: Record<string, string> = { agendado: 'Agendados', gerando: 'Gerando', enviado: 'Enviados', cancelado: 'Cancelados', pulado: 'Pulados', falhou: 'Falharam' };
const ROTULO_STATUS_ENTREGA: Record<string, string> = { pendente: 'Pendentes', enviando: 'Enviando', enviado: 'Enviadas', falhou: 'Falharam', cancelado: 'Canceladas' };
const ROTULO_STATUS_FERRAMENTA: Record<string, string> = { executado: 'Executadas', erro: 'Erro', aguardando_aprovacao: 'Aguardando aprovação', aprovado: 'Aprovadas', rejeitado: 'Rejeitadas' };

/** Analytics Dashboard do agente: números calculados das tabelas operacionais (runs, entregas, follow-ups, ferramentas). */
export function Analytics({ agente, catalogo }: SecaoProps) {
  const [periodo, setPeriodo] = useState<Periodo>('30');
  const dados = useCarga(() => agentesApi.analytics(agente.id, Number(periodo)), [agente.id, periodo]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="t-title">Desempenho do agente</h2>
          <p className="text-[13px] text-muted">Execuções, custo, intenções e qualidade por versão no período.</p>
        </div>
        <Abas
          valor={periodo}
          onChange={setPeriodo}
          opcoes={[
            { valor: '7', rotulo: '7 dias' },
            { valor: '30', rotulo: '30 dias' },
            { valor: '90', rotulo: '90 dias' },
          ]}
        />
      </div>

      {dados.carregando && !dados.dados ? (
        <div className="card"><Esqueleto linhas={8} /></div>
      ) : dados.erro ? (
        <div className="card"><Erro texto={dados.erro} tentar={() => void dados.recarregar()} /></div>
      ) : !dados.dados || dados.dados.resumo.execucoes === 0 ? (
        <div className="card">
          <Vazio icone="trend" titulo="Sem execuções no período" descricao="Quando o agente atender conversas no WhatsApp, os números aparecem aqui. Para testar sem atender ninguém, use o simulador." acao={<Link href={`/agentes/${agente.id}?aba=simulador`} className="btn btn-soft btn-sm"><Icon name="chat" size={14} /> Abrir simulador</Link>} />
        </div>
      ) : (
        <Conteudo a={dados.dados} agenteId={agente.id} catalogo={catalogo} atualizando={dados.carregando} />
      )}
    </div>
  );
}

function Conteudo({ a, agenteId, catalogo, atualizando }: { a: AnalyticsAgente; agenteId: string; catalogo: SecaoProps['catalogo']; atualizando: boolean }) {
  const r = a.resumo;
  const nomeEstrategia = (id: string) => catalogo.estrategiasFollowup.find((e) => e.id === id)?.nome ?? id;
  const nomeFerramenta = (id: string) => catalogo.ferramentas.find((f) => f.nome === id)?.rotulo ?? id;

  const followups = useMemo(() => agrupar(a.followups.map((f) => ({ linha: f.estrategia, coluna: f.status, n: f.n }))), [a.followups]);
  const ferramentas = useMemo(() => agrupar(a.ferramentas.map((f) => ({ linha: f.ferramenta, coluna: f.status, n: f.n }))), [a.ferramentas]);
  const entregas = Object.entries(a.entregas).sort((x, y) => y[1] - x[1]);
  const piorou = a.versoes.versoes.some((v) => v.piorou);

  return (
    <div className={cx('space-y-5 transition-opacity', atualizando && 'opacity-60')} aria-busy={atualizando}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metrica rotulo="Execuções" valor={inteiro(r.execucoes)} icone="bolt" tom="info" />
        <Metrica rotulo="Conversas" valor={inteiro(r.conversas)} icone="chat" tom="neutral" />
        <Metrica rotulo="Taxa de transferência" valor={taxa(r.taxaTransferencia)} icone="users" tom="warning" />
        <Metrica rotulo="Taxa de erro" valor={taxa(r.taxaErro)} icone="alert" tom={r.taxaErro > 5 ? 'danger' : 'success'} />
        <Metrica rotulo="Custo" valor={usd(r.custoUsd)} icone="dollar" tom="neutral" />
        <Metrica rotulo="Tokens" valor={inteiro(r.tokens)} icone="ai" tom="neutral" />
        <Metrica rotulo="Latência p50" valor={duracao(r.latenciaP50Ms)} icone="clock" tom="neutral" />
        <Metrica rotulo="Latência p95" valor={duracao(r.latenciaP95Ms)} icone="clock" tom="neutral" />
      </div>

      {piorou && (
        <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-warning-border bg-warning-soft px-4 py-3 text-[13.5px] text-fg">
          <Icon name="alert" size={16} className="shrink-0" />
          <span className="flex-1">A versão atual piorou em relação à anterior (transferência, erro ou guardrail). Avalie restaurar a versão anterior.</span>
          <Link href={`/agentes/${agenteId}?aba=versoes`} className="btn btn-ghost btn-sm">Ver versões</Link>
        </div>
      )}

      <SerieDiaria serie={a.serie} />

      <div className="grid gap-5 lg:grid-cols-2">
        <Painel titulo="Intenções" descricao="O que os contatos queriam nas mensagens processadas.">
          <BarrasHorizontais dados={a.intencoes.slice(0, 10).map((i) => ({ rotulo: i.intencao ? ROTULO_INTENCAO[i.intencao] ?? i.intencao : 'Sem intenção', valor: i.n }))} formatar={inteiro} />
        </Painel>
        <Painel titulo="Objeções" descricao="Objeções detectadas pela análise de cada mensagem.">
          {a.objecoes.length ? (
            <BarrasHorizontais dados={a.objecoes.slice(0, 10).map((o) => ({ rotulo: ROTULO_OBJECAO[o.objecao] ?? o.objecao, valor: o.n }))} formatar={inteiro} />
          ) : (
            <p className="text-[13.5px] text-muted">Nenhuma objeção detectada no período.</p>
          )}
        </Painel>
        <Painel titulo="Sentimento" descricao="Como os contatos chegaram nas mensagens.">
          {a.sentimentos.length ? (
            <BarrasHorizontais dados={a.sentimentos.map((s) => ({ rotulo: s.sentimento ? ROTULO_SENTIMENTO[s.sentimento] ?? s.sentimento : 'Não identificado', valor: s.n }))} formatar={inteiro} />
          ) : (
            <p className="text-[13.5px] text-muted">Sem dados de sentimento no período.</p>
          )}
        </Painel>
        <Painel titulo="Lacunas de conhecimento" descricao="Perguntas que a base não soube responder. Adicione o conteúdo oficial na Base de conhecimento.">
          {a.lacunas.length ? (
            <ol className="divide-y divide-line">
              {a.lacunas.slice(0, 10).map((l, i) => (
                <li key={`${l.pergunta}-${i}`} className="flex items-start justify-between gap-3 py-2 text-[13.5px]">
                  <span className="min-w-0 break-words text-fg">{l.pergunta}</span>
                  <span className="pill shrink-0 tabular">{inteiro(l.n)}x</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[13.5px] text-muted">Nenhuma pergunta sem resposta no período.</p>
          )}
          <Link href={`/agentes/${agenteId}?aba=conhecimento`} className="btn btn-ghost btn-sm mt-3"><Icon name="knowledge" size={14} /> Base de conhecimento</Link>
        </Painel>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Painel titulo="Entregas por status" descricao="Blocos enviados ao WhatsApp.">
          {entregas.length ? (
            <ul className="space-y-2">
              {entregas.map(([s, n]) => (
                <li key={s} className="flex items-center justify-between text-[13.5px]">
                  <span className="text-muted">{ROTULO_STATUS_ENTREGA[s] ?? s}</span>
                  <span className="font-semibold tabular text-fg">{inteiro(n)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13.5px] text-muted">Nenhuma entrega no período.</p>
          )}
        </Painel>
        <Painel titulo="Follow-ups" descricao="Por estratégia e status." className="lg:col-span-2" corpo="pb-2">
          <TabelaCruzada grupo={followups} rotuloLinha="Estratégia" nomeLinha={nomeEstrategia} nomeColuna={(c) => ROTULO_STATUS_FOLLOWUP[c] ?? c} vazio="Nenhum follow-up no período." />
        </Painel>
      </div>

      <Painel titulo="Uso de ferramentas" descricao="Chamadas de ferramentas do CRM por status." corpo="pb-2">
        <TabelaCruzada grupo={ferramentas} rotuloLinha="Ferramenta" nomeLinha={nomeFerramenta} nomeColuna={(c) => ROTULO_STATUS_FERRAMENTA[c] ?? c} vazio="Nenhuma ferramenta usada no período." />
      </Painel>

      <Painel titulo="Desempenho por versão" descricao="Histórico fixo dos últimos 90 dias, independente do filtro acima. Sinais de atenção exigem ao menos 20 execuções por versão; revise o contexto antes de reverter." corpo="pb-2">
        {a.versoes.versoes.length === 0 && !a.versoes.semVersao ? (
          <p className="px-5 pt-4 text-[13.5px] text-muted">Nenhuma versão publicada atendeu no período.</p>
        ) : (
          <div className="overflow-x-auto pt-3">
            <table className="tbl min-w-[720px]">
              <thead>
                <tr>
                  <th>Versão</th>
                  <th>Publicada</th>
                  <th className="text-right">Execuções</th>
                  <th className="text-right">Transferência</th>
                  <th className="text-right">Erro</th>
                  <th className="text-right">Guardrail</th>
                  <th className="text-right">Confiança média</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {a.versoes.versoes.map((v) => (
                  <tr key={v.versionId} className={cx(v.piorou && 'bg-warning-soft')}>
                    <td className="whitespace-nowrap font-medium">
                      v{v.numero}
                      {v.piorou && <span className="pill pill-warning ml-2"><Icon name="alert" size={11} /> Revisar</span>}
                    </td>
                    <td className="whitespace-nowrap tabular">{dataHora(v.publicadaEm)}</td>
                    <td className="text-right tabular">{inteiro(v.execucoes)}</td>
                    <td className="text-right tabular">{taxa(v.taxaTransferencia)}</td>
                    <td className="text-right tabular">{taxa(v.taxaErro)}</td>
                    <td className="text-right tabular">{taxa(v.taxaGuardrail)}</td>
                    <td className="text-right tabular">{porcento(v.confiancaMedia)}</td>
                    <td className="text-right">
                      {v.piorou && <Link href={`/agentes/${agenteId}?aba=versoes`} className="btn btn-ghost btn-sm whitespace-nowrap">Revisar versão</Link>}
                    </td>
                  </tr>
                ))}
                {a.versoes.semVersao && (
                  <tr>
                    <td className="font-medium">Sem versão</td>
                    <td className="text-muted">Rascunho direto</td>
                    <td className="text-right tabular">{inteiro(a.versoes.semVersao.execucoes)}</td>
                    <td className="text-right tabular">{taxa(a.versoes.semVersao.taxaTransferencia)}</td>
                    <td className="text-right text-muted">-</td>
                    <td className="text-right text-muted">-</td>
                    <td className="text-right text-muted">-</td>
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Painel>
    </div>
  );
}

// ------------------------------------------------------------------ série diária

const SERIES_VOLUME = [
  { chave: 'respondido', rotulo: 'Respondidas', cor: 'bg-success' },
  { chave: 'transferido', rotulo: 'Transferidas', cor: 'bg-warning' },
  { chave: 'erro', rotulo: 'Erros', cor: 'bg-danger' },
  { chave: 'ignorado', rotulo: 'Ignoradas', cor: 'bg-surface3' },
] as const;

function SerieDiaria({ serie }: { serie: AnalyticsAgente['serie'] }) {
  const [metrica, setMetrica] = useState<MetricaSerie>('volume');
  const ALTURA = 180;
  const valores = serie.map((d) => (metrica === 'volume' ? d.respondido + d.transferido + d.erro + d.ignorado : metrica === 'custo' ? Number(d.custoUsd) : d.tokens));
  const max = Math.max(0, ...valores);
  const passoRotulo = Math.max(1, Math.ceil(serie.length / 10));
  const fmt = (n: number) => (metrica === 'custo' ? usd(n) : inteiro(n));

  return (
    <Painel
      titulo="Evolução diária"
      descricao={metrica === 'volume' ? 'Execuções por dia, empilhadas pelo desfecho.' : metrica === 'custo' ? 'Custo de IA por dia (USD).' : 'Tokens consumidos por dia.'}
      acao={
        <Abas
          valor={metrica}
          onChange={setMetrica}
          opcoes={[
            { valor: 'volume', rotulo: 'Execuções' },
            { valor: 'custo', rotulo: 'Custo' },
            { valor: 'tokens', rotulo: 'Tokens' },
          ]}
        />
      }
    >
      {serie.length === 0 ? (
        <p className="text-[13.5px] text-muted">Sem dados diários no período.</p>
      ) : (
        <figure className="m-0">
          {metrica === 'volume' && (
            <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
              {SERIES_VOLUME.map((s) => (
                <li key={s.chave} className="flex items-center gap-1.5"><span className={cx('h-2.5 w-2.5 rounded-sm', s.cor)} />{s.rotulo}</li>
              ))}
            </ul>
          )}
          <div className="flex items-end gap-[2px] border-b border-line" style={{ height: ALTURA }}>
            {serie.map((d, i) => {
              const total = valores[i] ?? 0;
              const alturaPct = max ? (total / max) * 100 : 0;
              const descricao =
                metrica === 'volume'
                  ? `${diaCurto(d.dia)}: ${inteiro(d.respondido)} respondidas, ${inteiro(d.transferido)} transferidas, ${inteiro(d.erro)} erros, ${inteiro(d.ignorado)} ignoradas`
                  : `${diaCurto(d.dia)}: ${fmt(total)}`;
              return (
                <div key={d.dia} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end" title={descricao} role="img" aria-label={descricao}>
                  <div className="flex w-full flex-col-reverse overflow-hidden rounded-t-sm transition-opacity group-hover:opacity-80" style={{ height: `${alturaPct}%`, minHeight: total ? 2 : 0 }}>
                    {metrica === 'volume' ? (
                      SERIES_VOLUME.map((s) => {
                        const v = d[s.chave];
                        return v ? <div key={s.chave} className={s.cor} style={{ height: `${(v / total) * 100}%` }} /> : null;
                      })
                    ) : (
                      <div className="h-full bg-brand" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-1.5 flex gap-[2px]">
            {serie.map((d, i) => (
              <span key={d.dia} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center text-[10.5px] text-muted">{i % passoRotulo === 0 ? diaCurto(d.dia) : ''}</span>
            ))}
          </div>
          <figcaption className="mt-2 text-xs text-muted">Pico: {fmt(max)} em um dia · total {fmt(valores.reduce((t, v) => t + v, 0))}</figcaption>
        </figure>
      )}
    </Painel>
  );
}

// ------------------------------------------------------------------ tabela linha × status

type Grupo = { linhas: string[]; colunas: string[]; valor: Map<string, number> };
function agrupar(itens: { linha: string; coluna: string; n: number }[]): Grupo {
  const valor = new Map<string, number>();
  const totais = new Map<string, number>();
  const colunas = new Set<string>();
  for (const i of itens) {
    valor.set(`${i.linha}\u0000${i.coluna}`, (valor.get(`${i.linha}\u0000${i.coluna}`) ?? 0) + i.n);
    totais.set(i.linha, (totais.get(i.linha) ?? 0) + i.n);
    colunas.add(i.coluna);
  }
  return { linhas: [...totais.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l), colunas: [...colunas].sort(), valor };
}

function TabelaCruzada({ grupo, rotuloLinha, nomeLinha, nomeColuna, vazio }: { grupo: Grupo; rotuloLinha: string; nomeLinha: (l: string) => string; nomeColuna: (c: string) => string; vazio: string }) {
  if (!grupo.linhas.length) return <p className="px-5 pt-4 text-[13.5px] text-muted">{vazio}</p>;
  return (
    <div className="overflow-x-auto pt-3">
      <table className="tbl">
        <thead>
          <tr>
            <th>{rotuloLinha}</th>
            {grupo.colunas.map((c) => <th key={c} className="text-right">{nomeColuna(c)}</th>)}
            <th className="text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {grupo.linhas.map((l) => {
            const total = grupo.colunas.reduce((t, c) => t + (grupo.valor.get(`${l}\u0000${c}`) ?? 0), 0);
            return (
              <tr key={l}>
                <td className="whitespace-nowrap">{nomeLinha(l)}</td>
                {grupo.colunas.map((c) => <td key={c} className="text-right tabular">{inteiro(grupo.valor.get(`${l}\u0000${c}`) ?? 0)}</td>)}
                <td className="text-right font-semibold tabular">{inteiro(total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
