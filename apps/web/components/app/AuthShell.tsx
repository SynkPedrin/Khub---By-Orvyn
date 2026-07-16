import Image from 'next/image';
import type { ReactNode } from 'react';

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Painel de marca */}
      <div className="brand-mesh relative hidden flex-col justify-between overflow-hidden p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <Image src="/logo.png" alt="ORVYN OS" width={88} height={88} unoptimized className="rounded-xl" priority />
          <span className="text-2xl font-extrabold tracking-tight">ORVYN <span className="text-white/70">OS</span></span>
        </div>

        <div className="max-w-md">
          <h1 className="text-4xl font-extrabold leading-tight tracking-tight">
            O CRM que já nasce pronto para o seu negócio.
          </h1>
          <p className="mt-4 text-lg text-white/80">
            Configurado, automatizado e operado por uma IA que entende do seu mercado.
          </p>
          <div className="mt-8 space-y-3">
            {['Pipelines e automações prontos por nicho', 'Nyro IA qualifica e atende seus leads', 'Integra WhatsApp, Meta, Google e Stripe'].map((t) => (
              <div key={t} className="flex items-center gap-3 text-white/90">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/20">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7" /></svg>
                </span>
                {t}
              </div>
            ))}
          </div>
        </div>

        <p className="text-sm text-white/60">Powered by Nyro IA · © 2026 ORVYN OS</p>
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
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
