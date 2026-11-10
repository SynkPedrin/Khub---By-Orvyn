/**
 * MODO DEMONSTRAÇÃO
 * =================
 *
 * Fronteira única entre dado de vitrine e dado de cliente.
 *
 * Regra inegociável: **nada em `lib/demo/` pode ser lido quando o modo demo
 * está desligado**, e o modo demo nunca liga sozinho. Um número de vitrine
 * exibido como número real é pior do que uma tela vazia: destrói a confiança
 * no produto inteiro.
 *
 * Ligar: `NEXT_PUBLIC_KHUB_DEMO=1` no `.env.local`.
 *
 * Quando ligado, toda tela mostra o selo "DEMO" — o operador precisa saber,
 * sem clicar em nada, que está olhando dado fabricado.
 */
export function modoDemo(): boolean {
  // A vitrine é útil em desenvolvimento, mas nunca pode ser ativada por
  // acidente num bundle de produção. Produção deve refletir exclusivamente
  // dados persistidos e estados reais de integração.
  if (process.env.NODE_ENV === 'production') return false;
  // NEXT_PUBLIC_ORVYN_DEMO: nome legado (ADR-0041), aceito até os ambientes migrarem.
  return (process.env.NEXT_PUBLIC_KHUB_DEMO ?? process.env.NEXT_PUBLIC_ORVYN_DEMO) === '1';
}

/**
 * Rótulo do selo exibido no cabeçalho quando o modo demo está ativo.
 * `null` em produção — não há selo a mostrar.
 */
export function seloDemo(): string | null {
  return modoDemo() ? 'Dados de demonstração' : null;
}
