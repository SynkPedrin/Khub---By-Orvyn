import { createHmac } from 'node:crypto';
import { assinarEstado, verificarEstado, EstadoInvalidoError, VALIDADE_STATE_MS } from './google-oauth-state';
import { capacidadesDe, ESCOPO, ESCOPOS_POR_CAPACIDADE } from './google-escopos';

const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres';
const TENANT = '11111111-1111-1111-1111-111111111111';

describe('state OAuth da Presença Google', () => {
  it('ida e volta preserva tenant, identidade e capacidade', () => {
    const s = assinarEstado({ tenantId: TENANT, identityId: 'id-1', capacidade: 'gtm_escrita' }, SEGREDO, 1_000_000);
    const e = verificarEstado(s, SEGREDO, 1_000_000 + 5_000);
    expect(e).toMatchObject({ tenantId: TENANT, identityId: 'id-1', capacidade: 'gtm_escrita', fluxo: 'google_presenca' });
  });

  it('recusa assinatura com outro segredo', () => {
    const s = assinarEstado({ tenantId: TENANT, identityId: null, capacidade: 'leitura' }, SEGREDO);
    expect(() => verificarEstado(s, 'outro-segredo-qualquer-com-tamanho')).toThrow('state adulterado');
  });

  it('recusa corpo adulterado (troca de tenant)', () => {
    const s = assinarEstado({ tenantId: TENANT, identityId: null, capacidade: 'leitura' }, SEGREDO);
    const [corpo, sig] = s.split('.');
    const dados = JSON.parse(Buffer.from(corpo!, 'base64url').toString());
    dados.tenantId = '22222222-2222-2222-2222-222222222222';
    const forjado = `${Buffer.from(JSON.stringify(dados)).toString('base64url')}.${sig}`;
    expect(() => verificarEstado(forjado, SEGREDO)).toThrow(EstadoInvalidoError);
  });

  it('expira depois de 10 minutos', () => {
    const s = assinarEstado({ tenantId: TENANT, identityId: null, capacidade: 'leitura' }, SEGREDO, 0);
    expect(() => verificarEstado(s, SEGREDO, VALIDADE_STATE_MS + 1)).toThrow('expirado');
  });

  it('não aceita state de outro fluxo, mesmo bem assinado', () => {
    const corpo = Buffer.from(JSON.stringify({ tenantId: TENANT, provider: 'meta', nonce: 'x', ts: Date.now() })).toString('base64url');
    const sig = createHmac('sha256', SEGREDO).update(corpo).digest('base64url');
    expect(() => verificarEstado(`${corpo}.${sig}`, SEGREDO)).toThrow('outro fluxo');
  });

  it('recusa formato quebrado e segredo vazio', () => {
    expect(() => verificarEstado('sem-ponto', SEGREDO)).toThrow('state inválido');
    expect(() => verificarEstado('a.b.c', SEGREDO)).toThrow('state inválido');
    expect(() => assinarEstado({ tenantId: TENANT, identityId: null, capacidade: 'leitura' }, '')).toThrow(EstadoInvalidoError);
  });
});

describe('escopos e capacidades', () => {
  it('leitura não inclui nenhum escopo de escrita do Tag Manager', () => {
    expect(ESCOPOS_POR_CAPACIDADE.leitura).toEqual([ESCOPO.gtmLeitura, ESCOPO.searchConsoleLeitura, ESCOPO.perfilEmpresa]);
    expect(ESCOPOS_POR_CAPACIDADE.leitura).not.toContain(ESCOPO.gtmPublicar);
  });

  it('deriva capacidades dos escopos concedidos', () => {
    expect(capacidadesDe(ESCOPOS_POR_CAPACIDADE.leitura)).toEqual({ tagManager: true, tagManagerEscrita: false, tagManagerPublicar: false, searchConsole: true, meuNegocio: true });
    const tudo = [...ESCOPOS_POR_CAPACIDADE.leitura, ...ESCOPOS_POR_CAPACIDADE.gtm_escrita];
    expect(capacidadesDe(tudo)).toMatchObject({ tagManagerEscrita: true, tagManagerPublicar: true });
    expect(capacidadesDe([ESCOPO.gtmEditar])).toMatchObject({ tagManager: true, tagManagerPublicar: false, searchConsole: false });
  });
});
