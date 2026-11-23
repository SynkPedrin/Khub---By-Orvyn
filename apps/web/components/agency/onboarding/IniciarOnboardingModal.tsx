'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, Modal, Select, useToast } from '@/components/kit';
import { Field } from '@/components/ui';
import { useAgency } from '@/components/agency/AgencyProvider';
import type { MembroAgencia } from '@/lib/agency';
import { SERVICOS_ESCOPO, codigoErro, mensagemErro, onboardingApi, type Escopo, type ServicoEscopo } from '@/lib/onboarding';

/**
 * Modal "Iniciar onboarding": subconta (só as sem onboarding ativo — o 409 da
 * API cobre corridas), escopo contratado (checkboxes) e responsável opcional.
 */
export function IniciarOnboardingModal({
  open,
  onClose,
  onIniciado,
  membros,
}: {
  open: boolean;
  onClose: () => void;
  onIniciado: (id: string) => void;
  membros: MembroAgencia[];
}) {
  const toast = useToast();
  const { clientes } = useAgency();
  const [clienteId, setClienteId] = useState('');
  const [escopo, setEscopo] = useState<Escopo>({ trafego: false, social: false, audiovisual: false, agente_ia: false, branding: false });
  const [responsavelId, setResponsavelId] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupadas, setOcupadas] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setClienteId('');
    setEscopo({ trafego: false, social: false, audiovisual: false, agente_ia: false, branding: false });
    setResponsavelId('');
    setErro(null);
    // Elegibilidade SEMPRE da lista sem filtro (a tela pode estar filtrada);
    // o 409 da API continua sendo a rede final contra corridas.
    onboardingApi
      .visao()
      .then((v) => setOcupadas(new Set(v.itens.filter((o) => o.status !== 'pronto').map((o) => o.cliente.id))))
      .catch(() => setOcupadas(new Set()));
  }, [open]);

  const elegiveis = useMemo(() => clientes.filter((c) => !ocupadas.has(c.id) && c.status !== 'archived'), [clientes, ocupadas]);
  const algumServico = Object.values(escopo).some(Boolean);

  const alternar = (s: ServicoEscopo) => setEscopo((e) => ({ ...e, [s]: !e[s] }));

  const iniciar = async () => {
    if (!clienteId || !algumServico || salvando) return;
    setSalvando(true);
    setErro(null);
    try {
      const ob = await onboardingApi.iniciar({ clientAccountId: clienteId, escopo, responsavelId: responsavelId || null });
      onIniciado(ob.id);
    } catch (e) {
      // Corrida: outra pessoa iniciou o onboarding desta subconta entre a listagem e o clique.
      if (codigoErro(e) === 'onboarding_duplicado') {
        setErro('Esta subconta já tem um onboarding em andamento. Atualize a página para vê-lo na lista.');
      } else {
        setErro(mensagemErro(e, 'Não foi possível iniciar o onboarding.'));
      }
      setSalvando(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Iniciar onboarding"
      description="Escolha a subconta e os serviços contratados. O checklist de homologação nasce filtrado por esse escopo."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={salvando}>
            Cancelar
          </Button>
          <Button variant="primary" loading={salvando} disabled={!clienteId || !algumServico} onClick={() => void iniciar()}>
            Iniciar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Subconta do cliente" hint={elegiveis.length === 0 ? 'Todas as subcontas já têm onboarding em andamento.' : undefined}>
          <Select value={clienteId} onChange={setClienteId} placeholder="Selecione a subconta" options={elegiveis.map((c) => ({ value: c.id, label: c.nome }))} />
        </Field>

        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-fg">Escopo contratado</legend>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {SERVICOS_ESCOPO.map((s) => (
              <label key={s.chave} className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-line px-3 py-2 text-[13px] text-fg transition hover:bg-surface2 has-[:checked]:border-brand-border has-[:checked]:bg-brand-softer">
                <input type="checkbox" className="checkbox" checked={escopo[s.chave]} onChange={() => alternar(s.chave)} />
                {s.rotulo}
              </label>
            ))}
          </div>
        </fieldset>

        <Field label="Responsável (opcional)">
          <Select value={responsavelId} onChange={setResponsavelId} placeholder="Sem responsável" options={membros.map((m) => ({ value: m.id, label: m.email }))} />
        </Field>

        {erro && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {erro}
          </p>
        )}
      </div>
    </Modal>
  );
}
