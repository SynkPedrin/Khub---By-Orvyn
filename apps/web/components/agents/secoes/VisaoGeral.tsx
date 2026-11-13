'use client';

import Link from 'next/link';
import { Icon, type IconName } from '@/components/icons';
import { agentesApi, inteiro, ROTULO_INTENCAO, ROTULO_STATUS_RUN, dataHora, usd } from '@/lib/agents';
import { cx } from '@/components/ui';
import { Erro, Esqueleto, Metrica, Painel, Vazio, useCarga } from '../kit';
import type { SecaoProps } from '../editor';

/** Agent Overview: saúde do agente, prontidão para atender e atividade recente. */
export function VisaoGeral({ agente, catalogo }: SecaoProps) {
  const dados = useCarga(async () => {
    const [an, logs, fontes, regrasFu, aprov] = await Promise.all([
      agentesApi.analytics(agente.id, 7),
      agentesApi.logs(agente.id),
      agentesApi.conhecimento(agente.id),
      agentesApi.regrasFollowup(agente.id),
      agentesApi.execucoesFerramentas(agente.id, 'aguardando_aprovacao'),
    ]);
    return { an, logs, fontes, regrasFu, aprov };
  }, [agente.id, agente.updatedAt]);

  if (dados.erro) return <Erro texto={dados.erro} tentar={dados.recarregar} />;
  if (!dados.dados) return <Esqueleto linhas={6} />;
  const { an, logs, fontes, regrasFu, aprov } = dados.dados;

  const checklist: { ok: boolean; texto: string; aba: string; icone: IconName }[] = [
    { ok: agente.instrucoes.trim().length >= 20, texto: 'Instruções da empresa escritas', aba: 'comportamento', icone: 'note' },
    { ok: !!agente.config.identidade.objetivoPrincipal.trim(), texto: 'Objetivo principal definido', aba: 'identidade', icone: 'target' },
    { ok: fontes.resumo.ativos > 0, texto: `Base de conhecimento com fontes ativas (${fontes.resumo.ativos})`, aba: 'conhecimento', icone: 'knowledge' },
    { ok: catalogo.ia.configurada, texto: `IA conectada (${catalogo.ia.provedor === 'anthropic' ? 'Claude' : (catalogo.ia.provedor ?? 'IA')})`, aba: 'inteligencia', icone: 'ai' },
    { ok: regrasFu.some((r) => r.ativo), texto: 'Ao menos uma estratégia de follow-up ativa', aba: 'followup', icone: 'clock' },
    { ok: !!agente.versaoPublicada, texto: 'Versão publicada', aba: 'versoes', icone: 'upload' },
    { ok: agente.status === 'ativo', texto: 'Agente ativo', aba: 'visao', icone: 'play' },
  ];
  const prontos = checklist.filter((c) => c.ok).length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metrica rotulo="Execuções (7 dias)" valor={inteiro(an.resumo.execucoes)} detalhe={`${inteiro(an.resumo.conversas)} conversa(s)`} icone="chat" />
        <Metrica rotulo="Transferências" valor={`${an.resumo.taxaTransferencia}%`} detalhe={`erro ${an.resumo.taxaErro}%`} icone="users" tom="neutral" />
        <Metrica rotulo="Custo (7 dias)" valor={usd(an.resumo.custoUsd)} detalhe={`${inteiro(an.resumo.tokens)} tokens`} icone="dollar" />
        <Metrica rotulo="Latência mediana" valor={an.resumo.latenciaP50Ms ? `${(an.resumo.latenciaP50Ms / 1000).toFixed(1)}s` : '-'} detalhe={an.resumo.latenciaP95Ms ? `p95 ${(an.resumo.latenciaP95Ms / 1000).toFixed(1)}s` : 'sem dados'} icone="clock" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Painel titulo="Atividade recente" descricao="Cada mensagem processada, com a decisão tomada." acao={<Link href={`/agentes/${agente.id}?aba=logs`} className="btn btn-ghost btn-sm">Ver logs</Link>} corpo="p-2">
          {logs.itens.length === 0 ? (
            <Vazio icone="chat" titulo="Nenhuma conversa atendida ainda" descricao="Teste no simulador e ative o agente para ele atender conversas novas no WhatsApp." />
          ) : (
            <ul className="divide-y divide-line">
              {logs.itens.slice(0, 10).map((l) => (
                <li key={l.id} className="flex items-start gap-3 px-3 py-2.5">
                  <span className={cx('pill mt-0.5 shrink-0', l.status === 'respondido' ? 'pill-success' : l.status === 'erro' ? 'pill-danger' : l.status === 'transferido' ? 'pill-warning' : '')}>{ROTULO_STATUS_RUN[l.status] ?? l.status}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] text-fg">{l.mensagem ?? '(mensagem sem texto)'}</span>
                    <span className="block truncate text-xs text-muted">{l.intencao ? ROTULO_INTENCAO[l.intencao] ?? l.intencao : 'sem análise'}{l.blocos ? ` · ${l.blocos} bloco(s)` : ''}{l.motivo ? ` · ${l.motivo}` : ''}</span>
                  </span>
                  <span className="shrink-0 text-xs tabular text-faint">{dataHora(l.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Painel>

        <div className="space-y-5">
          <Painel titulo="Configuração do atendimento" descricao={`${prontos} de ${checklist.length} itens de configuração. Valide a qualidade no simulador antes de ativar.`}>
            <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-surface3"><div className="h-full rounded-full bg-brand transition-all" style={{ width: `${(prontos / checklist.length) * 100}%` }} /></div>
            <ul className="space-y-1.5">
              {checklist.map((c) => (
                <li key={c.texto}>
                  <Link href={`/agentes/${agente.id}?aba=${c.aba}`} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13.5px] hover:bg-surface2">
                    <span className={cx('icon-tile h-6 w-6 rounded-md', c.ok ? 'icon-tile-success' : 'icon-tile-neutral')}><Icon name={c.ok ? 'check' : c.icone} size={12} /></span>
                    <span className={cx('flex-1', c.ok ? 'text-muted' : 'text-fg')}>{c.texto}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Painel>

          {aprov.length > 0 && (
            <Painel titulo="Ações aguardando aprovação" descricao="Operações críticas que o agente pediu e só executam depois de um humano aprovar." acao={<Link href={`/agentes/${agente.id}?aba=ferramentas`} className="btn btn-soft btn-sm">Revisar ({aprov.length})</Link>}>
              <ul className="space-y-1.5 text-[13px]">
                {aprov.slice(0, 4).map((x) => <li key={x.id} className="flex justify-between gap-2"><span className="truncate text-fg">{x.ferramenta}</span><span className="shrink-0 text-xs text-muted">{dataHora(x.createdAt)}</span></li>)}
              </ul>
            </Painel>
          )}

          <Painel titulo="Intenções (7 dias)">
            {an.intencoes.length === 0 ? <p className="text-[13px] text-muted">Sem mensagens analisadas no período.</p> : (
              <ul className="space-y-2">
                {an.intencoes.slice(0, 6).map((i) => {
                  const max = an.intencoes[0].n;
                  return (
                    <li key={i.intencao ?? '-'} className="text-[13px]">
                      <div className="flex justify-between"><span className="text-fg">{i.intencao ? ROTULO_INTENCAO[i.intencao] ?? i.intencao : '-'}</span><span className="tabular text-muted">{i.n}</span></div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface3"><div className="h-full rounded-full bg-brand/70" style={{ width: `${(i.n / max) * 100}%` }} /></div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Painel>
        </div>
      </div>
    </div>
  );
}
