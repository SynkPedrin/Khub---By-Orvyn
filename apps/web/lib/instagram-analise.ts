/**
 * Análise de conteúdo do Instagram calculada a partir dos posts REAIS que o
 * painel já traz (as 25 publicações mais recentes, com os insights de cada
 * uma). Nada estimado: cada número sai de post publicado; com poucos posts num
 * grupo, a tela avisa ("1 post") em vez de cravar conclusão.
 */
import type { PostRede } from './redes';

export interface GrupoFormato {
  tipo: string;
  rotulo: string;
  posts: number;
  alcanceMedio: number | null;
  engajamentoMedio: number | null;
  interacoesMedias: number;
  salvamentosMedios: number | null;
  compartilhamentosMedios: number | null;
}

export interface CelulaHorario {
  dia: number;
  faixa: number;
  posts: number;
  engajamentoMedio: number | null;
}

export interface Hashtag {
  tag: string;
  usos: number;
  engajamentoMedio: number | null;
  alcanceMedio: number | null;
}

export interface Frequencia {
  postsPorSemana: number | null;
  intervaloMedioDias: number | null;
  diasDesdeUltimo: number | null;
}

export interface Destaque {
  tom: 'bom' | 'atencao' | 'info';
  texto: string;
}

export const ROTULO_TIPO: Record<string, string> = { reels: 'Reels', carrossel: 'Carrossel', imagem: 'Imagem', video: 'Vídeo' };
export const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const DIAS_SEMANA_LONGO = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
/** Faixas de 3 h: 0 = 0h–3h … 7 = 21h–24h. */
export const FAIXAS_HORA = ['0h', '3h', '6h', '9h', '12h', '15h', '18h', '21h'];

const media = (v: number[]): number | null => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
const num = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
const arred = (v: number | null, casas = 2) => (v == null ? null : Math.round(v * 10 ** casas) / 10 ** casas);

/** Curtidas + comentários + compartilhamentos + salvamentos (o que veio). */
export function interacoes(p: PostRede): number {
  const m = p.metricas;
  return [m.curtidas, m.comentarios, m.compartilhamentos, m.salvamentos].filter(num).reduce((a, b) => a + b, 0);
}

export function porFormato(posts: PostRede[]): GrupoFormato[] {
  const grupos = new Map<string, PostRede[]>();
  for (const p of posts) grupos.set(p.tipo, [...(grupos.get(p.tipo) ?? []), p]);
  return [...grupos.entries()]
    .map(([tipo, ps]) => ({
      tipo,
      rotulo: ROTULO_TIPO[tipo] ?? tipo,
      posts: ps.length,
      alcanceMedio: arred(media(ps.map((p) => p.metricas.alcance).filter(num)), 0),
      engajamentoMedio: arred(media(ps.map((p) => p.metricas.engajamento).filter(num))),
      interacoesMedias: Math.round(media(ps.map(interacoes)) ?? 0),
      salvamentosMedios: arred(media(ps.map((p) => p.metricas.salvamentos).filter(num)), 1),
      compartilhamentosMedios: arred(media(ps.map((p) => p.metricas.compartilhamentos).filter(num)), 1),
    }))
    .sort((a, b) => (b.engajamentoMedio ?? -1) - (a.engajamentoMedio ?? -1) || b.interacoesMedias - a.interacoesMedias);
}

/** Grade dia da semana × faixa de 3 h, no fuso de quem está vendo. */
export function gradeHorarios(posts: PostRede[]): CelulaHorario[] {
  const celulas = new Map<string, number[]>();
  const contagem = new Map<string, number>();
  for (const p of posts) {
    if (!p.publicadoEm) continue;
    const d = new Date(p.publicadoEm);
    if (Number.isNaN(d.getTime())) continue;
    const k = `${d.getDay()}-${Math.floor(d.getHours() / 3)}`;
    contagem.set(k, (contagem.get(k) ?? 0) + 1);
    if (num(p.metricas.engajamento)) celulas.set(k, [...(celulas.get(k) ?? []), p.metricas.engajamento]);
  }
  const out: CelulaHorario[] = [];
  for (let dia = 0; dia < 7; dia++) for (let faixa = 0; faixa < 8; faixa++) {
    const k = `${dia}-${faixa}`;
    out.push({ dia, faixa, posts: contagem.get(k) ?? 0, engajamentoMedio: arred(media(celulas.get(k) ?? [])) });
  }
  return out;
}

/** Melhor dia da semana (média de engajamento), exigindo ao menos `minimo` posts no dia. */
export function melhorDia(posts: PostRede[], minimo = 2): { dia: number; engajamentoMedio: number; posts: number } | null {
  const porDia = Array.from({ length: 7 }, () => [] as number[]);
  for (const p of posts) {
    if (!p.publicadoEm || !num(p.metricas.engajamento)) continue;
    porDia[new Date(p.publicadoEm).getDay()].push(p.metricas.engajamento);
  }
  let melhor: { dia: number; engajamentoMedio: number; posts: number } | null = null;
  porDia.forEach((v, dia) => {
    const m = media(v);
    if (v.length >= minimo && m != null && (!melhor || m > melhor.engajamentoMedio)) melhor = { dia, engajamentoMedio: arred(m) ?? m, posts: v.length };
  });
  return melhor;
}

