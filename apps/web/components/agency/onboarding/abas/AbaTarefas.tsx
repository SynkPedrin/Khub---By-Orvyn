'use client';

import { useEffect, useState } from 'react';
import { Button, Modal, Select, useToast } from '@/components/kit';
import { Section } from '@/components/revenue/Page';
import { Prazo, Pessoa } from '@/components/agency/daily/pecas';
import { STATUS as STATUS_DAILY, codigo, type Status as StatusDaily } from '@/lib/agency-daily';
import { PAPEIS_TAREFA, mensagemErro, onboardingApi, rotuloCampo, type PapelTarefa } from '@/lib/onboarding';
import { LinkTarefaDaily, VazioLocal } from '../pecas';
import type { TabProps } from '../OnboardingDetalhe';

/**
 * Tarefas: as tarefas reais criadas no Daily da agência e vinculadas a este
 * onboarding, com critério de aceite do template e deep-link para a gaveta
 * do Daily. "Gerar tarefas do escopo" aceita o mapa papel → membro.
 */
export function AbaTarefas({ ob, membros, podeEditar, recarregar }: TabProps) {
  const [gerando, setGerando] = useState(false);
  const finalizado = ob.status === 'pronto';
  const ativas = ob.tarefas.filter((t) => t.task && !t.task.arquivadaEm);

  return (
    <Section
      title="Tarefas vinculadas"
      info="Criadas no Daily da agência a partir do template do escopo"
      action={
        podeEditar && !finalizado ? (
          <Button size="sm" variant="primary" icon="plus" onClick={() => setGerando(true)}>
            Gerar tarefas do escopo
          </Button>
        ) : undefined
      }
    >
      {ativas.length === 0 ? (
        <VazioLocal
          icone="check2"
          titulo="Nenhuma tarefa gerada ainda"
          texto="Gere as tarefas do escopo: o template cria as tarefas no Daily da equipe, filtradas pelos serviços contratados. Rodar de novo não duplica."
          acao={podeEditar && !finalizado ? <Button size="sm" icon="plus" onClick={() => setGerando(true)}>Gerar tarefas</Button> : undefined}
        />
      ) : (
        <ul className="divide-y divide-line">
          {ativas.map((t) => {
            const task = t.task!;
            const responsavel = membros.find((m) => m.id === task.responsavelId);
            return (
              <li key={t.id} className="py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-[11px] text-faint">{codigo(task.numero)}</span>
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-fg">{task.titulo}</span>
                  <span className="rounded-md bg-surface3 px-1.5 py-px text-[11px] font-medium text-muted">{STATUS_DAILY[task.status as StatusDaily]?.label ?? task.status}</span>
                  <Prazo tarefa={{ prazoEm: task.prazoEm, status: task.status as StatusDaily }} />
                  <Pessoa pessoa={responsavel ? { id: responsavel.id, nome: responsavel.email } : null} comNome />
                  <LinkTarefaDaily taskId={task.id}>Abrir no Daily</LinkTarefaDaily>
                </div>
                <p className="mt-1 text-[11.5px] text-faint">
                  {t.secao ? `${rotuloCampo(t.secao)} · ` : ''}
                  Critério de aceite: {t.criterioAceite ?? '—'}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      <GerarTarefasModal open={gerando} onClose={() => setGerando(false)} obId={ob.id} membros={membros} onGerado={recarregar} />
    </Section>
  );
}

/** Gera as tarefas do template no Daily, com atribuição opcional papel → membro. */
function GerarTarefasModal({ open, onClose, obId, membros, onGerado }: { open: boolean; onClose: () => void; obId: string; membros: TabProps['membros']; onGerado: () => void }) {
  const toast = useToast();
  const [atribuicoes, setAtribuicoes] = useState<Partial<Record<PapelTarefa, string>>>({});
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setAtribuicoes({});
      setErro(null);
    }
  }, [open]);

  const gerar = async () => {
    if (salvando) return;
    setSalvando(true);
    setErro(null);
    try {
      const r = await onboardingApi.gerarTarefas(obId, atribuicoes);
      if (r.criadas.length === 0) toast.info('Nenhuma tarefa nova', { description: `As ${r.ignoradas} tarefas do template já existiam (dedupe por título).` });
      else toast.success(`${r.criadas.length} tarefa(s) criadas no Daily`, { description: r.ignoradas ? `${r.ignoradas} já existiam e foram ignoradas.` : undefined });
      onClose();
      onGerado();
    } catch (e) {
      setErro(mensagemErro(e, 'Não foi possível gerar as tarefas.'));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Gerar tarefas do escopo"
      description="O template cria as tarefas no Daily, filtradas pelos serviços contratados. Atribua cada papel a um membro — sem atribuição, as tarefas nascem sem responsável."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={salvando}>
            Cancelar
          </Button>
          <Button variant="primary" loading={salvando} onClick={() => void gerar()}>
            Gerar tarefas
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {PAPEIS_TAREFA.map((p) => (
          <label key={p.chave} className="flex items-center gap-3">
            <span className="w-44 shrink-0 text-[13px] font-medium text-fg">{p.rotulo}</span>
            <Select
              value={atribuicoes[p.chave] ?? ''}
              onChange={(v) => setAtribuicoes((a) => ({ ...a, [p.chave]: v || undefined }))}
              placeholder="Sem responsável"
              options={membros.map((m) => ({ value: m.id, label: m.email }))}
            />
          </label>
        ))}
        {erro && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {erro}
          </p>
        )}
      </div>
    </Modal>
  );
}
