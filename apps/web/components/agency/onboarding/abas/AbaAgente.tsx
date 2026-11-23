'use client';

import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/icons';
import { cx, Field } from '@/components/ui';
import { Button, Textarea, useToast } from '@/components/kit';
import { Section } from '@/components/revenue/Page';
import { Quando } from '@/components/revenue/Quando';
import {
  APROVACAO_AGENTE,
  CENARIOS_TESTE_AGENTE,
  ESPEC_AGENTE_SECOES,
  STATUS_TESTE,
  aprovacaoDosTestes,
  mensagemErro,
  onboardingApi,
  rotuloCampo,
  testesPorCenario,
  type StatusTesteAgente,
} from '@/lib/onboarding';
import { TOM } from '@/lib/agency-daily';
import { VazioLocal, nomeMembro } from '../pecas';
import type { TabProps } from '../OnboardingDetalhe';

/**
 * Agente de IA: especificação estruturada (17 seções), system prompt e a
 * checklist dos 11 cenários de teste. `approval_status` é derivado no backend
 * — só vira `aprovado` com os 11 cenários aprovados. Sem `agente_ia` no
 * escopo, a aba mostra o estado "não contratado".
 */
export function AbaAgente({ ob, membros, podeEditar, recarregar }: TabProps) {
  if (!ob.escopo.agente_ia) {
    return (
      <Section title="Agente de IA">
        <VazioLocal icone="sparkles" titulo="Agente de IA não contratado" texto="Este serviço não está no escopo do onboarding. Para incluí-lo, edite o escopo no cabeçalho (mudança de escopo por member passa por aprovação)." />
      </Section>
    );
  }
  return <AgenteConteudo ob={ob} membros={membros} podeEditar={podeEditar} recarregar={recarregar} />;
}

function AgenteConteudo({ ob, membros, podeEditar, recarregar }: Pick<TabProps, 'ob' | 'membros' | 'podeEditar' | 'recarregar'>) {
  const agent = ob.agent;
  const finalizado = ob.status === 'pronto';
  const editavel = podeEditar && !finalizado;
  const aprovacao = agent?.approvalStatus ?? 'rascunho';
  const selo = APROVACAO_AGENTE[aprovacao] ?? APROVACAO_AGENTE.rascunho;

  return (
    <div className="space-y-5">
      <Section
        title="Especificação do agente"
        action={
          <span className={cx('inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 text-[11.5px] font-semibold', TOM[selo.tom].pill)}>
            <span aria-hidden className={cx('inline-block h-2 w-2 rounded-full', TOM[selo.tom].dot)} /> {selo.label}
          </span>
        }
        info="A fonte da verdade do comportamento do agente do cliente; o agente é criado na subconta numa etapa futura"
      >
        <SpecEditor ob={ob} editavel={editavel} recarregar={recarregar} />
        {agent?.atualizadoPor && (
          <p className="mt-3 text-[11.5px] text-faint">
            Última edição por {nomeMembro(membros, agent.atualizadoPor)} · <Quando data={agent.updatedAt} />
          </p>
        )}
      </Section>

      <Section
        title="Cenários de teste"
        info={agent ? 'Os 11 cenários precisam estar aprovados para o agente virar “Aprovado”' : 'Salve a especificação antes de registrar testes'}
      >
        {!agent ? (
          <VazioLocal icone="edit" titulo="Salve a especificação primeiro" texto="Os testes são registrados sobre uma especificação existente." />
        ) : (
          <ChecklistTestes ob={ob} editavel={editavel} recarregar={recarregar} />
        )}
      </Section>
    </div>
  );
}

function especParaTexto(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.join('\n');
  return JSON.stringify(v, null, 2);
}

