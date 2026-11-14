import { createHash } from 'node:crypto';

/**
 * Funções puras de leitura de planilhas (Avec, Excel, Google Planilhas) e de
 * cálculo de dinheiro do Financeiro (db/070). Sem banco: testadas isoladas em
 * importacao-fin.spec.ts. Dinheiro é SEMPRE centavo inteiro; nada passa por
 * float onde o arredondamento importa.
 */

/** Maior valor aceito (coluna INTEGER do Postgres, em centavos). */
export const MAX_CENTAVOS = 2_147_483_647;

/** Texto para comparação: sem acento, minúsculo, espaços colapsados. */
export function normalizarTexto(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Dinheiro como vem da planilha → centavos inteiros COM SINAL (sem float).
 *
 * Aceita "R$ 1.234,56", "1234,5", "1234.56", "1.234" (milhar brasileiro),
 * "1,234.56" (americano), "-50,00", "50,00-" e "(50,00)" (negativo contábil).
 * O separador decimal é o ÚLTIMO entre vírgula e ponto quando os dois
 * aparecem; ponto sozinho seguido de exatamente 3 dígitos é milhar.
 * Mais de 2 casas: arredonda meio para cima no centavo. Inválido → null.
 */
export function valorEmCentavos(v: unknown): number | null {
  let s = String(v ?? '').replace(/r\$/gi, '').replace(/\s+/g, '');
  if (!s) return null;
  let negativo = false;
  if (/^\(.*\)$/.test(s)) { negativo = true; s = s.slice(1, -1); }
  if (s.startsWith('-')) { negativo = !negativo; s = s.slice(1); } else if (s.endsWith('-')) { negativo = !negativo; s = s.slice(0, -1); }
  if (s.startsWith('+')) s = s.slice(1);
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
  if (centavos > MAX_CENTAVOS) return null;
  return negativo ? -centavos : centavos;
}

const pad = (n: number) => String(n).padStart(2, '0');

function dataValida(a: number, m: number, d: number): string | null {
  if (a < 1900 || a > 2100 || m < 1 || m > 12 || d < 1) return null;
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  if (d > ultimo) return null;
  return `${a}-${pad(m)}-${pad(d)}`;
}

/**
 * Data da planilha → "YYYY-MM-DD" (dia civil, sem fuso). Aceita dd/mm/aaaa,
 * dd/mm/aa, dd-mm-aaaa, dd.mm.aaaa, aaaa-mm-dd (com ou sem hora depois) e o
 * número de série do Excel (dias desde 1899-12-30). Sempre dia/mês na ordem
 * brasileira: "03/04/2026" é 3 de abril. Inválido → null.
 */
export function dataPlanilha(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const br = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:$|[ T])/);
  if (br) {
    let a = Number(br[3]);
    if (br[3].length === 2) a += a >= 70 ? 1900 : 2000;
    return dataValida(a, Number(br[2]), Number(br[1]));
  }
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[ T])/);
  if (iso) return dataValida(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  // Série do Excel (célula de data sem formatação). 20000 ≈ 1954, 80000 ≈ 2119.
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serie = Math.floor(Number(s));
    if (serie < 20000 || serie > 80000) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + serie * 86_400_000);
    return dataValida(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  return null;
}

/**
 * Hora da planilha → minutos do dia. Aceita "14:30", "14h30", "14h", "9:05:00"
 * e a fração de dia do Excel ("0.604166..."). Também extrai a hora de um
 * "dd/mm/aaaa hh:mm". Ausente ou inválida → null.
 */
export function horaPlanilha(v: unknown): number | null {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/(?:^|[ T])(\d{1,2})(?::|h)(\d{2})?(?::\d{2})?(?:\s*h)?$/) ?? s.match(/^(\d{1,2})(?::|h)(\d{2})?/);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2] ?? '0');
    return h <= 23 && min <= 59 ? h * 60 + min : null;
  }
  if (/^0?\.\d+$/.test(s)) {
    const minutos = Math.round(Number(s) * 1440);
    return minutos >= 0 && minutos < 1440 ? minutos : null;
  }
  return null;
}

/** Tipo do lançamento. Vazio → decide pelo sinal do valor. Desconhecido → null. */
export function tipoLancamento(v: unknown, valorNegativo: boolean): 'entrada' | 'saida' | null {
  const s = normalizarTexto(v);
  if (!s) return valorNegativo ? 'saida' : 'entrada';
  if (/^(entrada|receita|credito|recebimento|venda|e|c|\+)$/.test(s)) return 'entrada';
  if (/^(saida|despesa|debito|pagamento|gasto|custo|s|d|-)$/.test(s)) return 'saida';
  return null;
}

