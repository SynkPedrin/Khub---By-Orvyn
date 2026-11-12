'use client';

import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { Confirm, Drawer, Skeleton, useToast } from '@/components/kit';
import { ErrorState } from '@/components/revenue/States';
import { ConfigRequired } from '@/components/app/ConfigRequired';
import { WhatsAppConnectModal } from '@/components/app/WhatsAppConnectModal';
import { ApiError } from '@/lib/api-error';
import { canaisApi, type CartaoCanal, type EstadoCartao } from '@/lib/canais';
import { whatsappApi } from '@/lib/whatsapp';
import { CANAL_DA_REDE, CanalIcone } from './CanalIcone';

const ESTADO: Record<EstadoCartao, { rotulo: string; classe: string }> = {
  conectado: { rotulo: 'Conectado', classe: 'pill-success' },
  nao_conectado: { rotulo: 'Não conectado', classe: '' },
  precisa_credencial: { rotulo: 'Precisa de credencial', classe: 'pill-warning' },
  indisponivel: { rotulo: 'Indisponível', classe: '' },
};

const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * "Canais conectados" (Conversas, db/063): um cartão por rede com estado,
 * conectar e desconectar. WhatsApp reaproveita o fluxo de QR/vínculo que já
 * existe; Instagram/Messenger e YouTube vão ao OAuth oficial da rede; TikTok
 * explica por que não conecta. Só owner/admin gerenciam (integrations.manage):
 * os demais veem o aviso.
 */
