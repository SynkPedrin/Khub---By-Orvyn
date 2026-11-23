'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Icon } from '@/components/icons';
import { Field } from '@/components/ui';
import { Button, Modal, Select, SkeletonDetail, Tabs, useToast } from '@/components/kit';
import { PageShell } from '@/components/revenue/Page';
import { ErrorState } from '@/components/revenue/States';
import { Quando } from '@/components/revenue/Quando';
import { useAgency } from '@/components/agency/AgencyProvider';
import { agency, type MembroAgencia } from '@/lib/agency';
import {
  SERVICOS_ESCOPO,
  STATUS_OB,
  STATUS_OB_ORDEM,
  mensagemErro,
  normalizarEscopo,
  onboardingApi,
  progressoPct,
  servicosAtivos,
  type DetalheOnboarding,
  type Escopo,
  type StatusOnboarding,
} from '@/lib/onboarding';
import { Progresso, StatusObPill, nomeMembro } from './pecas';
import { AbaVisaoGeral } from './abas/AbaVisaoGeral';
import { AbaImersao } from './abas/AbaImersao';
import { AbaConhecimento } from './abas/AbaConhecimento';
import { AbaInteligencia } from './abas/AbaInteligencia';
import { AbaGenna } from './abas/AbaGenna';
import { AbaAgente } from './abas/AbaAgente';
import { AbaTarefas } from './abas/AbaTarefas';
import { AbaEvidencias } from './abas/AbaEvidencias';
import { AbaConferencia } from './abas/AbaConferencia';
import { AbaHistorico } from './abas/AbaHistorico';

export type Aba = 'visao' | 'imersao' | 'dados' | 'inteligencia' | 'genna' | 'agente' | 'tarefas' | 'evidencias' | 'conferencia' | 'historico';

export const ABAS: { value: Aba; label: string }[] = [
  { value: 'visao', label: 'Visão geral' },
  { value: 'imersao', label: 'Imersão' },
  { value: 'dados', label: 'Dados do negócio' },
  { value: 'inteligencia', label: 'Inteligência e estratégia' },
  { value: 'genna', label: 'Genna' },
  { value: 'agente', label: 'Agente de IA' },
  { value: 'tarefas', label: 'Tarefas' },
  { value: 'evidencias', label: 'Arquivos e evidências' },
  { value: 'conferencia', label: 'Conferência final' },
  { value: 'historico', label: 'Histórico' },
];

const ehAba = (v: string | null): v is Aba => !!v && ABAS.some((a) => a.value === v);

export interface TabProps {
  ob: DetalheOnboarding;
  membros: MembroAgencia[];
  podeEditar: boolean;
  podeDecidir: boolean;
  recarregar: () => void;
  irParaAba: (aba: Aba) => void;
}

/**
 * Detalhe do onboarding de uma subconta: cabeçalho com status/etapa/escopo e
 * as 10 abas do processo. A aba ativa vive em `?aba=` — deep-link estável,
 * inclusive para o "voltar" da conferência.
 */