/** Status do lançamento. Vazio → pago. Cancelado/estornado → 'cancelado' (não entra no caixa). */
export function statusLancamento(v: unknown): 'pago' | 'pendente' | 'cancelado' | null {
  const s = normalizarTexto(v);
  if (!s) return 'pago';
  if (/^(pago|paga|recebido|recebida|quitado|quitada|liquidado|liquidada|baixado|baixada|confirmado|confirmada|concluido|concluida|ok|sim)$/.test(s)) return 'pago';
  if (/^(pendente|em aberto|aberto|aberta|a receber|a pagar|previsto|prevista|agendado|nao pago|nao)$/.test(s)) return 'pendente';
  if (/^(cancelado|cancelada|estornado|estornada|excluido|excluida)$/.test(s)) return 'cancelado';
  return null;
}

/** Status de agendamento do Avec/planilha → status da agenda. Vazio → agendado. */
export function statusAgendamento(v: unknown): 'agendado' | 'confirmado' | 'concluido' | 'cancelado' | 'faltou' | null {
  const s = normalizarTexto(v);
  if (!s) return 'agendado';
  if (/^(agendado|agendada|marcado|marcada|aguardando|pendente|em aberto|aberto)$/.test(s)) return 'agendado';
  if (/^(confirmado|confirmada)$/.test(s)) return 'confirmado';
  if (/^(concluido|concluida|finalizado|finalizada|atendido|atendida|realizado|realizada|pago|paga|fechado|fechada)$/.test(s)) return 'concluido';
  if (/^(cancelado|cancelada|desmarcado|desmarcada)$/.test(s)) return 'cancelado';
  if (/^(faltou|falta|nao compareceu|no show|ausente)$/.test(s)) return 'faltou';
  return null;
}

/**
 * Chave de deduplicação da importação: hash do conteúdo normalizado (mesma
 * normalização do front: espaços colapsados, minúsculo) + a ocorrência da
 * linha no arquivo. Reimportar o mesmo arquivo gera as mesmas chaves (ignora);
 * duas vendas idênticas no mesmo arquivo têm ocorrências 1 e 2 (entram as duas).
 */
export function chaveImportacao(campos: Record<string, unknown>, ocorrencia: number): string {
  const n = (x: unknown) => String(x ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
  const conteudo = Object.keys(campos).sort().filter((k) => n(campos[k]) !== '').map((k) => [k, n(campos[k])]);
  const occ = Number.isInteger(ocorrencia) && ocorrencia > 0 ? ocorrencia : 1;
  return `v1:${createHash('sha256').update(JSON.stringify(conteudo)).digest('hex')}#${occ}`;
}

/**
 * Percentual (NUMERIC(5,2): número, string ou Prisma.Decimal) → pontos-base
 * inteiros (33,33% = 3333). Recusa mais de 2 casas e fora de 0..100.
 */
export function percentualEmPontosBase(p: number | string | { toString(): string }): number | null {
  const s = (typeof p === 'number' ? String(p) : p.toString()).trim().replace(',', '.');
  const m = s.match(/^(\d{1,3})(?:\.(\d{1,2})0*)?$/);
  if (!m) return null;
  const bp = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
  return bp <= 10_000 ? bp : null;
}

/**
 * Comissão em centavos: base × percentual, arredondada MEIO PARA CIMA no
 * centavo (R$ 0,005 → R$ 0,01), em aritmética inteira. Ex.: 33,33% de
 * R$ 150,00 = 4999,5 centavos → 5000. Base inválida ou % inválido → 0.
 */
export function calcularComissaoCentavos(baseCentavos: number, percent: number | string | { toString(): string }): number {
  if (!Number.isInteger(baseCentavos) || baseCentavos <= 0) return 0;
  const bp = percentualEmPontosBase(percent);
  if (!bp) return 0;
  return Math.floor((baseCentavos * bp + 5_000) / 10_000);
}

export interface MembroImportacao {
  identityId: string;
  nome: string | null;
  email: string;
}

/**
 * Profissional da planilha → membro do tenant: e-mail exato, nome completo
 * (sem acento/caixa) ou, se inequívoco, só o primeiro nome (o Avec costuma
 * exportar assim). Ambíguo ou ausente → null.
 */
export function acharMembroPorNomeOuEmail(membros: MembroImportacao[], v: string): string | null {
  const alvo = normalizarTexto(v);
  if (!alvo) return null;
  const porEmail = membros.find((m) => m.email.toLowerCase() === alvo);
  if (porEmail) return porEmail.identityId;
  const porNome = membros.filter((m) => m.nome && normalizarTexto(m.nome) === alvo);
  if (porNome.length === 1) return porNome[0].identityId;
  if (porNome.length > 1) return null;
  const porPrimeiro = membros.filter((m) => m.nome && normalizarTexto(m.nome).split(' ')[0] === alvo);
  return porPrimeiro.length === 1 ? porPrimeiro[0].identityId : null;
}
