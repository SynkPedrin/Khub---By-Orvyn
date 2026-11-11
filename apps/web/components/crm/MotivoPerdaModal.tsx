'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { Button, Modal, Select, SkeletonLines, Textarea } from '@/components/kit';
import { pipelineApi, mensagemDeErro, type DadosPerda, type MotivoPerda } from '@/lib/pipeline';

interface Props {
  open: boolean;
  /** Título do negócio, ou "3 negócios" na ação em massa. */
  alvo: string;
  onClose: () => void;
  /** Recebe o motivo escolhido; a tela faz o PATCH/bulk e fecha. Erro lançado mantém o modal aberto. */
  onConfirm: (dados: DadosPerda) => Promise<void>;
}

/**
 * Marcar como perdido (Q2.1): pede o motivo (obrigatório se a conta tem
 * motivos ativos) e uma observação. Usado pelo drawer, pelo menu do card,
 * ao soltar numa etapa de perda e na ação em massa da Lista.
 */
export function MotivoPerdaModal({ open, alvo, onClose, onConfirm }: Props) {
  const [motivos, setMotivos] = useState<MotivoPerda[] | null>(null);
  const [erroCarga, setErroCarga] = useState(false);
  const [motivoId, setMotivoId] = useState('');
  const [obs, setObs] = useState('');
  const [tocado, setTocado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const selectId = useId();
  const obsId = useId();

  useEffect(() => {
    if (!open) return;
    setMotivoId(''); setObs(''); setTocado(false); setErro(''); setErroCarga(false); setMotivos(null);
    pipelineApi.motivos(true).then(setMotivos).catch(() => { setErroCarga(true); setMotivos([]); });
  }, [open]);

  const obrigatorio = (motivos?.length ?? 0) > 0;
  const faltaMotivo = obrigatorio && !motivoId;

  const confirmar = async () => {
    setTocado(true);
    if (faltaMotivo || !motivos) return;
    setSalvando(true);
    setErro('');
    try {
      await onConfirm({ motivoPerdaId: motivoId || null, motivoPerdaObs: obs.trim() || null });
    } catch (e) {
      setErro(mensagemDeErro(e, 'Não foi possível marcar como perdido.'));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Marcar como perdido"
      description={`Por que ${alvo} foi perdido? O motivo alimenta a análise de perdas.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button variant="danger" onClick={confirmar} loading={salvando} disabled={!motivos || erroCarga}>Marcar como perdido</Button>
        </>
      }
    >
      {!motivos ? (
        <SkeletonLines lines={3} label="Carregando motivos" />
      ) : erroCarga ? (
        <p role="alert" className="text-sm text-danger">Não foi possível carregar os motivos de perda. Feche e tente de novo.</p>
      ) : (
        <div className="space-y-4">
          <div>
            <label htmlFor={selectId} className="mb-1.5 block text-sm font-medium text-fg">
              Motivo{obrigatorio && <span className="text-danger" aria-hidden> *</span>}
            </label>
            {obrigatorio ? (
              <Select
                id={selectId}
                value={motivoId}
                onChange={setMotivoId}
                placeholder="Escolha o motivo"
                options={motivos.map((m) => ({ value: m.id, label: m.nome }))}
                aria-invalid={tocado && faltaMotivo}
                aria-describedby={tocado && faltaMotivo ? `${selectId}-erro` : undefined}
                required
              />
            ) : (
              <p className="text-sm text-muted">
                Nenhum motivo ativo. <Link href="/configuracoes?tab=motivos" className="text-brand hover:underline">Cadastre motivos</Link> para exigir na perda.
              </p>
            )}
            {tocado && faltaMotivo && <p id={`${selectId}-erro`} className="mt-1 text-xs text-danger">Escolha um motivo para continuar.</p>}
          </div>
          <div>
            <label htmlFor={obsId} className="mb-1.5 block text-sm font-medium text-fg">Observação <span className="font-normal text-muted">(opcional)</span></label>
            <Textarea id={obsId} value={obs} onChange={(e) => setObs(e.target.value)} maxLength={500} showCount rows={3} placeholder="Ex.: fechou com concorrente por preço menor" />
          </div>
          {erro && <p role="alert" className="text-sm text-danger">{erro}</p>}
        </div>
      )}
    </Modal>
  );
}
