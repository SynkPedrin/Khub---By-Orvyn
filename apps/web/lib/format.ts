/**
 * Formatação pt-BR compartilhada.
 *
 * Um único lugar decide como o produto escreve dinheiro, porcentagem e
 * tempo. Sem isso, cada tela formata do seu jeito e "R$ 284.500" convive
 * com "284500,00" na mesma página.
 */

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const BRL_CENTS = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** `284500` → `R$ 284.500`. Com `centavos`, `42` → `R$ 42,00`. */
export function moeda(valor: number | null | undefined, centavos = false): string {
  if (valor == null || !Number.isFinite(valor)) return '-';
  return (centavos ? BRL_CENTS : BRL).format(valor);
}

/** `1845000` → `R$ 1,8M`. Para eixos de gráfico e espaços apertados. */
export function moedaCurta(valor: number | null | undefined): string {
  if (valor == null || !Number.isFinite(valor)) return '-';
  const abs = Math.abs(valor);
  if (abs >= 1_000_000) return `R$ ${(valor / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}M`;
  // 1 casa abaixo de 10 mil: 2.500 vira "R$ 2,5K" (antes "R$ 3K", número errado no eixo do gráfico).
  if (abs >= 1_000) return `R$ ${(valor / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: abs < 10_000 ? 1 : 0 })}K`;
  return moeda(valor);
}

/** `1245` → `1.245`. */
export function numero(valor: number | null | undefined): string {
  if (valor == null || !Number.isFinite(valor)) return '-';
  return valor.toLocaleString('pt-BR');
}

/** `0.62` → `62%` (fração) ou `62` → `62%` (já em pontos, com `jaEmPontos`). */
export function percentual(valor: number | null | undefined, casas = 0, jaEmPontos = false): string {
  if (valor == null || !Number.isFinite(valor)) return '-';
  const pontos = jaEmPontos ? valor : valor * 100;
  return `${pontos.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
}

/** Minutos → `2 min`, `1h 20min`, `2 dias`. */
export function duracao(minutos: number | null | undefined): string {
  if (minutos == null || !Number.isFinite(minutos) || minutos < 0) return '-';
  if (minutos < 1) return 'menos de 1 min';
  minutos = Math.round(minutos);
  if (minutos < 60) return `${Math.round(minutos)} min`;
  if (minutos < 60 * 24) {
    const h = Math.floor(minutos / 60);
    const m = Math.round(minutos % 60);
    return m ? `${h}h ${m}min` : `${h}h`;
  }
  const d = Math.round(minutos / (60 * 24));
  return d === 1 ? '1 dia' : `${d} dias`;
}

/** Data/hora relativa: `2 min atrás`, `Ontem`, `28 de abr.`. */
export function tempoRelativo(data: string | Date | null | undefined, agora = new Date()): string {
  if (!data) return '-';
  const d = typeof data === 'string' ? new Date(data) : data;
  if (Number.isNaN(d.getTime())) return '-';

  const diffMs = agora.getTime() - d.getTime();
  const min = Math.floor(diffMs / 60_000);

  if (min < 0) return dataCurta(d);
  if (min < 1) return 'agora';
  if (min < 60) return `${min} min atrás`;

  const horas = Math.floor(min / 60);
  if (horas < 24 && d.toDateString() === agora.toDateString()) {
    return horas === 1 ? '1 hora atrás' : `${horas} horas atrás`;
  }

  const ontem = new Date(agora);
  ontem.setDate(ontem.getDate() - 1);
  if (d.toDateString() === ontem.toDateString()) return 'Ontem';

  const dias = Math.floor(min / (60 * 24));
  if (dias < 7) return `${dias} dias atrás`;

  return dataCurta(d);
}

/** `28 de abr.` — e inclui o ano quando não é o corrente. */
export function dataCurta(data: string | Date | null | undefined, agora = new Date()): string {
  if (!data) return '-';
  const d = typeof data === 'string' ? new Date(data) : data;
  if (Number.isNaN(d.getTime())) return '-';
  const mesmoAno = d.getFullYear() === agora.getFullYear();
  return d.toLocaleDateString('pt-BR', {
    day: 'numeric',
    month: 'short',
    ...(mesmoAno ? {} : { year: 'numeric' }),
  });
}

/** `10:24`. */
export function hora(data: string | Date | null | undefined): string {
  if (!data) return '-';
  const d = typeof data === 'string' ? new Date(data) : data;
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/** `+55 11 98765-4321` a partir de dígitos. Devolve a entrada se não reconhecer. */
export function telefone(valor: string | null | undefined): string {
  if (!valor) return '-';
  const d = valor.replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('55')) return `+55 ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12 && d.startsWith('55')) return `+55 ${d.slice(2, 4)} ${d.slice(4, 8)}-${d.slice(8)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return valor;
}

/** Saudação pelo horário — usada no Dashboard. */
export function saudacao(agora = new Date()): string {
  const h = agora.getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

/** Primeiro nome, para tratamento pessoal sem soar formal demais. */
export function primeiroNome(nome: string | null | undefined): string {
  if (!nome) return '';
  return nome.trim().split(/\s+/)[0] ?? '';
}

/** Custos do provedor são em USD; não aplicar conversão implícita para BRL. */
export function dolar(valor: number | null | undefined): string {
  if (valor == null || !Number.isFinite(valor)) return '-';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(valor);
}
