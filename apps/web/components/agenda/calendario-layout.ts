import { chaveDia, inicioDaGradeMes, inicioDaSemana, somarDias } from './agenda-utils';

/**
 * Geometria da agenda (puro, sem React): posição dos eventos na grade de
 * horários, colunas para eventos sobrepostos, encaixe do arraste e janelas de
 * busca por visão. Testado em `calendario-layout.test.ts`.
 */

export type Visao = 'dia' | 'semana' | 'mes' | 'lista';

/** Altura de 1 hora na grade (px). 48px = 12px por 15 min, alvo de toque ok. */
export const ALTURA_HORA = 48;
/** Passo do arraste/redimensionamento (min). */
export const PASSO_MIN = 15;
/** Duração mínima ao redimensionar (min). */
export const DURACAO_MIN = 15;
/** Dias exibidos na visão Lista. */
export const DIAS_LISTA = 30;

export interface EventoTempo {
  id: string;
  inicio: string;
  fim: string;
}

export interface Bloco<T extends EventoTempo> {
  evento: T;
  /** Minutos desde 00:00 do dia (recortado ao dia). */
  topoMin: number;
  /** Duração visível no dia (min), com piso para caber o título. */
  alturaMin: number;
  coluna: number;
  colunas: number;
  /** O evento começou no dia anterior / termina no dia seguinte. */
  continuaAntes: boolean;
  continuaDepois: boolean;
}

const MIN_DIA = 24 * 60;
/** Bloco nunca menor que 20 min de altura: senão o título some. */
const ALTURA_VISIVEL_MIN = 20;

