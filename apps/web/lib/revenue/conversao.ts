import { numero, percentual } from '@/lib/format';
import type { Overview } from '@/lib/crm';

/** Abaixo disso a taxa de conversão é ruído (1 de 1 fechado vira "100%"). */
export const MIN_FECHADOS_CONVERSAO = 5;

/**
 * Taxa de conversão sem exagero. Com menos de `MIN_FECHADOS_CONVERSAO`
 * negócios fechados mostra "Poucos dados" e a contagem real. Usa
 * `kpis.ganhos`/`kpis.perdidos` quando a API os envia; sem eles e sem
 * fechamentos (`etapa_final`/`null`), também não há base para um percentual.
 */
export function conversaoHonesta(k: Overview['kpis']): { value: string; comparacao: string } {
  const temContagem = typeof k.ganhos === 'number' && typeof k.perdidos === 'number';
  if (temContagem) {
    const ganhos = k.ganhos as number;
    const fechados = ganhos + (k.perdidos as number);
    const rotulo = `${numero(ganhos)} de ${numero(fechados)} ${fechados === 1 ? 'fechado ganho' : 'fechados ganhos'}`;
    if (fechados < MIN_FECHADOS_CONVERSAO) return { value: 'Poucos dados', comparacao: fechados === 0 ? 'nenhum negócio fechado ainda' : rotulo };
    return { value: percentual(Math.round((ganhos / fechados) * 100), 0, true), comparacao: rotulo };
  }
  if (k.conversaoBase !== 'fechados') return { value: 'Poucos dados', comparacao: 'nenhum negócio fechado ainda' };
  return { value: percentual(k.conversao, 0, true), comparacao: 'ganhos sobre negócios fechados' };
}

