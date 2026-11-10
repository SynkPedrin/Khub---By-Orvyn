import type { Config } from 'tailwindcss';

/**
 * KHUB Revenue OS — tokens do Tailwind.
 *
 * Fonte da verdade são as CSS vars de `app/globals.css`. Aqui só as
 * expomos como utilitárias, para que `bg-surface`, `text-muted` e
 * `rounded-lg` sigam o tema (incluindo dark) sem duplicar valores.
 *
 * Regra: nenhum valor de cor literal em componente. Se falta um token,
 * ele nasce em globals.css primeiro.
 */
const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Marca — ACENTO, nunca fundo dominante
        brand: {
          DEFAULT: 'var(--brand)',
          deep: 'var(--brand-deep)',
          2: 'var(--brand-2)',
          soft: 'var(--brand-soft)',
          softer: 'var(--brand-softer)',
          border: 'var(--brand-border)',
        },
        // KHUB — acento secundário (atividade/IA da NICO), nunca botão geral
        lime: {
          DEFAULT: 'var(--khub-lime)',
          soft: 'var(--khub-lime-soft)',
          border: 'var(--khub-lime-border)',
          ink: 'var(--khub-lime-ink)',
        },
        // Superfícies
        bg: 'var(--base-2)',
        surface: 'var(--base-0)',
        surface2: 'var(--base-1)',
        surface3: 'var(--base-3)',
        line: 'var(--border)',
        'line-strong': 'var(--border-strong)',
        // Texto
        fg: 'var(--text)',
        muted: 'var(--text-2)',
        faint: 'var(--text-3)',
        // Semânticas
        success: { DEFAULT: 'var(--success)', soft: 'var(--success-soft)', border: 'var(--success-border)' },
        warning: { DEFAULT: 'var(--warning)', soft: 'var(--warning-soft)', border: 'var(--warning-border)' },
        danger: { DEFAULT: 'var(--danger)', soft: 'var(--danger-soft)', border: 'var(--danger-border)' },
        info: { DEFAULT: 'var(--info)', soft: 'var(--info-soft)', border: 'var(--info-border)' },
        // Canais
        channel: {
          whatsapp: 'var(--ch-whatsapp)',
          instagram: 'var(--ch-instagram)',
          email: 'var(--ch-email)',
          linkedin: 'var(--ch-linkedin)',
          site: 'var(--ch-site)',
        },
        // LP marketing ("/") — variante clara de marca usada só na landing
        // e nas telas de auth (mesmo hex de --brand, ver globals.css).
        offwhite: 'var(--offwhite)',
        ink: 'var(--ink)',
        amethyst: {
          DEFAULT: 'var(--amethyst)',
          deep: 'var(--amethyst-deep)',
          glow: 'var(--amethyst-glow)',
          highlight: 'var(--amethyst-highlight)',
          soft: 'var(--amethyst-soft)',
          softer: 'var(--amethyst-softer)',
          border: 'var(--amethyst-border)',
        },
      },
      fontFamily: {
        // Inter (next/font) em todas as plataformas; SF Pro só como reserva — ADR-0036.
        sans: ['var(--font-sans)', '-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        // Escala compacta B2B: densidade alta sem perder legibilidade
        '2xs': ['11px', { lineHeight: '1.4' }],
        xs: ['12px', { lineHeight: '1.45' }],
        sm: ['13px', { lineHeight: '1.5' }],
        base: ['14px', { lineHeight: '1.5' }],
        md: ['15px', { lineHeight: '1.5' }],
        lg: ['16px', { lineHeight: '1.4' }],
        xl: ['20px', { lineHeight: '1.3' }],
        '2xl': ['24px', { lineHeight: '1.25' }],
        '3xl': ['30px', { lineHeight: '1.15' }],
        '4xl': ['34px', { lineHeight: '1.15' }],
      },
      // Radius concêntrico (Liquid Glass): 8 / 12 / 16 / 22. Controles são
      // cápsulas (`rounded-full`); sheets/shell usam --r-2xl (28) via CSS.
      borderRadius: {
        sm: 'var(--r-sm)',
        DEFAULT: 'var(--r-md)',
        md: 'var(--r-md)',
        lg: 'var(--r-lg)',
        xl: 'var(--r-xl)',
        full: 'var(--r-full)',
      },
      boxShadow: {
        xs: 'var(--sh-xs)',
        sm: 'var(--sh-sm)',
        DEFAULT: 'var(--sh-sm)',
        md: 'var(--sh-md)',
        lg: 'var(--sh-lg)',
        pop: 'var(--sh-pop)',
        none: 'none',
        // aliases legados
        card: 'var(--sh-xs)',
        brand: 'var(--sh-sm)',
        // LP marketing — nomes próprios (`lp-card`/`lp-pop`) para não colidir
        // com `shadow-card`/`shadow-pop` já usados no app autenticado.
        'lp-card': '0 1px 2px rgba(17, 17, 17, 0.04), 0 8px 24px -12px rgba(123, 46, 255, 0.16)',
        'lp-pop': '0 24px 60px -20px rgba(123, 46, 255, 0.35)',
      },
      maxWidth: {
        // LP marketing — largura máxima do container da landing.
        content: '1240px',
      },
      spacing: {
        sidebar: 'var(--sidebar-w)',
        topbar: 'var(--topbar-h)',
      },
      zIndex: {
        sticky: 'var(--z-sticky)',
        sidebar: 'var(--z-sidebar)',
        topbar: 'var(--z-topbar)',
        dropdown: 'var(--z-dropdown)',
        drawer: 'var(--z-drawer)',
        modal: 'var(--z-modal)',
        toast: 'var(--z-toast)',
      },
      transitionTimingFunction: {
        khub: 'var(--ease)',
        spring: 'var(--ease-spring)',
      },
      transitionDuration: {
        fast: '120ms',
        DEFAULT: '200ms',
        slow: '320ms',
      },
      screens: {
        sm: '640px',
        md: '768px',
        lg: '1024px',
        xl: '1280px',
        '2xl': '1440px',
        '3xl': '1680px',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'none' } },
        'scale-in': { from: { opacity: '0', transform: 'scale(0.96)' }, to: { opacity: '1', transform: 'none' } },
      },
      animation: {
        'fade-in': 'fade-in 320ms var(--ease-out) both',
        'scale-in': 'scale-in 320ms var(--ease-spring) both',
      },
    },
  },
  plugins: [],
};

export default config;