export function OnboardingDetalhe({ id }: { id: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const { contexto } = useAgency();
  const [ob, setOb] = useState<DetalheOnboarding | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [membros, setMembros] = useState<MembroAgencia[]>([]);
  const [editando, setEditando] = useState(false);

  const aba: Aba = ehAba(params.get('aba')) ? (params.get('aba') as Aba) : 'visao';
  const irParaAba = useCallback(
    (proxima: Aba) => {
      const url = new URL(window.location.href);
      if (proxima === 'visao') url.searchParams.delete('aba');
      else url.searchParams.set('aba', proxima);
      router.replace(`${url.pathname}${url.search}`, { scroll: false });
    },
    [router],
  );

  const carregar = useCallback(() => {
    setErro(null);
    onboardingApi
      .detalhe(id)
      .then(setOb)
      .catch((e) => setErro(mensagemErro(e, 'Não foi possível carregar o onboarding.')));
  }, [id]);

  useEffect(() => carregar(), [carregar]);
  useEffect(() => {
    agency.listarMembros().then(setMembros).catch(() => undefined);
  }, []);

  const podeEditar = !!contexto && contexto.role !== 'viewer';
  const podeDecidir = !!contexto && ['owner', 'admin'].includes(contexto.role);
  const verificadas = useMemo(() => (ob?.verifications ?? []).filter((v) => v.status === 'verificado').length, [ob]);
  const servicos = useMemo(() => (ob ? servicosAtivos(normalizarEscopo(ob.escopo)) : []), [ob]);

  const tabProps: TabProps | null = ob ? { ob, membros, podeEditar, podeDecidir, recarregar: carregar, irParaAba } : null;

  return (
    <PageShell>
      {erro ? (
        <ErrorState description={erro} onRetry={carregar} />
      ) : !ob || !tabProps ? (
        <SkeletonDetail label="Carregando onboarding" />
      ) : (
        <>
          {/* Cabeçalho */}
          <div className="card mb-5 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="t-display">{ob.cliente.nome}</h1>
                  <StatusObPill status={ob.status} />
                  {ob.status === 'pronto' && (
                    <span className="text-xs text-muted">
                      Aprovado {ob.aprovadoPor ? `por ${nomeMembro(membros, ob.aprovadoPor)} ` : ''}
                      <Quando data={ob.aprovadoEm} formato="data" />
                    </span>
                  )}
                </div>
                <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
                  <span>Iniciado <Quando data={ob.startedAt} formato="data" /></span>
                  <span>· {ob.etapaAtual ? `Etapa: ${ob.etapaAtual}` : 'Sem etapa definida'}</span>
                  <span>· {nomeMembro(membros, ob.responsavelId) || 'Sem responsável'}</span>
                </p>
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  {servicos.length ? (
                    servicos.map((s) => (
                      <span key={s} className="rounded-full bg-surface3 px-2 py-0.5 text-[11px] font-semibold text-muted">
                        {s}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-faint">Nenhum serviço no escopo</span>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Progresso verificadas={verificadas} total={ob.verifications.length} />
                <span className="text-xs tabular text-muted">{progressoPct(verificadas, ob.verifications.length)}% verificado</span>
                {podeEditar && ob.status !== 'pronto' && (
                  <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditando(true)}>
                    Editar
                  </Button>
                )}
              </div>
            </div>
          </div>

          <Tabs value={aba} onChange={irParaAba} items={ABAS} label="Seções do onboarding" idBase="ob" className="mb-5" />

          {aba === 'visao' && <AbaVisaoGeral {...tabProps} />}
          {aba === 'imersao' && <AbaImersao {...tabProps} />}
          {aba === 'dados' && <AbaConhecimento {...tabProps} />}
          {aba === 'inteligencia' && <AbaInteligencia {...tabProps} />}
          {aba === 'genna' && <AbaGenna {...tabProps} />}
          {aba === 'agente' && <AbaAgente {...tabProps} />}
          {aba === 'tarefas' && <AbaTarefas {...tabProps} />}
          {aba === 'evidencias' && <AbaEvidencias {...tabProps} />}
          {aba === 'conferencia' && <AbaConferencia {...tabProps} />}
          {aba === 'historico' && <AbaHistorico {...tabProps} />}
        </>
      )}

      {ob && <EditarOnboardingModal open={editando} onClose={() => setEditando(false)} ob={ob} membros={membros} podeDecidir={podeDecidir} onSalvo={() => { setEditando(false); carregar(); }} />}
    </PageShell>
  );
}

/** Edição de status/etapa/responsável/escopo. Escopo por member vira aprovação pendente (a API decide). */
function EditarOnboardingModal({
  open,
  onClose,
  ob,
  membros,
  podeDecidir,
  onSalvo,
}: {
  open: boolean;
  onClose: () => void;
  ob: DetalheOnboarding;
  membros: MembroAgencia[];
  podeDecidir: boolean;
  onSalvo: () => void;
}) {
  const toast = useToast();
  const [status, setStatus] = useState<StatusOnboarding>(ob.status);
  const [etapa, setEtapa] = useState(ob.etapaAtual ?? '');
  const [responsavelId, setResponsavelId] = useState(ob.responsavelId ?? '');
  const [escopo, setEscopo] = useState<Escopo>(normalizarEscopo(ob.escopo));
  const [justificativa, setJustificativa] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStatus(ob.status);
      setEtapa(ob.etapaAtual ?? '');
      setResponsavelId(ob.responsavelId ?? '');
      setEscopo(normalizarEscopo(ob.escopo));
      setJustificativa('');
      setErro(null);
    }
  }, [open, ob]);

  const escopoMudou = SERVICOS_ESCOPO.some((s) => escopo[s.chave] !== normalizarEscopo(ob.escopo)[s.chave]);

  const salvar = async () => {
    if (salvando) return;
    setSalvando(true);
    setErro(null);
    try {
      const r = await onboardingApi.atualizar(ob.id, {
        ...(status !== ob.status ? { status } : {}),
        ...(etapa.trim() !== (ob.etapaAtual ?? '') ? { etapaAtual: etapa.trim() || null } : {}),
        ...(responsavelId !== (ob.responsavelId ?? '') ? { responsavelId: responsavelId || null } : {}),
        ...(escopoMudou ? { escopo, justificativa: justificativa.trim() || undefined } : {}),
      });
      if (r.aprovacaoPendente) {
        toast.info('Mudança de escopo enviada para aprovação', { description: 'Um owner/admin da agência decide na aba Conferência final.' });
      } else {
        toast.success('Onboarding atualizado');
      }
      onSalvo();
    } catch (e) {
      setErro(mensagemErro(e, 'Não foi possível salvar.'));
      setSalvando(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Editar onboarding"
      description={podeDecidir ? 'Status, etapa, responsável e escopo.' : 'Status, etapa, responsável e escopo. Mudança de escopo passa por aprovação de owner/admin.'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={salvando}>
            Cancelar
          </Button>
          <Button variant="primary" loading={salvando} onClick={() => void salvar()}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Status" hint="A conclusão é feita pela Conferência final.">
            <Select value={status} onChange={(v) => setStatus(v as StatusOnboarding)} options={STATUS_OB_ORDEM.filter((s) => s !== 'pronto').map((s) => ({ value: s, label: STATUS_OB[s].label }))} />
          </Field>
          <Field label="Responsável">
            <Select value={responsavelId} onChange={setResponsavelId} placeholder="Sem responsável" options={membros.map((m) => ({ value: m.id, label: m.email }))} />
          </Field>
        </div>
        <Field label="Etapa atual" hint="Texto livre, ex.: “imersão agendada”.">
          <input className="input" maxLength={120} value={etapa} onChange={(e) => setEtapa(e.target.value)} />
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-fg">Escopo contratado</legend>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {SERVICOS_ESCOPO.map((s) => (
              <label key={s.chave} className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-line px-3 py-2 text-[13px] text-fg transition hover:bg-surface2 has-[:checked]:border-brand-border has-[:checked]:bg-brand-softer">
                <input type="checkbox" className="checkbox" checked={escopo[s.chave]} onChange={() => setEscopo((e) => ({ ...e, [s.chave]: !e[s.chave] }))} />
                {s.rotulo}
              </label>
            ))}
          </div>
        </fieldset>
        {escopoMudou && !podeDecidir && (
          <Field label="Justificativa da mudança de escopo">
            <input className="input" maxLength={500} value={justificativa} onChange={(e) => setJustificativa(e.target.value)} placeholder="Por que o escopo mudou?" />
          </Field>
        )}
        {escopoMudou && (
          <p className="rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-warning">
            <Icon name="alert" size={13} className="mr-1 inline" />
            Novos serviços adicionam verificações e tarefas ao checklist; serviços removidos não apagam o que já foi respondido.
          </p>
        )}
        {erro && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {erro}
          </p>
        )}
      </div>
    </Modal>
  );
}
