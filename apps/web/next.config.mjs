/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // QA/CI isolado: NEXT_DIST_DIR=.next-qa evita sobrescrever o .next de um `next dev` em execução.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // `standalone` existe para o Dockerfile (server.js autocontido). No Vercel ele
  // atrapalha: a plataforma monta o próprio runtime e o modo standalone gera um
  // segundo servidor que nunca é usado. VERCEL=1 é setado pela própria Vercel.
  output: process.env.VERCEL ? undefined : 'standalone',
  // O cérebro (vault Obsidian) é lido do filesystem em runtime; leitura fora do
  // diretório do app é intencional e controlada em lib/cerebro.ts.
  experimental: {
    outputFileTracingIncludes: {
      '/**': ['../../Nyro IA/cerebro/**/*.md'],
    },
  },

  /**
   * Compatibilidade de URLs — KHUB OS → KHUB Revenue OS.
   *
   * DELIBERADAMENTE SEM REDIRECT das rotas antigas de módulo.
   *
   * `/contatos`, `/inbox` e `/nyro` são telas que funcionam de verdade,
   * ligadas à API e ao banco. As novas (`/leads`, `/conversas`, `/ia`)
   * ainda dependem do modo demo para exibir conteúdo. Redirecionar agora
   * trocaria funcionalidade real por vitrine — exatamente o contrário do
   * que a migração deve fazer.
   *
   * As antigas seguem acessíveis e já herdaram a nova identidade visual
   * (o design system foi trocado preservando os nomes de classe). Os
   * redirects entram quando as novas telas tiverem paridade de dados
   * reais; o mapeamento está em `docs/KHUB_REVENUE_MIGRATION.md`.
   */
};

export default nextConfig;
