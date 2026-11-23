import Image from 'next/image';
import type { ReactNode } from 'react';
import { Icon } from '@/components/icons';

const BENEFICIOS: Array<{ icon: 'zap' | 'sparkles' | 'chat'; texto: string }> = [
  { icon: 'zap', texto: 'Pipeline e automações prontas para operar' },
  { icon: 'sparkles', texto: 'A NICO qualifica e prioriza seus leads' },
  { icon: 'chat', texto: 'WhatsApp e multicanais no mesmo lugar' },
];

function LogoMark({ light = false }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <Image src="/khub-mark.png" alt="" width={34} height={34} unoptimized className="object-contain" priority />
      <span className="flex flex-col gap-0.5">
        <span className={`text-base font-bold leading-none tracking-[0.2em] ${light ? 'text-white' : 'text-fg'}`}>KHUB</span>
        <span className={`text-2xs font-medium leading-none tracking-[0.26em] ${light ? 'text-white/75' : 'text-muted'}`}>by KHUB ai</span>
      </span>
    </div>
  );
}

export function AuthShell({
  children,
  headlineLines = ['Transforme', 'operação em'],
  headlineAccent = 'receita.',
  supportingCopy = 'Leads, conversas, automações e inteligência trabalhando no mesmo sistema.',
}: {
  children: ReactNode;
  /** Cada string vira sua própria linha — a referência quebra em pontos
   * específicos para dar peso, não deixa o navegador decidir sozinho. */
  headlineLines?: string[];
  /** Última linha, em destaque lime (sinal). */
  headlineAccent?: string;
  supportingCopy?: string;
}) {
  return (
    <div className="grid min-h-screen grid-cols-1 lg:h-screen lg:grid-cols-[52fr_48fr]">
      {/* ESQUERDA — momento de marca: aurora (mesh violeta+lime) com a arte
          oficial (/khub-wallpaper.jpg) como textura por cima. Único gradiente
          da tela; o painel do formulário fica limpo. */}
      <div className="aurora relative h-[32vh] overflow-hidden lg:h-full lg:border-r lg:border-line">
        <div
          className="absolute inset-0"
          aria-hidden
          style={{ backgroundImage: "url('/khub-wallpaper.jpg')", backgroundSize: 'cover', backgroundPosition: 'center', opacity: 0.5, filter: 'brightness(.72) saturate(1.15)' }}
        />
        {/* Véu de leitura: texto sempre sobre o escuro, nunca sobre a arte. */}
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden
          style={{
            background:
              'linear-gradient(90deg, color-mix(in oklab, var(--bg-0) 88%, transparent) 0%, color-mix(in oklab, var(--bg-0) 55%, transparent) 48%, color-mix(in oklab, var(--bg-0) 15%, transparent) 100%), linear-gradient(0deg, color-mix(in oklab, var(--bg-0) 55%, transparent) 0%, transparent 32%)',
          }}
        />

        {/* Logo — compacta no mobile (faixa de 32vh), tamanho pleno no
            desktop, na posição pedida. */}
        <div className="absolute left-5 top-5 z-10 lg:hidden">
          <LogoMark />
        </div>
        <div className="absolute z-10 hidden lg:block" style={{ left: 'clamp(40px, 4vw, 72px)', top: 48 }}>
          <LogoMark />
        </div>

        {/* Conteúdo do hero — só desktop; no mobile a faixa é curta demais
            pra caber headline/benefícios sem espremer. */}
        <div
          className="absolute inset-x-0 hidden lg:block"
          style={{ top: '55%', transform: 'translateY(-50%)', paddingLeft: 'clamp(40px, 4vw, 72px)', paddingRight: 'clamp(40px, 4vw, 72px)' }}
        >
          <div style={{ maxWidth: 580 }}>
            <h1 className="font-display text-hero-lg" style={{ color: 'var(--fg-1)' }}>
              {headlineLines.map((linha) => (
                <span key={linha} className="block">
                  {linha}
                </span>
              ))}
              <span className="block" style={{ color: 'var(--lime-300)' }}>
                {headlineAccent}
              </span>
            </h1>

            <p style={{ marginTop: 24, maxWidth: 480, fontSize: 'var(--text-lg)', lineHeight: 1.5, color: 'var(--fg-2)' }}>{supportingCopy}</p>

            <div style={{ marginTop: 32 }} className="space-y-4">
              {BENEFICIOS.map((b) => (
                <div key={b.texto} className="flex items-center gap-3.5">
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                    style={{ background: 'var(--fill-4)', border: '1px solid var(--line-2)' }}
                  >
                    <Icon name={b.icon} size={14} style={{ color: 'var(--lime-400)' }} />
                  </span>
                  <span style={{ fontSize: 'var(--text-base)', color: 'var(--fg-1)' }}>{b.texto}</span>
                </div>
              ))}
            </div>

            <div
              className="flex items-center gap-2.5"
              style={{ marginTop: 28, fontSize: 'var(--text-2xs)', letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--fg-3)', opacity: 0.9 }}
            >
              <span>Mais conversas</span>
              <span>·</span>
              <span>Mais oportunidades</span>
              <span>·</span>
              <span>Mais receita</span>
            </div>
          </div>
        </div>

        {/* Rodapé — só desktop */}
        <div className="absolute hidden lg:block" style={{ left: 'clamp(40px, 4vw, 72px)', bottom: 40 }}>
          <p style={{ fontSize: 'var(--text-xs)', lineHeight: 1.5, color: 'var(--fg-3)' }}>
            Sistema para um crescimento real.
            <br />© 2026 KHUB
          </p>
        </div>
      </div>

      {/* DIREITA — fundo neutro profundo, sem segundo gradiente: o formulário
          é trabalho, não palco. */}
      <div className="relative flex items-center justify-center overflow-hidden bg-bg px-6 py-10 lg:px-10">
        <div className="relative w-full animate-auth-in" style={{ maxWidth: 'min(440px, calc(100% - 80px))' }}>
          <div className="auth-card glass relative">
            <div
              className="absolute flex h-9 w-9 items-center justify-center rounded-card"
              style={{ right: 22, top: 22, background: 'var(--surface-2)', border: '1px solid var(--line-2)' }}
            >
              <Image src="/khub-mark.png" alt="" width={20} height={20} unoptimized className="object-contain opacity-90" />
            </div>
            {children}
          </div>

          <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-xs text-muted">
            <Icon name="lock" size={13} />
            Seus dados permanecem protegidos.
          </p>
        </div>
      </div>
    </div>
  );
}
