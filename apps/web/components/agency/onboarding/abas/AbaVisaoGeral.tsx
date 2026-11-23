'use client';

import { useMemo } from 'react';
import { Section } from '@/components/revenue/Page';
import { Quando } from '@/components/revenue/Quando';
import { Button } from '@/components/kit';
import { SECOES_CONHECIMENTO, rotuloEvento, type Verificacao } from '@/lib/onboarding';
import { Progresso, VerificacaoPill, VazioLocal } from '../pecas';
import type { TabProps } from '../OnboardingDetalhe';

/** Visão geral: progresso por seção, próximas pendências, últimos eventos e ações rápidas. */
export function AbaVisaoGeral({ ob, recarregar: _recarregar, irParaAba }: TabProps) {
  const porSecao = useMemo(() => {
    const mapa = new Map<string, { secao: string; total: number; verificadas: number }>();
    for (const v of ob.verifications) {
      const g = mapa.get(v.secao) ?? { secao: v.secao, total: 0, verificadas: 0 };
      g.total += 1;
      if (v.status === 'verificado') g.verificadas += 1;
      mapa.set(v.secao, g);
    }
    return [...mapa.values()].sort((a, b) => a.secao.localeCompare(b.secao, 'pt-BR'));
  }, [ob.verifications]);

  const confirmadas = useMemo(() => {
    const porSecaoKn = new Map(ob.knowledge.map((k) => [k.secao, k]));
    return SECOES_CONHECIMENTO.filter((s) => porSecaoKn.get(s.chave)?.pendente === false).length;
  }, [ob.knowledge]);

  const proximas = useMemo(() => {
    const peso = (v: Verificacao) => (v.status === 'bloqueado' ? 0 : v.obrigatorio ? 1 : 2);
    return ob.verifications
      .filter((v) => v.status !== 'verificado')
      .sort((a, b) => peso(a) - peso(b) || a.chave.localeCompare(b.chave))
      .slice(0, 6);
  }, [ob.verifications]);

  const atrasadas = useMemo(() => ob.tarefas.filter((t) => t.task && !t.task.arquivadaEm && t.task.prazoEm && new Date(t.task.prazoEm) < new Date() && t.task.status !== 'concluida').length, [ob.tarefas]);

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <Section title="Progresso por seção" info={`${confirmadas} de ${SECOES_CONHECIMENTO.length} seções de conhecimento confirmadas`}>
          {porSecao.length === 0 ? (
            <VazioLocal icone="target" titulo="Checklist ainda não semeado" texto="As verificações são criadas quando o onboarding é iniciado." />
          ) : (
            <ul className="space-y-2.5">
              {porSecao.map((s) => (
                <li key={s.secao} className="flex items-center gap-3">
                  <span className="w-36 truncate text-[13px] capitalize text-fg">{s.secao.replace(/_/g, ' ')}</span>
                  <Progresso verificadas={s.verificadas} total={s.total} className="flex-1" />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Próximas pendências" info="Verificações obrigatórias ainda não concluídas, bloqueadas primeiro">
          {proximas.length === 0 ? (
            <VazioLocal icone="check2" titulo="Tudo verificado" texto="Nenhuma verificação pendente. A homologação está pronta para a conferência final." />
          ) : (
            <ul className="divide-y divide-line">
              {proximas.map((v) => (
                <li key={v.id} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-fg">{v.rotulo}</span>
                    <span className="text-[11.5px] capitalize text-faint">{v.secao.replace(/_/g, ' ')}</span>
                  </span>
                  <VerificacaoPill status={v.status} />
                </li>
              ))}
            </ul>
          )}
          {atrasadas > 0 && (
            <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
              {atrasadas} {atrasadas === 1 ? 'tarefa do onboarding atrasada' : 'tarefas do onboarding atrasadas'} no Daily.
            </p>
          )}
        </Section>
      </div>

      <div className="space-y-5">
        <Section title="Ações rápidas">
          <div className="flex flex-col gap-2">
            <Button variant="soft" size="sm" icon="calendar" onClick={() => irParaAba('imersao')}>
              Registrar imersão
            </Button>
            <Button variant="soft" size="sm" icon="check2" onClick={() => irParaAba('tarefas')}>
              Gerar tarefas do escopo
            </Button>
            <Button variant="soft" size="sm" icon="sparkles" onClick={() => irParaAba('genna')}>
              Análise com o Genna
            </Button>
            <Button variant="primary" size="sm" icon="target" onClick={() => irParaAba('conferencia')}>
              Ir para a conferência
            </Button>
          </div>
        </Section>

        <Section title="Últimos eventos" action={<button type="button" className="text-xs font-medium text-brand hover:underline" onClick={() => irParaAba('historico')}>Ver todos</button>}>
          {ob.events.length === 0 ? (
            <p className="text-[13px] text-faint">Nenhum evento ainda.</p>
          ) : (
            <ul className="space-y-2.5">
              {ob.events.slice(0, 6).map((e) => (
                <li key={e.id} className="text-[13px]">
                  <span className="block font-medium text-fg">{rotuloEvento(e.tipo)}</span>
                  <span className="text-[11.5px] text-faint">
                    <Quando data={e.createdAt} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
