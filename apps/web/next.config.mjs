/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Build enxuto para Docker (server.js standalone). Dev e `next start` seguem iguais.
  output: 'standalone',
  // O cérebro (vault Obsidian) é lido do filesystem em runtime; leitura fora do
  // diretório do app é intencional e controlada em lib/cerebro.ts.
  experimental: {
    outputFileTracingIncludes: {
      '/**': ['../../Nyro IA/cerebro/**/*.md'],
    },
  },
};

export default nextConfig;
