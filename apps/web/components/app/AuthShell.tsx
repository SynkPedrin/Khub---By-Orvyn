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
        <span className={`text-[14px] font-bold leading-none tracking-[0.2em] ${light ? 'text-white' : 'text-fg'}`}>KHUB</span>
        <span className={`text-[9px] font-medium leading-none tracking-[0.26em] ${light ? 'text-white/75' : 'text-muted'}`}>by KHUB ai</span>
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
  /** Última linha, em destaque (degradê violeta). */
  headlineAccent?: string;
  supportingCopy?: string;
}) {
  return (
    <div className="grid min-h-screen grid-cols-1 lg:h-screen lg:grid-cols-[52fr_48fr]">
      {/* ESQUERDA — vídeo real, painel estrutural (não é fundo da tela
          inteira: ocupa 52% no desktop, e vira uma faixa curta no mobile). */}
      <div className="relative h-[32vh] overflow-hidden lg:h-full lg:border-r lg:border-[rgba(20,20,30,0.06)]">
        {/* Novo papel de parede KHUB (branco, roxo e verde) com véu claro à
            esquerda, onde mora o texto. Imagem estática e leve. */}
        <div
          className="absolute inset-0"
          aria-hidden
          style={{ backgroundImage: "url('/khub-fundo.jpg')", backgroundSize: 'cover', backgroundPosition: 'center' }}
        />
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden
          style={{ background: 'linear-gradient(90deg, rgba(248,248,252,.88) 0%, rgba(248,248,252,.62) 48%, rgba(248,248,252,.12) 100%)' }}
        />

        {/* Logo — compacta no mobile (faixa de 32vh), tamanho pleno no
            desktop, na posição pedida. */}
        <div className="absolute left-5 top-5 z-10 lg:hidden">
          <LogoMark />
        </div>
        <div className="absolute z-10 hidden lg:block" style={{ left: 'clamp(40px, 4vw, 72px)', top: 48 }}>
          <LogoMark />
        </div>

        {/* Conteúdo do hero — só desktop; no mobile a faixa de vídeo é curta
            demais pra caber headline/benefícios sem espremer. */}
        <div
          className="absolute inset-x-0 hidden lg:block"
          style={{ top: '55%', transform: 'translateY(-50%)', paddingLeft: 'clamp(40px, 4vw, 72px)', paddingRight: 'clamp(40px, 4vw, 72px)' }}
        >
          <div style={{ maxWidth: 580 }}>
            <h1
              style={{
                fontSize: 'clamp(52px, 4.2vw, 76px)',
                lineHeight: 0.96,
                fontWeight: 650,
                letterSpacing: '-0.045em',
                color: '#171526',
              }}
            >
              {headlineLines.map((linha) => (
                <span key={linha} className="block">
                  {linha}
                </span>
              ))}
              <span
                className="block"
                style={{ background: 'linear-gradient(135deg, #963EFF, #792EFF)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}
              >
                {headlineAccent}
              </span>
            </h1>

            <p style={{ marginTop: 24, maxWidth: 480, fontSize: 17, lineHeight: 1.5, color: '#6B6980' }}>{supportingCopy}</p>

            <div style={{ marginTop: 32 }} className="space-y-4">
              {BENEFICIOS.map((b) => (
                <div key={b.texto} className="flex items-center gap-3.5">
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full backdrop-blur-[8px]"
                    style={{ background: 'rgba(255,255,255,.72)', border: '1px solid rgba(91,75,130,.12)' }}
                  >
                    <Icon name={b.icon} size={14} style={{ color: '#792EFF' }} />
                  </span>
                  <span style={{ fontSize: 14.5, color: '#171526' }}>{b.texto}</span>
                </div>
              ))}
            </div>

            <div
              className="flex items-center gap-2.5"
              style={{ marginTop: 28, fontSize: 10.5, letterSpacing: '.14em', textTransform: 'uppercase', color: '#6B6980', opacity: 0.8 }}
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
          <p style={{ fontSize: 12, lineHeight: 1.5, color: '#6B6980' }}>
            Sistema para um crescimento real.
            <br />© 2026 KHUB
          </p>
        </div>
      </div>

      {/* DIREITA — superfície off-white, sem vídeo por trás. */}
      <div className="relative flex items-center justify-center overflow-hidden bg-[#F8F6F2] px-6 py-10 lg:px-10">
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden
          style={{ background: 'radial-gradient(circle at 50% 38%, rgba(123,46,255,.045), transparent 42%)' }}
        />

        <div className="relative w-full animate-auth-in" style={{ maxWidth: 'min(440px, calc(100% - 80px))' }}>
          <div className="auth-card relative">
            <div
              className="absolute flex h-9 w-9 items-center justify-center rounded-xl"
              style={{ right: 22, top: 22, background: 'rgba(123,46,255,.05)', border: '1px solid rgba(123,46,255,.08)' }}
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
