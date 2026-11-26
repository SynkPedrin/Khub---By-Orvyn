'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type Plataforma = 'ios' | 'android' | 'desktop';

function plataforma(): Plataforma {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}
const instalado = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const safariDoIOS = () => /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS|Instagram|FBAN|FBAV/.test(navigator.userAgent);

/** Ícone "Compartilhar" do Safari (quadrado com seta para cima). */
function IconeCompartilhar() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="inline align-[-3px]">
      <path d="M12 3v12M7 8l5-5 5 5" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}

function Passo({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 text-left">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#c6f432] text-sm font-bold text-[#0b0b0b]">{n}</span>
      <span className="pt-0.5 text-[15px] leading-relaxed text-white/85">{children}</span>
    </li>
  );
}

/** Página /baixar: instala o app (PWA) no celular, com o caminho certo para cada aparelho. */
export function InstalarApp() {
  const [p, setP] = useState<Plataforma | null>(null);
  const [pronto, setPronto] = useState(false);
  const [podeInstalar, setPodeInstalar] = useState(false);
  const [jaInstalado, setJaInstalado] = useState(false);
  const [url, setUrl] = useState('');

  useEffect(() => {
    setP(plataforma());
    setJaInstalado(instalado());
    setPodeInstalar(Boolean(window.__khubInstalar));
    setUrl(`${location.origin}/baixar`);
    setPronto(true);
    const sim = () => setPodeInstalar(true);
    const feito = () => { setPodeInstalar(false); setJaInstalado(true); };
    window.addEventListener('khub:instalavel', sim);
    window.addEventListener('khub:instalado', feito);
    return () => { window.removeEventListener('khub:instalavel', sim); window.removeEventListener('khub:instalado', feito); };
  }, []);

  const instalar = async () => {
    const pedido = window.__khubInstalar;
    if (!pedido) return;
    await pedido.prompt();
    const { outcome } = await pedido.userChoice;
    if (outcome === 'accepted') { window.__khubInstalar = null; setPodeInstalar(false); setJaInstalado(true); }
  };

  return (
    <main className="relative min-h-[100dvh] overflow-hidden bg-[#050505] text-white">
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-[#6c2bff]/30 blur-[120px]" />
      <div className="relative mx-auto flex min-h-[100dvh] max-w-md flex-col px-6 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[calc(2rem+env(safe-area-inset-top))]">
        <Link href="/" className="mb-10 self-start text-sm text-white/60">← Voltar ao site</Link>

        <div className="mb-8 flex flex-col items-center text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/pwa/icon-512.png" alt="KHUB" className="mb-5 h-24 w-24 rounded-[26px] shadow-[0_20px_60px_-15px_rgba(108,43,255,0.6)]" />
          <h1 className="font-display text-3xl font-bold tracking-tight text-white">App KHUB</h1>
          <p className="mt-2 max-w-[300px] text-[15px] leading-relaxed text-white/65">
            Aprove artes e roteiros, acompanhe a agenda e receba um aviso no celular sempre que tiver algo para aprovar.
          </p>
        </div>

        <ul className="mb-8 grid grid-cols-3 gap-2 text-center text-[12px] text-white/75">
          <li className="rounded-2xl border border-white/10 bg-white/[0.04] px-2 py-3"><span className="mb-1 block text-xl">✅</span>Aprovações</li>
          <li className="rounded-2xl border border-white/10 bg-white/[0.04] px-2 py-3"><span className="mb-1 block text-xl">📅</span>Agenda</li>
          <li className="rounded-2xl border border-white/10 bg-white/[0.04] px-2 py-3"><span className="mb-1 block text-xl">🔔</span>Avisos</li>
        </ul>

        <section className="rounded-3xl border border-white/10 bg-white/[0.05] p-5" aria-live="polite">
          {!pronto ? (
            <div className="h-24 animate-pulse rounded-2xl bg-white/5" />
          ) : jaInstalado ? (
            <div className="text-center">
              <p className="mb-4 text-[15px] text-white/80">O app já está instalado neste aparelho.</p>
              <Link href="/m" className="flex h-[52px] items-center justify-center rounded-2xl bg-[#c6f432] font-bold text-[#0b0b0b]">Abrir o app</Link>
            </div>
          ) : podeInstalar ? (
            <div className="text-center">
              <button type="button" onClick={instalar} className="flex h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-[#c6f432] text-[16px] font-bold text-[#0b0b0b] active:scale-[0.98]">
                Instalar o app
              </button>
              <p className="mt-3 text-xs text-white/50">Grátis, leve e sem loja de aplicativos. Fica na tela inicial como qualquer app.</p>
            </div>
          ) : p === 'ios' ? (
            <div>
              <p className="mb-4 font-bold">Instale no iPhone em 3 toques</p>
              {!safariDoIOS() && <p className="mb-4 rounded-xl bg-[#ffb020]/15 px-3 py-2 text-sm text-[#ffcf70]">Abra este link no <strong>Safari</strong> para instalar: {url}</p>}
              <ol className="space-y-4">
                <Passo n={1}>Toque em <strong>Compartilhar</strong> <IconeCompartilhar /> na barra do Safari.</Passo>
                <Passo n={2}>Role e toque em <strong>Adicionar à Tela de Início</strong>.</Passo>
                <Passo n={3}>Toque em <strong>Adicionar</strong>. Abra o KHUB pela tela inicial e entre com seu e-mail e senha.</Passo>
              </ol>
              <p className="mt-4 text-xs text-white/50">Depois de entrar, toque em “Ativar notificações” para receber os avisos (iOS 16.4 ou mais novo).</p>
            </div>
          ) : p === 'android' ? (
            <div>
              <p className="mb-4 font-bold">Instale no Android</p>
              <ol className="space-y-4">
                <Passo n={1}>Abra este link no <strong>Chrome</strong>.</Passo>
                <Passo n={2}>Toque no menu <strong>⋮</strong> e em <strong>Instalar app</strong> (ou “Adicionar à tela inicial”).</Passo>
                <Passo n={3}>Abra o KHUB pela tela inicial e entre com seu e-mail e senha.</Passo>
              </ol>
            </div>
          ) : (
            <div className="text-center">
              <p className="mb-2 font-bold">Abra no seu celular</p>
              <p className="mb-4 text-sm text-white/65">Acesse o endereço abaixo pelo navegador do celular para instalar o app:</p>
              <p className="mb-4 select-all break-all rounded-xl bg-black/40 px-3 py-3 font-mono text-sm text-[#c6f432]">{url}</p>
              <p className="text-xs text-white/50">No computador, use o KHUB normalmente pelo navegador.</p>
            </div>
          )}
        </section>

        <div className="mt-auto pt-8 text-center">
          <p className="mb-3 text-sm text-white/60">Já tem acesso?</p>
          <Link href="/login?next=/m" className="flex h-[52px] items-center justify-center rounded-2xl border border-white/15 font-bold text-white active:scale-[0.98]">Entrar com e-mail e senha</Link>
        </div>
      </div>
    </main>
  );
}
