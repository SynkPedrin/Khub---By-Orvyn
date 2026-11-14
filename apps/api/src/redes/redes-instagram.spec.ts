import { ErroRede } from './redes.erros';
import { ordenarIdade, parseBreakdown, parseTotal } from './redes-instagram.parse';
import { RedesInstagramService } from './redes-instagram.service';
import { permissionFor } from '../auth/permissions.guard';
import { modulosDaRota } from '../auth/modulos';

/** Forma do exemplo oficial (IG User Insights, breakdown com `timeframe` em dimension_keys). */
const demo = (dim: string, linhas: [string, number][]) => ({
  data: [{ name: 'follower_demographics', period: 'lifetime', total_value: { breakdowns: [{ dimension_keys: ['timeframe', dim], results: linhas.map(([k, v]) => ({ dimension_values: ['THIS_MONTH', k], value: v })) }] } }],
});
const periodo = (dim: string, linhas: [string, number][], total?: number) => ({
  data: [{ name: 'x', period: 'day', total_value: { ...(total !== undefined ? { value: total } : {}), breakdowns: [{ dimension_keys: [dim], results: linhas.map(([k, v]) => ({ dimension_values: [k], value: v })) }] } }],
});

describe('Instagram — parse de breakdown', () => {
  it('lê a dimensão pela posição em dimension_keys (ignora timeframe) e ordena', () => {
    expect(parseBreakdown(demo('gender', [['M', 30], ['F', 70]]), 'gender')).toEqual([{ chave: 'F', valor: 70 }, { chave: 'M', valor: 30 }]);
  });
  it('idade em ordem de faixa', () => {
    const f = parseBreakdown(demo('age', [['35-44', 9], ['18-24', 4], ['65+', 1], ['25-34', 20]]), 'age');
    expect(ordenarIdade(f).map((x) => x.chave)).toEqual(['18-24', '25-34', '35-44', '65+']);
  });
  it('total: usa total_value.value; sem ele, soma as fatias; vazio = null', () => {
    expect(parseTotal(periodo('contact_button_type', [['CALL', 3]], 10), 'contact_button_type')).toBe(10);
    expect(parseTotal(periodo('contact_button_type', [['CALL', 3], ['TEXT', 4]]), 'contact_button_type')).toBe(7);
    expect(parseTotal({ data: [] }, 'x')).toBeNull();
    expect(parseBreakdown({ data: [] }, 'age')).toEqual([]);
    expect(parseBreakdown(null, 'age')).toEqual([]);
  });
});

function montar(resp: (p: Record<string, unknown>) => unknown, contas = [{ id: '11111111-1111-4111-8111-111111111111', status: 'conectado' }]) {
  const chamadas: Record<string, unknown>[] = [];
  const conexoes = {
    contas: jest.fn(async () => contas),
    ativa: jest.fn(async () => ({ id: contas[0]?.id, rede: 'instagram', externalId: 'IG1', pageId: null, nome: 'ig', scopes: [], token: 't' })),
  };
  const http = {
    metaGet: jest.fn(async (_c: string, p: Record<string, unknown>) => {
      chamadas.push(p);
      const r = resp(p);
      if (r instanceof Error) throw r;
      return r;
    }),
  };
  return { svc: new RedesInstagramService(conexoes as never, http as never), chamadas };
}

const respostaOk = (p: Record<string, unknown>) => {
  if (p.metric === 'follower_demographics') {
    const b = String(p.breakdown);
    if (b === 'age') return demo('age', [['25-34', 50], ['18-24', 20]]);
    if (b === 'gender') return demo('gender', [['F', 80], ['M', 20]]);
    if (b === 'city') return demo('city', [['Araçatuba, São Paulo (state)', 40]]);
    return demo('country', [['BR', 95]]);
  }
  if (p.metric === 'follows_and_unfollows') return periodo('follow_type', [['FOLLOWER', 31], ['NON_FOLLOWER', 6]]);
  if (p.metric === 'profile_links_taps') return periodo('contact_button_type', [['CALL', 5], ['TEXT', 12]]);
  if (p.breakdown === 'media_product_type') return periodo('media_product_type', [['REEL', 900], ['POST', 300]]);
  return periodo('follow_type', [['NON_FOLLOWER', 700], ['FOLLOWER', 500]]);
};

