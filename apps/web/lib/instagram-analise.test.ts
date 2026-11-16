import { describe, expect, it } from 'vitest';
import type { PostRede } from './redes';
import { destaques, frequencia, gradeHorarios, hashtags, melhorDia, porFormato } from './instagram-analise';

const post = (id: string, tipo: string, quando: Date, m: Partial<PostRede['metricas']>, legenda = ''): PostRede => ({
  id, tipo, legenda, miniatura: null, link: null, publicadoEm: quando.toISOString(), duracaoSeg: null,
  metricas: { visualizacoes: null, alcance: null, curtidas: null, comentarios: null, compartilhamentos: null, salvamentos: null, engajamento: null, ...m },
});
// quartas (dia 3) e sábados (dia 6) de novembro/2026, horário local
const qua = (d: number, h = 19) => new Date(2026, 10, d, h, 0);
const posts: PostRede[] = [
  post('1', 'reels', qua(4), { alcance: 3000, curtidas: 200, comentarios: 20, engajamento: 8 }, 'Você sabia? #estetica #pele'),
  post('2', 'reels', qua(11), { alcance: 2600, curtidas: 150, comentarios: 18, engajamento: 7 }, 'Qual seu tipo de pele? #pele'),
  post('3', 'imagem', new Date(2026, 10, 7, 10), { alcance: 900, curtidas: 40, comentarios: 3, engajamento: 4, salvamentos: 9 }, 'Promoção #estetica'),
  post('4', 'imagem', new Date(2026, 10, 1, 10), { alcance: 1000, curtidas: 50, comentarios: 4, engajamento: 5 }, 'Agenda aberta'),
];

describe('análise de conteúdo do Instagram', () => {
  it('agrupa por formato e ordena pelo engajamento', () => {
    const g = porFormato(posts);
    expect(g[0]).toMatchObject({ tipo: 'reels', posts: 2, alcanceMedio: 2800, engajamentoMedio: 7.5 });
    expect(g[1]).toMatchObject({ tipo: 'imagem', posts: 2, alcanceMedio: 950 });
  });
  it('grade dia × faixa de 3 h conta os posts no horário local', () => {
    const c = gradeHorarios(posts).find((x) => x.dia === 3 && x.faixa === 6)!;
    expect(c).toMatchObject({ posts: 2, engajamentoMedio: 7.5 });
    expect(gradeHorarios(posts)).toHaveLength(56);
  });
  it('melhor dia só com base mínima (2 posts)', () => {
    expect(melhorDia(posts)).toMatchObject({ dia: 3, posts: 2 });
    expect(melhorDia(posts.slice(0, 1))).toBeNull();
  });
  it('hashtags: usos e engajamento médio, sem repetir a tag do mesmo post', () => {
    const h = hashtags(posts);
    expect(h.map((x) => x.tag)).toEqual(['pele', 'estetica']); // empate em usos: maior engajamento primeiro
    expect(h.find((x) => x.tag === 'pele')).toMatchObject({ usos: 2, engajamentoMedio: 7.5 });
  });
  it('frequência e dias desde o último post', () => {
    const f = frequencia(posts, new Date(2026, 10, 13, 12));
    expect(f.diasDesdeUltimo).toBe(1);
    expect(f.intervaloMedioDias).toBeGreaterThan(3);
    expect(frequencia([])).toEqual({ postsPorSemana: null, intervaloMedioDias: null, diasDesdeUltimo: null });
  });
  it('destaques: formato que alcança mais, melhor dia e pergunta na legenda', () => {
    const d = destaques(posts, new Date(2026, 10, 13, 12)).map((x) => x.texto).join(' | ');
    expect(d).toMatch(/Reels alcança 2,9× mais pessoas que imagem/);
    expect(d).toMatch(/quarta/);
    expect(d).toMatch(/pergunta recebe/);
  });
  it('conta parada há 7+ dias gera alerta', () => {
    expect(destaques(posts, new Date(2026, 10, 25)).some((x) => x.tom === 'atencao' && /há \d+ dias/.test(x.texto))).toBe(true);
  });
});
