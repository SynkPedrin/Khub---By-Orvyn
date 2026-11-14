/** Maior valor aceito (coluna INTEGER do Postgres, em centavos). */
export const MAX_CENTAVOS = 2_147_483_647;

/**
 * Dinheiro digitado pela pessoa → centavos inteiros, sem passar por float.
 *
 * Aceita "R$ 1.234,56", "1234,5", "1234.56", "1.234" (milhar no padrão
 * brasileiro), "1,234.56" (padrão americano) e espaços. O separador decimal é
 * o ÚLTIMO entre vírgula e ponto quando os dois aparecem; ponto sozinho seguido
 * de exatamente 3 dígitos é milhar ("1.234" = mil duzentos e trinta e quatro).
 * Mais de 2 casas decimais: arredonda meio para cima no centavo.
 */
export function lerValor(v: string | null | undefined): number | null {
  const s = (v ?? '').replace(/r\$/gi, '').replace(/\s+/g, '');
  if (!s || !/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;

  const ultVirgula = s.lastIndexOf(',');
  const ultPonto = s.lastIndexOf('.');
  let inteiro: string;
  let fracao = '';
  let milhar: ',' | '.' | null = null;

  if (ultVirgula >= 0 && ultPonto >= 0) {
    const dec = ultVirgula > ultPonto ? ',' : '.';
    milhar = dec === ',' ? '.' : ',';
    const i = s.lastIndexOf(dec);
    inteiro = s.slice(0, i);
    fracao = s.slice(i + 1);
    if (fracao.includes(milhar) || fracao.includes(dec)) return null;
  } else if (ultVirgula >= 0) {
    if (s.indexOf(',') !== ultVirgula) return null; // "1,234,567" não é valor brasileiro
    inteiro = s.slice(0, ultVirgula);
    fracao = s.slice(ultVirgula + 1);
  } else if (ultPonto >= 0) {
    const pontos = s.split('.').length - 1;
    const depois = s.slice(ultPonto + 1);
    if (pontos > 1 || depois.length === 3) {
      milhar = '.';
      inteiro = s;
    } else {
      inteiro = s.slice(0, ultPonto);
      fracao = depois;
    }
  } else {
    inteiro = s;
  }

  if (milhar) {
    if (inteiro && !new RegExp(`^\\d{1,3}(\\${milhar}\\d{3})*$`).test(inteiro)) return null;
    inteiro = inteiro.split(milhar).join('');
  }
  if (!/^\d*$/.test(inteiro) || !/^\d*$/.test(fracao)) return null;
  if (!inteiro && !fracao) return null;
  const semZeros = inteiro.replace(/^0+(?=\d)/, '') || '0';
  if (semZeros.length > 12) return null;

  const f = (fracao + '00').slice(0, 2);
  const arredonda = fracao.length > 2 && Number(fracao[2]) >= 5 ? 1 : 0;
  const centavos = Number(semZeros) * 100 + Number(f) + arredonda;
  // Coluna INTEGER do Postgres: acima de R$ 21 milhões num lançamento só é erro de digitação.
  return centavos <= MAX_CENTAVOS ? centavos : null;
}

/** Centavos > 0, ou 0 quando vazio/inválido (formulários que exigem valor). */
export function parseValor(v: string): number {
  const c = lerValor(v);
  return c !== null && c > 0 ? c : 0;
}

/** Centavos → "1.234,56" para preencher um campo de texto. */
export function valorParaCampo(centavos: number): string {
  const inteiro = Math.trunc(centavos / 100);
  const resto = String(Math.abs(centavos % 100)).padStart(2, '0');
  return `${inteiro.toLocaleString('pt-BR')},${resto}`;
}

/** Percentual de comissão: 0 a 100, no máximo 2 casas, aceita vírgula. `null` = inválido. */
export function lerPercentual(v: string): number | null {
  const s = v.replace('%', '').trim().replace(',', '.');
  if (!s) return 0;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n >= 0 && n <= 100 ? n : null;
}