describe('RedesInstagramService.publico', () => {
  it('sem conta conectada: conectado=false e nenhuma chamada à Meta', async () => {
    const { svc, chamadas } = montar(respostaOk, []);
    const r = await svc.publico('t1', undefined, 28);
    expect(r.conectado).toBe(false);
    expect(chamadas).toHaveLength(0);
  });

  it('pede as métricas com os parâmetros da doc oficial e rotula em português', async () => {
    const { svc, chamadas } = montar(respostaOk);
    const r = await svc.publico('t1', undefined, 90);
    expect(r.periodoDias).toBe(28);
    const demos = chamadas.filter((c) => c.metric === 'follower_demographics');
    expect(demos).toHaveLength(4);
    expect(demos.every((c) => c.period === 'lifetime' && c.metric_type === 'total_value' && c.timeframe === 'this_month' && !('since' in c))).toBe(true);
    const doPeriodo = chamadas.filter((c) => c.metric !== 'follower_demographics');
    expect(doPeriodo.every((c) => c.period === 'day' && c.metric_type === 'total_value' && typeof c.since === 'number' && typeof c.until === 'number')).toBe(true);
    expect(r.publico.genero[0]).toMatchObject({ chave: 'F', rotulo: 'Mulheres', valor: 80 });
    expect(r.publico.idade.map((x) => x.chave)).toEqual(['18-24', '25-34']);
    expect(r.seguidores).toMatchObject({ ganhos: 31, perdidos: 6 });
    expect(r.cliquesPerfil.total).toBe(17);
    expect(r.cliquesPerfil.botoes[0]).toMatchObject({ chave: 'TEXT', rotulo: 'Mensagem' });
    expect(r.alcancePorFormato.fatias[0]).toMatchObject({ rotulo: 'Reels', valor: 900 });
    expect(r.alcancePorRelacao.fatias[0]).toMatchObject({ rotulo: 'Não seguidores', valor: 700 });
  });

  it('cada seção falha sozinha: sem permissão no público, o resto continua', async () => {
    const semPermissao = new ErroRede('instagram', { tipo: 'permissao', mensagem: 'Falta instagram_manage_insights', faltando: ['instagram_manage_insights'], doc: 'x', status: 403 } as never);
    const { svc } = montar((p) => (p.metric === 'follower_demographics' ? semPermissao : respostaOk(p)));
    const r = await svc.publico('t1', undefined, 28);
    expect(r.publico.status).toMatchObject({ status: 'sem_permissao', faltando: ['instagram_manage_insights'] });
    expect(r.cliquesPerfil.status.status).toBe('ok');
    expect(r.seguidores.ganhos).toBe(31);
  });

  it('conta com menos de 100 seguidores (Meta não devolve público): aviso claro', async () => {
    const { svc } = montar((p) => (p.metric === 'follower_demographics' ? { data: [] } : p.metric === 'follows_and_unfollows' ? { data: [] } : respostaOk(p)));
    const r = await svc.publico('t1', undefined, 28);
    expect(r.publico.status).toMatchObject({ status: 'sem_dados', mensagem: expect.stringMatching(/100 seguidores/) });
    expect(r.seguidores.status.status).toBe('sem_dados');
  });

  it('permissão e módulo da rota nova seguem os de Redes', () => {
    expect(permissionFor('redes/instagram', 'publico', 'GET')).toBe(permissionFor('redes', 'painel/:rede', 'GET'));
    expect(modulosDaRota('redes/instagram', 'publico', 'GET')).toEqual(modulosDaRota('redes', 'painel/:rede', 'GET'));
  });
});
