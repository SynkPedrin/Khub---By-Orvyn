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
          DEFAULT: '#7B2FBE',
          deep: '#5B1E9E',
          bright: '#9B4DE0',
          lilac: '#C9A0F0',
          50: '#F6EEFC',
          100: '#EADCF8',
          200: '#D6B9F0',
          300: '#BE90E7',
          400: '#A25FDD',
          500: '#7B2FBE',
          600: '#66259E',
          700: '#511E7E',
          800: '#3C165E',
          900: '#280F3F',
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
        xl: '0.9rem',
        '2xl': '1.15rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        card: '0 1px 2px rgba(40,15,63,0.05), 0 10px 30px -18px rgba(123,47,190,0.28)',
        pop: '0 8px 40px -12px rgba(40,15,63,0.28)',
        brand: '0 8px 24px -8px rgba(123,47,190,0.55)',
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