const RE_TAG = /#([\p{L}\p{N}_]+)/gu;
export function hashtags(posts: PostRede[]): Hashtag[] {
  const mapa = new Map<string, PostRede[]>();
  for (const p of posts) {
    const tags = new Set([...(p.legenda ?? '').matchAll(RE_TAG)].map((m) => m[1].toLowerCase()));
    for (const t of tags) mapa.set(t, [...(mapa.get(t) ?? []), p]);
  }
  return [...mapa.entries()]
    .map(([tag, ps]) => ({
      tag,
      usos: ps.length,
      engajamentoMedio: arred(media(ps.map((p) => p.metricas.engajamento).filter(num))),
      alcanceMedio: arred(media(ps.map((p) => p.metricas.alcance).filter(num)), 0),
    }))
    .sort((a, b) => b.usos - a.usos || (b.engajamentoMedio ?? -1) - (a.engajamentoMedio ?? -1))
    .slice(0, 15);
}

export function frequencia(posts: PostRede[], agora = new Date()): Frequencia {
  const datas = posts.map((p) => (p.publicadoEm ? new Date(p.publicadoEm).getTime() : NaN)).filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  if (!datas.length) return { postsPorSemana: null, intervaloMedioDias: null, diasDesdeUltimo: null };
  const diasDesdeUltimo = Math.max(0, Math.floor((agora.getTime() - datas[datas.length - 1]) / 864e5));
  if (datas.length < 2) return { postsPorSemana: null, intervaloMedioDias: null, diasDesdeUltimo };
  const spanDias = (datas[datas.length - 1] - datas[0]) / 864e5;
  return {
    postsPorSemana: spanDias > 0 ? arred((datas.length - 1) / (spanDias / 7), 1) : null,
    intervaloMedioDias: arred(spanDias / (datas.length - 1), 1),
    diasDesdeUltimo,
  };
}

/** Frases curtas com o que os dados mostram. Só afirma com base mínima. */
export function destaques(posts: PostRede[], agora = new Date()): Destaque[] {
  const out: Destaque[] = [];
  const fmts = porFormato(posts).filter((g) => g.posts >= 2 && g.alcanceMedio != null);
  if (fmts.length >= 2) {
    const porAlcance = [...fmts].sort((a, b) => (b.alcanceMedio ?? 0) - (a.alcanceMedio ?? 0));
    const [topo, fundo] = [porAlcance[0], porAlcance[porAlcance.length - 1]];
    if (fundo.alcanceMedio && topo.alcanceMedio && topo.alcanceMedio / fundo.alcanceMedio >= 1.3) {
      out.push({ tom: 'bom', texto: `${topo.rotulo} alcança ${(topo.alcanceMedio / fundo.alcanceMedio).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}× mais pessoas que ${fundo.rotulo.toLowerCase()} (média de ${topo.posts} e ${fundo.posts} posts).` });
    }
  }
  const dia = melhorDia(posts);
  if (dia) out.push({ tom: 'info', texto: `Os posts de ${DIAS_SEMANA_LONGO[dia.dia]} engajam mais: ${dia.engajamentoMedio.toLocaleString('pt-BR')}% em média (${dia.posts} posts).` });
  const comPergunta = posts.filter((p) => (p.legenda ?? '').includes('?') && num(p.metricas.comentarios));
  const semPergunta = posts.filter((p) => !(p.legenda ?? '').includes('?') && num(p.metricas.comentarios));
  const cp = media(comPergunta.map((p) => p.metricas.comentarios as number));
  const sp = media(semPergunta.map((p) => p.metricas.comentarios as number));
  if (comPergunta.length >= 2 && semPergunta.length >= 2 && cp != null && sp != null && sp > 0 && cp / sp >= 1.3) {
    out.push({ tom: 'bom', texto: `Legenda com pergunta recebe ${(cp / sp).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}× mais comentários.` });
  }
  const f = frequencia(posts, agora);
  if (f.diasDesdeUltimo != null && f.diasDesdeUltimo >= 7) out.push({ tom: 'atencao', texto: `Último post há ${f.diasDesdeUltimo} dias: contas que somem perdem alcance. Programe uma publicação.` });
  else if (f.postsPorSemana != null && f.postsPorSemana < 2) out.push({ tom: 'atencao', texto: `Ritmo de ${f.postsPorSemana.toLocaleString('pt-BR')} post(s) por semana. Três por semana costuma manter a conta aparecendo.` });
  const salvos = posts.filter((p) => num(p.metricas.salvamentos) && num(p.metricas.alcance) && (p.metricas.alcance as number) > 0);
  const topoSalvo = [...salvos].sort((a, b) => (b.metricas.salvamentos as number) / (b.metricas.alcance as number) - (a.metricas.salvamentos as number) / (a.metricas.alcance as number))[0];
  if (topoSalvo && (topoSalvo.metricas.salvamentos as number) >= 3) {
    out.push({ tom: 'info', texto: `O post mais salvo proporcionalmente é ${ROTULO_TIPO[topoSalvo.tipo]?.toLowerCase() ?? topoSalvo.tipo} ("${(topoSalvo.legenda || 'sem legenda').slice(0, 48)}…"): conteúdo útil vira referência, vale repetir o tema.` });
  }
  return out;
}
