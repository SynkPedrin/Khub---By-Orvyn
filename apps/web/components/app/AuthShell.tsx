import Image from 'next/image';
import type { ReactNode } from 'react';

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Painel de marca com imagem de fundo */}
      <div className="brand-mesh relative hidden flex-col justify-between overflow-hidden p-12 text-white lg:flex">
        {/* imagem (coloque apps/web/public/Background-login.png) */}
        <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: "url('/Background-login.png')" }} aria-hidden />
        {/* overlay: escurece o fundo (texto/logo mais visíveis) + gradiente para PRETO na divisa (direita) e no rodapé */}
        <div
          className="absolute inset-0"
          aria-hidden
          style={{
            background:
              'linear-gradient(180deg, rgba(20,8,38,0.30) 0%, rgba(18,7,34,0.52) 60%, rgba(14,5,28,0.82) 100%),' +
              'linear-gradient(90deg, transparent 55%, rgba(43,12,74,0.85) 82%, rgba(26,7,48,0.96) 100%)',
          }}
        />

        <div className="relative z-10 flex items-center gap-3">
          <Image src="/logo.png" alt="ORVYN OS" width={88} height={88} unoptimized className="rounded-xl drop-shadow-[0_4px_16px_rgba(0,0,0,0.6)]" priority />
          <span className="text-3xl font-extrabold tracking-tight drop-shadow-[0_2px_10px_rgba(0,0,0,0.7)]">ORVYN <span className="text-white/85">OS</span></span>
        </div>

        <div className="relative z-10 max-w-md [text-shadow:0_2px_18px_rgba(0,0,0,0.55)]">
          <h1 className="text-4xl font-extrabold leading-tight tracking-tight">O CRM que já nasce pronto para o seu negócio.</h1>
          <p className="mt-4 text-lg text-white/90">Configurado, automatizado e operado por uma IA que entende do seu mercado.</p>
          <div className="mt-8 space-y-3">
            {['Pipelines e automações prontos por nicho', 'Nyro IA qualifica e atende seus leads', 'Integra WhatsApp, Meta, Google e Stripe'].map((t) => (
              <div key={t} className="flex items-center gap-3 text-white">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/25 backdrop-blur">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7" /></svg>
                </span>
                {t}
              </div>
            ))}
          </div>
        </div>

        <p className="relative z-10 text-sm text-white/75 [text-shadow:0_1px_8px_rgba(0,0,0,0.6)]">Powered by Nyro IA · © 2026 ORVYN OS</p>
      </div>

      {/* Formulário */}
      <div className="flex items-center justify-center bg-bg px-5 py-10">
        <div className="w-full max-w-sm animate-fade-in">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <Image src="/logo.png" alt="ORVYN OS" width={72} height={72} unoptimized className="rounded-lg" />
            <span className="text-xl font-extrabold tracking-tight text-fg">ORVYN <span className="text-brand">OS</span></span>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