function inicioDoDia(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

/**
 * Eventos que tocam `dia`, com coluna/colunas para os sobrepostos ficarem
 * lado a lado (algoritmo de agrupamento estilo Google Calendar: cada grupo
 * de sobreposição transitiva divide a largura pelo maior número de colunas
 * simultâneas; cada evento vai para a primeira coluna livre).
 */
export function posicionarDia<T extends EventoTempo>(eventos: T[], dia: Date): Bloco<T>[] {
  const d0 = +inicioDoDia(dia);
  const d1 = d0 + MIN_DIA * 60_000;
  const doDia = eventos
    .map((e) => ({ e, ini: +new Date(e.inicio), fim: +new Date(e.fim) }))
    .filter((x) => x.ini < d1 && x.fim > d0)
    .sort((a, b) => a.ini - b.ini || b.fim - a.fim);

  const saida: Bloco<T>[] = [];
  let grupo: { x: (typeof doDia)[number]; coluna: number }[] = [];
  let fimDoGrupo = -Infinity;
  let finsPorColuna: number[] = [];

  const fecharGrupo = () => {
    const colunas = Math.max(1, finsPorColuna.length);
    for (const { x, coluna } of grupo) {
      const ini = Math.max(x.ini, d0);
      const fim = Math.min(x.fim, d1);
      const topoMin = Math.round((ini - d0) / 60_000);
      const alturaMin = Math.max(ALTURA_VISIVEL_MIN, Math.round((fim - ini) / 60_000));
      saida.push({
        evento: x.e,
        topoMin,
        alturaMin: Math.min(alturaMin, MIN_DIA - topoMin),
        coluna,
        colunas,
        continuaAntes: x.ini < d0,
        continuaDepois: x.fim > d1,
      });
    }
    grupo = [];
    finsPorColuna = [];
    fimDoGrupo = -Infinity;
  };

  for (const x of doDia) {
    // Evento curto ocupa visualmente pelo menos ALTURA_VISIVEL_MIN: conta isso
    // para a sobreposição, senão dois eventos de 5 min colados se encobririam.
    const fimVisual = Math.max(x.fim, x.ini + ALTURA_VISIVEL_MIN * 60_000);
    if (x.ini >= fimDoGrupo) fecharGrupo();
    let coluna = finsPorColuna.findIndex((f) => f <= x.ini);
    if (coluna === -1) {
      coluna = finsPorColuna.length;
      finsPorColuna.push(fimVisual);
    } else {
      finsPorColuna[coluna] = fimVisual;
    }
    grupo.push({ x, coluna });
    fimDoGrupo = Math.max(fimDoGrupo, fimVisual);
  }
  fecharGrupo();
  return saida;
}

/** Arredonda minutos para o passo mais próximo. */
export function encaixar(min: number, passo = PASSO_MIN): number {
  return Math.round(min / passo) * passo;
}

/** Pixel Y dentro da coluna → minutos do dia, encaixado e limitado ao dia. */
export function minutosDoPixel(y: number, passo = 30): number {
  const min = Math.floor((y / ALTURA_HORA) * 60 / passo) * passo;
  return Math.min(Math.max(0, min), MIN_DIA - passo);
}

/** Data local do `dia` às `min` minutos. */
export function dataNoDia(dia: Date, min: number): Date {
  const r = inicioDoDia(dia);
  r.setMinutes(min);
  return r;
}

/** Arraste: desloca início e fim pelos mesmos minutos/dias (mantém a duração). */
export function moverEvento(e: EventoTempo, deltaMin: number, deltaDias = 0): { inicio: string; fim: string } {
  const ini = new Date(e.inicio);
  const fim = new Date(e.fim);
  ini.setDate(ini.getDate() + deltaDias);
  fim.setDate(fim.getDate() + deltaDias);
  return {
    inicio: new Date(+ini + deltaMin * 60_000).toISOString(),
    fim: new Date(+fim + deltaMin * 60_000).toISOString(),
  };
}

/** Redimensionar: muda só o fim, com duração mínima e até 24h. */
export function redimensionarEvento(e: EventoTempo, deltaMin: number): { inicio: string; fim: string } {
  const ini = +new Date(e.inicio);
  const fimAtual = +new Date(e.fim);
  const fim = Math.min(Math.max(fimAtual + deltaMin * 60_000, ini + DURACAO_MIN * 60_000), ini + MIN_DIA * 60_000);
  return { inicio: e.inicio, fim: new Date(fim).toISOString() };
}

/** Dias visíveis da visão (Dia: 1; Semana: 7; Mês: 42 da grade; Lista: 30). */
export function diasDaVisao(visao: Visao, ref: Date): Date[] {
  if (visao === 'dia') return [inicioDoDia(ref)];
  if (visao === 'semana') return Array.from({ length: 7 }, (_, i) => somarDias(inicioDaSemana(ref), i));
  if (visao === 'mes') return Array.from({ length: 42 }, (_, i) => somarDias(inicioDaGradeMes(ref), i));
  return Array.from({ length: DIAS_LISTA }, (_, i) => somarDias(inicioDoDia(ref), i));
}

/** Janela de busca na API para a visão: do primeiro dia 00:00 ao último 23:59:59.999. */
export function janelaDaVisao(visao: Visao, ref: Date): { de: Date; ate: Date } {
  const dias = diasDaVisao(visao, ref);
  return { de: dias[0], ate: new Date(+somarDias(dias[dias.length - 1], 1) - 1) };
}

/** Anterior/próximo: um dia, uma semana, um mês ou uma página da lista. */
export function navegar(visao: Visao, ref: Date, direcao: 1 | -1): Date {
  if (visao === 'dia') return somarDias(ref, direcao);
  if (visao === 'semana') return somarDias(ref, 7 * direcao);
  if (visao === 'lista') return somarDias(ref, DIAS_LISTA * direcao);
  const r = new Date(ref.getFullYear(), ref.getMonth() + direcao, 1);
  return r;
}

/** Eventos que tocam o dia (para Mês e Lista), em ordem de início. */
export function eventosDoDia<T extends EventoTempo>(eventos: T[], dia: Date): T[] {
  const d0 = +inicioDoDia(dia);
  const d1 = d0 + MIN_DIA * 60_000;
  return eventos.filter((e) => +new Date(e.inicio) < d1 && +new Date(e.fim) > d0).sort((a, b) => +new Date(a.inicio) - +new Date(b.inicio));
}

/** A data `d` está no dia `dia` (fuso local)? */
export const mesmoDia = (a: Date, b: Date): boolean => chaveDia(a) === chaveDia(b);