function SpecEditor({ ob, editavel, recarregar }: { ob: TabProps['ob']; editavel: boolean; recarregar: () => void }) {
  const toast = useToast();
  const agent = ob.agent;
  const espec = useMemo(() => agent?.especificacao ?? {}, [agent]);
  const campos = useMemo(() => {
    const base = ESPEC_AGENTE_SECOES.map((s) => s.chave);
    const extras = Object.keys(espec).filter((k) => !base.includes(k as (typeof base)[number]));
    return [...ESPEC_AGENTE_SECOES, ...extras.map((chave) => ({ chave, rotulo: rotuloCampo(chave) }))];
  }, [espec]);

  const [nome, setNome] = useState(agent?.nome ?? '');
  const [valores, setValores] = useState<Record<string, string>>({});
  const [prompt, setPrompt] = useState(agent?.systemPrompt ?? '');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    setNome(agent?.nome ?? '');
    setPrompt(agent?.systemPrompt ?? '');
    setValores(Object.fromEntries(campos.map((c) => [c.chave, especParaTexto(espec[c.chave])])));
  }, [agent, campos, espec]);

  const sujo = useMemo(() => {
    if (nome !== (agent?.nome ?? '') || prompt !== (agent?.systemPrompt ?? '')) return true;
    return campos.some((c) => (valores[c.chave] ?? '') !== especParaTexto(espec[c.chave]));
  }, [nome, prompt, valores, campos, espec, agent]);

  const salvar = async () => {
    if (salvando) return;
    setSalvando(true);
    try {
      const especificacao = Object.fromEntries(campos.map((c) => [c.chave, valores[c.chave] ?? '']).filter(([, v]) => v !== ''));
      await onboardingApi.salvarAgente(ob.id, { nome: nome.trim() || null, especificacao, systemPrompt: prompt.trim() || null });
      toast.success('Especificação salva');
      recarregar();
    } catch (e) {
      toast.error('Não foi possível salvar', { description: mensagemErro(e, 'Tente novamente.') });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="space-y-4">
      <Field label="Nome do agente">
        <input className="input" maxLength={120} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="ex.: Nina" disabled={!editavel} />
      </Field>
      <div className="grid gap-4 md:grid-cols-2">
        {campos.map((c) => (
          <label key={c.chave} className="block">
            <span className="mb-1.5 block text-[13px] font-medium text-fg">{c.rotulo}</span>
            <Textarea value={valores[c.chave] ?? ''} onChange={(e) => setValores((v) => ({ ...v, [c.chave]: e.target.value }))} rows={2} disabled={!editavel} placeholder="Não definido" />
          </label>
        ))}
      </div>
      <Field label="System prompt" hint="Instrução mestre do agente, derivada da especificação acima.">
        <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={6} maxLength={20000} showCount className="font-mono text-[12.5px]" disabled={!editavel} />
      </Field>
      {editavel && (
        <div className="flex items-center gap-3">
          <Button size="sm" variant="primary" loading={salvando} disabled={!sujo} onClick={() => void salvar()}>
            Salvar especificação
          </Button>
          {sujo && <span className="text-xs text-muted">Alterações não salvas</span>}
        </div>
      )}
    </div>
  );
}

function ChecklistTestes({ ob, editavel, recarregar }: { ob: TabProps['ob']; editavel: boolean; recarregar: () => void }) {
  const toast = useToast();
  const [obs, setObs] = useState<Record<string, string>>({});
  const [registrando, setRegistrando] = useState<string | null>(null);
  const porCenario = useMemo(() => testesPorCenario(ob.agent?.testes ?? []), [ob.agent]);
  const aprovados = CENARIOS_TESTE_AGENTE.filter((c) => porCenario.get(c.cenario)?.status === 'aprovado').length;
  const preview = aprovacaoDosTestes(ob.agent?.testes ?? []);

  const registrar = async (cenario: string, status: StatusTesteAgente) => {
    if (registrando) return;
    setRegistrando(cenario);
    try {
      await onboardingApi.registrarTeste(ob.id, { cenario, status, observacao: obs[cenario]?.trim() || undefined });
      toast.success(`Cenário ${status === 'aprovado' ? 'aprovado' : status === 'reprovado' ? 'reprovado' : 'marcado como pendente'}`);
      recarregar();
    } catch (e) {
      toast.error('Não foi possível registrar o teste', { description: mensagemErro(e, 'Tente novamente.') });
    } finally {
      setRegistrando(null);
    }
  };

  return (
    <div>
      <p className="mb-3 text-[13px] text-muted">
        <span className="font-semibold tabular text-fg">{aprovados}/{CENARIOS_TESTE_AGENTE.length}</span> cenários aprovados
        {preview !== (ob.agent?.approvalStatus ?? 'rascunho') && ' (o selo atualiza ao salvar)'}
      </p>
      <ul className="divide-y divide-line">
        {CENARIOS_TESTE_AGENTE.map((c) => {
          const atual = porCenario.get(c.cenario);
          const status = atual?.status ?? 'pendente';
          return (
            <li key={c.cenario} className="py-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-medium text-fg">{rotuloCampo(c.cenario)}</span>
                  <span className="block text-xs text-muted">{c.descricao}</span>
                </span>
                <span className={cx('inline-flex h-[22px] items-center rounded-full px-2 text-[11.5px] font-semibold', TOM[STATUS_TESTE[status].tom].pill)}>{STATUS_TESTE[status].label}</span>
                {editavel && (
                  <span className="segbar" role="group" aria-label={`Resultado de ${c.descricao}`}>
                    {(['aprovado', 'reprovado', 'pendente'] as const).map((s) => (
                      <button key={s} type="button" className="seg" disabled={registrando === c.cenario || status === s} aria-pressed={status === s} onClick={() => void registrar(c.cenario, s)}>
                        {STATUS_TESTE[s].label}
                      </button>
                    ))}
                  </span>
                )}
              </div>
              {atual?.observacao && <p className="mt-1 text-xs text-muted">Observação: {atual.observacao}</p>}
              {editavel && (
                <input
                  className="input mt-2 h-8 text-[12.5px]"
                  maxLength={1000}
                  placeholder="Observação do teste (opcional, entra no próximo registro)"
                  value={obs[c.cenario] ?? ''}
                  onChange={(e) => setObs((o) => ({ ...o, [c.cenario]: e.target.value }))}
                />
              )}
            </li>
          );
        })}
      </ul>
      {aprovados < CENARIOS_TESTE_AGENTE.length && (
        <p className="mt-3 rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-warning">
          <Icon name="alert" size={13} className="mr-1 inline" />
          A verificação “Agente de IA testado” só fica verificada quando os {CENARIOS_TESTE_AGENTE.length} cenários estiverem aprovados.
        </p>
      )}
    </div>
  );
}