export function CanaisConectados({ open, onClose, onMudou }: { open: boolean; onClose: () => void; onMudou: () => void }) {
  const toast = useToast();
  const [cartoes, setCartoes] = useState<CartaoCanal[] | null>(null);
  const [erro, setErro] = useState<'proibido' | 'falha' | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [whatsapp, setWhatsapp] = useState(false);
  const [confirmar, setConfirmar] = useState<{ rotulo: string; acao: () => Promise<void> } | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setCartoes(await canaisApi.cartoes());
    } catch (e) {
      setErro(e instanceof ApiError && e.status === 403 ? 'proibido' : 'falha');
    }
  }, []);

  useEffect(() => {
    if (open) void carregar();
  }, [open, carregar]);

  const conectar = async (c: CartaoCanal) => {
    if (c.conectarVia === 'whatsapp') return setWhatsapp(true);
    if (c.conectarVia !== 'meta' && c.conectarVia !== 'youtube') return;
    setOcupado(c.rede);
    try {
      const { url } = await canaisApi.urlConexao(c.conectarVia);
      window.location.href = url;
    } catch (e) {
      const cr = e instanceof ApiError ? e.configRequired : null;
      toast.error(cr ? 'Falta configurar a credencial' : 'Não consegui iniciar a conexão', { description: cr ? cr.missing.join(', ') : e instanceof ApiError ? e.message : undefined });
      setOcupado(null);
    }
  };

  const desconectar = (c: CartaoCanal, conta: CartaoCanal['contas'][number]) =>
    setConfirmar({
      rotulo: `${c.titulo}: ${conta.nome}`,
      acao: async () => {
        if (c.rede === 'whatsapp') await whatsappApi.disconnect();
        else await canaisApi.desconectar(conta.id);
        toast.success(`${c.titulo} desconectado`);
        await carregar();
        onMudou();
      },
    });

  const sincronizar = async (contaId: string) => {
    setOcupado(contaId);
    try {
      const r = await canaisApi.sincronizar(contaId);
      toast.success(r.novos ? `${r.novos} comentário(s) novo(s)` : 'Nenhum comentário novo');
      await carregar();
      onMudou();
    } catch (e) {
      toast.error('Não consegui sincronizar', { description: e instanceof ApiError ? e.message : undefined });
    } finally {
      setOcupado(null);
    }
  };

  return (
    <>
      <Drawer open={open} onClose={onClose} title="Canais conectados" description="Conecte suas redes e atenda tudo aqui em Conversas." width="sm:max-w-xl">
        {erro === 'proibido' && (
          <ErrorState title="Só administradores conectam canais" description="Peça a quem administra a conta para conectar o WhatsApp e as redes sociais." />
        )}
        {erro === 'falha' && <ErrorState title="Não consegui carregar os canais" description="Tente de novo em instantes." onRetry={() => void carregar()} />}
        {!erro && !cartoes && (
          <div className="space-y-3" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-28 w-full rounded-2xl" />
            ))}
          </div>
        )}
        {cartoes && (
          <ul className="space-y-3">
            {cartoes.map((c) => {
              const est = ESTADO[c.estado];
              const canal = CANAL_DA_REDE[c.rede] ?? c.titulo;
              return (
                <li key={c.rede} className="rounded-2xl border border-line bg-surface p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--fill-4)]">
                      <CanalIcone canal={canal} size={24} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-[15px] font-semibold text-fg">{c.titulo}</h3>
                        <span className={cx('pill', est.classe)}>{est.rotulo}</span>
                      </div>
                      <p className="mt-0.5 text-[13px] text-muted">{c.descricao}</p>
                    </div>
                    {c.estado !== 'indisponivel' && c.estado !== 'precisa_credencial' && c.conectarVia && (
                      <button type="button" className={cx('btn btn-sm shrink-0', c.estado === 'conectado' ? 'btn-soft' : 'btn-primary')} disabled={ocupado === c.rede} onClick={() => void conectar(c)}>
                        <Icon name={c.estado === 'conectado' ? 'plus' : 'link'} size={14} />
                        {c.estado === 'conectado' ? (c.rede === 'whatsapp' ? 'Ver conexão' : 'Adicionar conta') : 'Conectar'}
                      </button>
                    )}
                  </div>

                  <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={`O que o ${c.titulo} oferece`}>
                    {c.recursos.map((r) => (
                      <li key={r.rotulo} title={r.motivo} className={cx('pill', r.disponivel ? 'pill-brand' : 'line-through decoration-current/50')}>
                        <Icon name={r.disponivel ? 'check' : 'minus'} size={11} /> {r.rotulo}
                      </li>
                    ))}
                  </ul>
                  {c.recursos.some((r) => r.motivo) && (
                    <ul className="mt-2 space-y-0.5 text-[12px] text-muted">
                      {c.recursos.filter((r) => r.motivo).map((r) => (
                        <li key={r.rotulo}>{r.motivo}</li>
                      ))}
                    </ul>
                  )}

                  {c.gate && (
                    <div className="mt-3">
                      <ConfigRequired provider={c.gate.provider} missing={c.gate.missing} compact />
                    </div>
                  )}
                  {c.motivo && <p className="mt-3 rounded-lg bg-[var(--fill-4)] px-3 py-2 text-[12.5px] text-muted">{c.motivo}</p>}

                  {c.contas.length > 0 && (
                    <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
                      {c.contas.map((conta) => (
                        <li key={conta.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium text-fg">{conta.nome}</span>
                            {conta.erro ? (
                              <span className="block text-[12px] text-warning">{conta.erro}</span>
                            ) : conta.ultimaSyncAt ? (
                              <span className="block text-[12px] text-muted">Sincronizado em {quando(conta.ultimaSyncAt)}</span>
                            ) : null}
                          </span>
                          {c.rede === 'youtube' && (
                            <button type="button" className="btn btn-ghost btn-sm" disabled={ocupado === conta.id} onClick={() => void sincronizar(conta.id)}>
                              <Icon name="refresh" size={13} /> Sincronizar
                            </button>
                          )}
                          <button type="button" className="btn btn-ghost btn-sm text-danger" onClick={() => desconectar(c, conta)}>
                            Desconectar
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {c.docs.length > 0 && (
                    <p className="mt-3 text-[11.5px] text-muted">
                      Documentação oficial:{' '}
                      {c.docs.map((d, i) => (
                        <a key={d} href={d} target="_blank" rel="noreferrer" className="underline decoration-current/40 underline-offset-2 hover:text-fg">
                          {i ? `, ${i + 1}` : '1'}
                        </a>
                      ))}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Drawer>

      {whatsapp && (
        <WhatsAppConnectModal
          onClose={() => setWhatsapp(false)}
          onConnected={() => {
            setWhatsapp(false);
            toast.success('WhatsApp conectado');
            void carregar();
            onMudou();
          }}
        />
      )}

      <Confirm
        open={!!confirmar}
        onClose={() => setConfirmar(null)}
        title="Desconectar canal?"
        description={confirmar ? `${confirmar.rotulo} deixa de receber e enviar mensagens pelo KHUB. As conversas já recebidas continuam aqui.` : undefined}
        confirmLabel="Desconectar"
        onConfirm={async () => {
          const c = confirmar;
          setConfirmar(null);
          try {
            await c?.acao();
          } catch (e) {
            toast.error('Não consegui desconectar', { description: e instanceof ApiError ? e.message : undefined });
          }
        }}
      />
    </>
  );
}
