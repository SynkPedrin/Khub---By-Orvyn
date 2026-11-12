'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '@/components/icons';
import { Button, Modal, useToast } from '@/components/kit';
import { ApiError, providerLabel } from '@/lib/api-error';
import { avaliacoes } from '@/lib/avaliacoes';

/**
 * Ação "Pedir avaliação" do perfil do contato (Q4.4). Manda o link curto
 * rastreável da avaliação configurada em Configurações > Avaliações.
 */
export function PedirAvaliacao({ contato }: { contato: { id: string; nome: string; telefone: string | null; email: string | null; optedOutAt?: string | null } }) {
  const toast = useToast();
  const [aberto, setAberto] = useState(false);
  const [canal, setCanal] = useState<'whatsapp' | 'email'>(contato.telefone ? 'whatsapp' : 'email');
  const [enviando, setEnviando] = useState(false);
  const [semConfig, setSemConfig] = useState(false);
  const [conectar, setConectar] = useState<string | null>(null);
  const bloqueado = !!contato.optedOutAt;
  const temCanal = canal === 'whatsapp' ? !!contato.telefone : !!contato.email;

  const enviar = async () => {
    setEnviando(true);
    setSemConfig(false);
    setConectar(null);
    try {
      const r = await avaliacoes.pedir(contato.id, canal);
      if (r.status === 'enviado') {
        toast.success('Pedido de avaliação enviado', { description: `Link enviado por ${canal === 'whatsapp' ? 'WhatsApp' : 'e-mail'}.` });
        setAberto(false);
      } else {
        toast.error('O pedido não saiu', { description: r.erro ?? 'Tente de novo em instantes.' });
      }
    } catch (e) {
      if (e instanceof ApiError && e.configRequired) setConectar(e.configRequired.provider);
      else if (e instanceof ApiError && /configure o link/i.test(e.message)) setSemConfig(true);
      else toast.error('Não foi possível pedir a avaliação', { description: e instanceof Error ? e.message : undefined });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <>
      <Button variant="ghost" icon="star" onClick={() => setAberto(true)} disabled={bloqueado} title={bloqueado ? 'O contato pediu para não receber mensagens' : undefined}>
        Pedir avaliação
      </Button>
      <Modal
        open={aberto}
        onClose={() => setAberto(false)}
        title="Pedir avaliação"
        description={`Manda para ${contato.nome} o link de avaliação com rastreio de clique.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAberto(false)}>Cancelar</Button>
            <Button icon="send" loading={enviando} disabled={!temCanal || semConfig} onClick={() => void enviar()}>Enviar pedido</Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Canal">
          {(['whatsapp', 'email'] as const).map((c) => {
            const ok = c === 'whatsapp' ? !!contato.telefone : !!contato.email;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={canal === c}
                disabled={!ok}
                onClick={() => setCanal(c)}
                className={`flex items-center gap-2 rounded-xl border px-3 py-3 text-sm disabled:opacity-50 ${canal === c ? 'border-brand bg-brand-soft font-semibold text-fg' : 'border-line text-muted hover:bg-surface2'}`}
              >
                <Icon name={c === 'whatsapp' ? 'whatsapp' : 'mail'} size={16} />
                {c === 'whatsapp' ? 'WhatsApp' : 'E-mail'}
                {!ok && <span className="ml-auto text-xs">sem {c === 'whatsapp' ? 'telefone' : 'e-mail'}</span>}
              </button>
            );
          })}
        </div>
        {semConfig && (
          <p className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
            Configure o link de avaliação da empresa primeiro.
            <Link href="/configuracoes?tab=avaliacoes" className="btn btn-sm ml-auto">Configurar</Link>
          </p>
        )}
        {conectar && (
          <p className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
            O canal de envio não está conectado.
            <Link href="/configuracoes?tab=integracoes" className="btn btn-sm ml-auto">Conectar {providerLabel(conectar)}</Link>
          </p>
        )}
      </Modal>
    </>
  );
}
