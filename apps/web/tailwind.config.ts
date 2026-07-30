import type { Config } from 'tailwindcss';

/**
 * Tokens de marca Orvyn (ver Nyro IA/cerebro/Arquitetura.md §6).
 * Roxo #7B2FBE (ação, do PRD) + tons off-white/cream. Cores semânticas
 * apontam para CSS vars (globals.css) para suportar light/dark.
 */
const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#7B2EFF',
          deep: '#6A1FE6',
          bright: '#A66BFF',
          lilac: '#C9B3FF',
          50: '#F4EEFF',
          100: '#E9DDFF',
          200: '#D6C0FF',
          300: '#BE9CFF',
          400: '#A66BFF',
          500: '#7B2EFF',
          600: '#6A1FE6',
          700: '#5717C2',
          800: '#3F0F8F',
          900: '#28085C',
        },
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        surface2: 'var(--surface-2)',
        surface3: 'var(--surface-3)',
        line: 'var(--border)',
        fg: 'var(--text)',
        muted: 'var(--muted)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      borderRadius: {
        xl: '1rem',
        '2xl': '1.25rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        card: '0 1px 2px rgba(17,17,17,0.03), 0 14px 40px -28px rgba(123,46,255,0.18)',
        pop: '0 12px 48px -16px rgba(17,17,17,0.18)',
        brand: '0 10px 26px -12px rgba(123,46,255,0.4)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'none' } },
        'scale-in': { from: { opacity: '0', transform: 'scale(0.97)' }, to: { opacity: '1', transform: 'none' } },
      },
      animation: {
        'fade-in': 'fade-in 0.25s ease both',
        'scale-in': 'scale-in 0.18s ease both',
      },
    },
  },
  plugins: [],
};

export default config;
