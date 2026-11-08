'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { ConfigRequired } from '@/components/app/ConfigRequired';
import { ApiError } from '@/lib/api-error';
import { whatsappApi, type ConexaoWhatsApp } from '@/lib/whatsapp';

/**
 * Fluxo real de conexão do WhatsApp (Evolution API).
 *
 * Diferente do resto do marketplace (que é um redirect OAuth), aqui a
 * interação é: pedir QR → mostrar → perguntar o estado real em intervalos →
 * fechar sozinho quando conectar. Nunca cria instância nova a cada clique —
 * isso é responsabilidade do backend (`WhatsAppConnectionService`); aqui só
 * chamamos `connect()` e confiamos que ele decide reaproveitar ou criar.
 */
export function WhatsAppConnectModal({ onClose, onConnected }: { onClose: () => void; onConnected: () => void }) {
  const [conexao, setConexao] = useState<ConexaoWhatsApp | null>(null);
  const [gated, setGated] = useState<{ provider: string; missing: string[] } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rodadaRef = useRef(0);
  const conectarRef = useRef<Promise<ConexaoWhatsApp> | null>(null);
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;
  const vivoRef = useRef(true);

  const pararPolling = useCallback(() => {
    rodadaRef.current += 1;
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = null;
  }, []);

  const iniciarPolling = useCallback((inicial: ConexaoWhatsApp) => {
    pararPolling();
    const rodada = rodadaRef.current;
    const limite = Date.now() + 120_000;
    let atual = inicial;
    let falhas = 0;
    // Polls sequenciais: uma resposta lenta não sobrepõe a seguinte.
    // Sem imagem ou após expiração, buscar também um QR novo no servidor.
    const consultar = async () => {
      if (!vivoRef.current || rodada !== rodadaRef.current) return;
      if (Date.now() >= limite) {
        pararPolling();
        setErro('O pareamento não foi confirmado. Gere um novo QR para tentar novamente.');
        return;
      }
      try {
        const renovar = !atual.qr?.qrImageDataUrl || Date.parse(atual.qr.expiresAt) <= Date.now();
        if (renovar) setConexao((c) => c ? { ...c, qr: undefined } : c);
        const s = await whatsappApi.status(renovar);
        if (!vivoRef.current || rodada !== rodadaRef.current) return;
        falhas = 0;
        atual = { ...s, qr: s.qr ?? (renovar ? undefined : atual.qr) };
        setConexao(atual);
        if (s.estado === 'conectado') {
          pararPolling();
          onConnectedRef.current();
          return;
        }
        if (s.estado === 'erro' || s.estado === 'nao_configurado') {
          pararPolling();
          setErro('O serviço do WhatsApp não confirmou a conexão. Tente gerar o QR novamente.');
          return;
        }
      } catch {
        if (!vivoRef.current || rodada !== rodadaRef.current) return;
        if (++falhas >= 3) {
          pararPolling();
          setErro('Não foi possível consultar o WhatsApp. Verifique a conexão e tente novamente.');
          return;
        }
      }
      if (vivoRef.current && rodada === rodadaRef.current) pollRef.current = setTimeout(consultar, 2500);
    };
    pollRef.current = setTimeout(consultar, 2500);
  }, [pararPolling]);

  const conectar = useCallback(async () => {
    pararPolling();
    const rodada = rodadaRef.current;
    setCarregando(true);
    setConexao(null);
    setErro(null);
    setGated(null);
    try {
      // StrictMode pode remontar o efeito: compartilhar a chamada em voo
      // evita duas criações/configurações simultâneas da mesma instância.
      conectarRef.current ??= whatsappApi.connect();
      const c = await conectarRef.current;
      if (!vivoRef.current || rodada !== rodadaRef.current) return;
      if (c.estado === 'nao_configurado') {
        setGated({ provider: 'evolution', missing: ['EVOLUTION_BASE_URL', 'EVOLUTION_API_KEY'] });
      } else {
        setConexao(c);
        if (c.estado === 'conectado') onConnectedRef.current();
        else iniciarPolling(c);
      }
    } catch (e) {
      if (!vivoRef.current || rodada !== rodadaRef.current) return;
      const cr = e instanceof ApiError ? e.configRequired : null;
      if (cr) setGated(cr);
      else setErro('Não consegui gerar o QR agora. Tente de novo em alguns segundos.');
    } finally {
      conectarRef.current = null;
      if (vivoRef.current) setCarregando(false);
    }
  }, [iniciarPolling, pararPolling]);

  useEffect(() => {
    vivoRef.current = true;
    void conectar();
    return () => {
      vivoRef.current = false;
      pararPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="lg-backdrop fixed inset-0 z-[70] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Conectar WhatsApp">
      <div className="lg-sheet w-full max-w-sm animate-scale-in p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-fg">Conectar WhatsApp</h2>
          <button onClick={onClose} className="rounded-full p-1 text-muted hover:bg-surface2" aria-label="Fechar">
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="mt-4">
          {gated ? (
            <ConfigRequired provider={gated.provider} missing={gated.missing} />
          ) : erro ? (
            <div className="text-center">
              <p className="text-sm text-danger">{erro}</p>
              <button onClick={conectar} className="btn btn-primary mt-3 !py-1.5 !text-xs">
                Gerar novo QR
              </button>
            </div>
          ) : carregando && !conexao?.qr ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
              <p className="text-xs text-muted">Preparando a conexão do WhatsApp…</p>
            </div>
          ) : conexao?.estado === 'conectado' ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                <Icon name="check" size={24} />
              </span>
              <p className="text-sm font-semibold text-fg">WhatsApp conectado</p>
              {conexao.numero && <p className="text-xs text-muted">{conexao.numero}</p>}
            </div>
          ) : conexao?.qr?.qrImageDataUrl ? (
            <div className="flex flex-col items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={conexao.qr.qrImageDataUrl} alt="QR code para conectar o WhatsApp" width={240} height={240} className="rounded-lg border border-line" />
              <p className="flex items-center gap-1.5 text-xs text-muted">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                Aguardando leitura, abra o WhatsApp {'>'} Aparelhos conectados
              </p>
              {conexao.qr.pairingCode && (
                <p className="text-[11px] text-muted">
                  Ou use o código: <span className="font-mono font-semibold text-fg">{conexao.qr.pairingCode}</span>
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
              <p className="text-center text-xs text-muted">Aguardando o QR Code do WhatsApp. Ele aparecerá automaticamente.</p>
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-[11px] text-faint">
          A conexão fica no servidor do KHUB, nada de credencial no navegador.
        </p>
      </div>
    </div>
  );
}
