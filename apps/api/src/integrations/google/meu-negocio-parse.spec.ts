import { parseAvaliacao, parseConta, parseListaAvaliacoes, parseLocal, somarDesempenho, RE_AVALIACAO_GBP, RE_LOCAL_GBP } from './meu-negocio-parse';

describe('Perfil da Empresa: parsers', () => {
  it('conta', () => {
    expect(parseConta({ name: 'accounts/1', accountName: 'Clínica X', type: 'LOCATION_GROUP', role: 'OWNER', verificationState: 'VERIFIED' })).toEqual({
      name: 'accounts/1', nome: 'Clínica X', tipo: 'LOCATION_GROUP', papel: 'OWNER', verificacao: 'VERIFIED',
    });
  });

  it('local com endereço, horário (TimeOfDay omite zeros) e metadata', () => {
    const l = parseLocal({
      name: 'locations/42',
      title: 'Clínica X',
      phoneNumbers: { primaryPhone: '(11) 4000-0000' },
      categories: { primaryCategory: { name: 'categories/gcid:clinic', displayName: 'Clínica médica' }, additionalCategories: [{ displayName: 'Dermatologista' }] },
      storefrontAddress: { addressLines: ['Rua A, 10'], locality: 'São Paulo', administrativeArea: 'SP', postalCode: '01000-000' },
      websiteUri: 'https://x.com',
      openInfo: { status: 'OPEN' },
      metadata: { mapsUri: 'https://maps.google.com/?cid=1', newReviewUri: 'https://g.page/r/x', placeId: 'ChIJ', hasVoiceOfMerchant: true },
      regularHours: { periods: [{ openDay: 'MONDAY', openTime: { hours: 8 }, closeDay: 'MONDAY', closeTime: { hours: 18, minutes: 30 } }, { openDay: 'TUESDAY', openTime: {}, closeDay: 'TUESDAY', closeTime: { hours: 24 } }] },
    });
    expect(l).toMatchObject({ name: 'locations/42', categoria: 'Clínica médica', categoriasExtras: ['Dermatologista'], endereco: 'Rua A, 10, São Paulo, SP, 01000-000', situacao: 'OPEN', temVozDoComerciante: true });
    expect(l.horarios[0]).toEqual({ diaAbre: 'MONDAY', abre: '08:00', diaFecha: 'MONDAY', fecha: '18:30' });
    // `{}` é meia-noite (zeros omitidos no JSON proto3), não "sem horário".
    expect(l.horarios[1]).toMatchObject({ abre: '00:00', fecha: '24:00' });
  });

  it('avaliação: estrelas por enum, resposta opcional', () => {
    const a = parseAvaliacao({ name: 'accounts/1/locations/2/reviews/abc', reviewer: { displayName: 'Ana' }, starRating: 'FOUR', comment: 'Bom', createTime: '2026-11-01T00:00:00Z' });
    expect(a).toMatchObject({ autor: 'Ana', estrelas: 4, comentario: 'Bom', resposta: null });
    const b = parseAvaliacao({ starRating: 'STAR_RATING_UNSPECIFIED', reviewReply: { comment: 'Obrigado', reviewReplyState: 'APPROVED' } });
    expect(b).toMatchObject({ estrelas: null, autor: 'Anônimo', resposta: { comentario: 'Obrigado', estado: 'APPROVED' } });
    expect(parseListaAvaliacoes({ reviews: [{}], averageRating: 4.5, totalReviewCount: 12, nextPageToken: 'n' })).toMatchObject({ media: 4.5, total: 12, proximaPagina: 'n' });
  });

  it('desempenho soma séries; value omitido = zero', () => {
    const d = somarDesempenho({
      multiDailyMetricTimeSeries: [
        {
          dailyMetricTimeSeries: [
            { dailyMetric: 'CALL_CLICKS', timeSeries: { datedValues: [{ date: { year: 2026, month: 11, day: 1 }, value: '3' }, { date: { year: 2026, month: 11, day: 2 } }] } },
            { dailyMetric: 'WEBSITE_CLICKS', timeSeries: { datedValues: [{ date: { year: 2026, month: 11, day: 1 }, value: '5' }] } },
            { dailyMetric: 'BUSINESS_DIRECTION_REQUESTS', timeSeries: { datedValues: [{ date: { year: 2026, month: 11, day: 2 }, value: '2' }] } },
            { dailyMetric: 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH', timeSeries: { datedValues: [{ date: { year: 2026, month: 11, day: 1 }, value: '100' }] } },
            { dailyMetric: 'BUSINESS_IMPRESSIONS_DESKTOP_MAPS', timeSeries: { datedValues: [{ date: { year: 2026, month: 11, day: 1 }, value: '20' }] } },
          ],
        },
      ],
    });
    expect(d).toMatchObject({ ligacoes: 3, cliquesSite: 5, rotas: 2, impressoes: { total: 120, buscaMovel: 100, mapasDesktop: 20, buscaDesktop: 0, mapasMovel: 0 } });
    expect(d.porDia).toEqual([
      { data: '2026-11-01', ligacoes: 3, cliquesSite: 5, rotas: 0, impressoes: 120 },
      { data: '2026-11-02', ligacoes: 0, cliquesSite: 0, rotas: 2, impressoes: 0 },
    ]);
    expect(somarDesempenho({})).toMatchObject({ ligacoes: 0, porDia: [] });
  });

  it('caminhos aceitos bloqueiam path injection', () => {
    expect(RE_LOCAL_GBP.test('locations/123')).toBe(true);
    expect(RE_LOCAL_GBP.test('locations/123/../../x')).toBe(false);
    expect(RE_AVALIACAO_GBP.test('accounts/1/locations/2/reviews/AbC-_9')).toBe(true);
    expect(RE_AVALIACAO_GBP.test('accounts/1/locations/2/reviews/a?x=1')).toBe(false);
  });
});
