'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { diasRestantes, whatsappLinkApi, type LinkPublicoWa } from '@/lib/whatsapp-qr';

/**
 * Link de conexão do WhatsApp (ADR-0058): o cliente da agência abre, lê o QR
 * Code com o celular e o WhatsApp dele passa a cair no KHUB. Sem login — o
 * token do link (7 dias) é a credencial. O QR troca sozinho a cada ~20 s.
 */
const PASSOS = [
  'Abra o WhatsApp no celular do número que vai atender.',
  'Toque em Mais opções (⋮) ou Configurações e depois em Aparelhos conectados.',
  'Toque em Conectar um aparelho e aponte a câmera para o QR Code ao lado.',
];

export default function ConectarWhatsAppPage({ params }: { params: { token: string } }) {
  const token = params.token;
  const [dados, setDados] = useState<LinkPublicoWa | null>(null);
  const [erro, setErro] = useState<{ texto: string; definitivo: boolean } | null>(null);
  const [gerando, setGerando] = useState(false);
  const vivo = useRef(true);

  const carregar = useCallback(async () => {
    try {
      const d = await whatsappLinkApi.ver(token);
      if (!vivo.current) return;
      setDados(d);
      setErro(null);
    } catch (e) {
      if (!vivo.current) return;
      const status = (e as { status?: number }).status ?? 0;
      setErro({ texto: (e as Error).message, definitivo: status === 404 || status === 410 });
    }
  }, [token]);

  useEffect(() => {
    vivo.current = true;
    void carregar();
    return () => { vivo.current = false; };
  }, [carregar]);

  // Enquanto não conecta, acompanha de perto (QR novo e "conectado" aparecem na hora).
  useEffect(() => {
    if (erro?.definitivo || dados?.estado === 'conectado') return;
    const t = window.setInterval(() => void carregar(), 2500);
    return () => window.clearInterval(t);
  }, [carregar, dados?.estado, erro?.definitivo]);

  const novoQr = async () => {
    setGerando(true);
    try {
      await whatsappLinkApi.novoQr(token);
      await carregar();
    } catch (e) {
      setErro({ texto: (e as Error).message, definitivo: false });
    } finally {
      setGerando(false);
    }
  };

  if (erro?.definitivo) {
    return (
      <Moldura>
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-warning-soft text-warning"><Icon name="alert" size={26} /></span>
          <h1 className="text-xl font-bold text-fg">Link indisponível</h1>
          <p className="max-w-sm text-sm text-muted">{erro.texto}</p>
        </div>
      </Moldura>
    );
  }

  const conectado = dados?.estado === 'conectado';
  return (
    <Moldura>
      <header className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#25D366] text-white"><Icon name="whatsapp" size={24} /></span>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-fg">Conectar o WhatsApp{dados ? ` de ${dados.empresa}` : ''}</h1>
          <p className="mt-0.5 text-sm text-muted">
            As conversas passam a aparecer no KHUB, com histórico, foto e mensagens em tempo real.
            {dados && !conectado && <> Este link vale por mais {diasRestantes(dados.expiraEm)} dia(s).</>}
          </p>
        </div>
      </header>

      {conectado ? (
        <div className="mt-8 flex flex-col items-center gap-3 rounded-2xl border border-success-border bg-success-soft px-6 py-10 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-success text-white"><Icon name="check" size={32} /></span>
          <h2 className="text-lg font-bold text-fg">WhatsApp conectado!</h2>
          <p className="max-w-sm text-sm text-muted">
            {dados?.numero ? <>O número <strong className="text-fg">{dados.numero}</strong> já está ligado ao KHUB. </> : null}
            O histórico de conversas está sendo trazido agora. Você já pode fechar esta página.
          </p>
        </div>
      ) : (
        <div className="mt-8 grid items-center gap-8 md:grid-cols-[1fr_auto]">
          <ol className="space-y-4">
            {PASSOS.map((p, i) => (
              <li key={p} className="flex gap-3 text-[15px] text-fg">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-fg text-[13px] font-bold text-bg">{i + 1}</span>
                <span className="pt-0.5">{p}</span>
              </li>
            ))}
            <li className="flex gap-2 rounded-xl bg-surface2 px-3 py-2.5 text-[13px] text-muted">
              <Icon name="info" size={15} className="mt-0.5 shrink-0" />
              Abriu no celular? Abra este mesmo link num computador para ler o QR Code com o celular.
            </li>
          </ol>

          <div className="flex flex-col items-center gap-3">
            <div className="grid h-[280px] w-[280px] place-items-center rounded-2xl border-2 border-line-strong bg-white p-3 shadow-sm">
              {dados?.qr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={dados.qr} alt="QR Code para conectar o WhatsApp" className="h-full w-full object-contain" />
              ) : (
                <div className="flex flex-col items-center gap-2 text-center text-sm text-neutral-600">
                  <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-neutral-300 border-t-neutral-700" aria-hidden />
                  {dados?.estado === 'erro' || dados?.estado === 'desconectado' ? 'A conexão caiu.' : 'Gerando o QR Code…'}
                </div>
              )}
            </div>
            <p className="text-xs text-muted" role="status">{dados?.qr ? 'O código se renova sozinho. Mantenha esta página aberta.' : 'Pode levar alguns segundos.'}</p>
            <button type="button" className="btn btn-sm" onClick={() => void novoQr()} disabled={gerando}>
              <Icon name="refresh" size={14} /> {gerando ? 'Gerando…' : 'Gerar novo QR Code'}
            </button>
          </div>
        </div>
      )}

      {erro && !erro.definitivo && <p className="mt-6 rounded-xl bg-warning-soft px-4 py-2.5 text-sm text-warning" role="alert">{erro.texto}</p>}
    </Moldura>
  );
}

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-bg px-4 py-10 text-fg sm:py-16">
      <div className="card mx-auto w-full max-w-3xl p-6 sm:p-8">{children}</div>
      <p className="mx-auto mt-4 max-w-3xl text-center text-xs text-muted">
        Conexão segura feita pelo KHUB. Nenhuma senha é pedida. Para desconectar depois, vá em Aparelhos conectados no WhatsApp.
      </p>
    </main>
  );
}
