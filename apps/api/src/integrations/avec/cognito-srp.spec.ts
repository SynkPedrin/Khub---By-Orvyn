import { createHash } from 'node:crypto';
import { assinaturaSrp, dataCognito, modPow, padHex } from './cognito-srp';

/**
 * Vetor de referência gerado com a biblioteca OFICIAL da AWS
 * (amazon-cognito-identity-js 6.3.22, AuthenticationHelper) com `a`, `B`,
 * salt e bloco fixos: a nossa implementação tem que dar a mesma assinatura.
 */
const N = BigInt(
  '0xFFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DD' +
    'EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED' +
    'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F' +
    '83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B' +
    'E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA0510' +
    '15728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7' +
    'ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6BF12FFA06D98A0864D87602733EC86A64521F2B18177B200C' +
    'BBE117577A615D6C770988C0BAD946E208E24FA074E5AB3143DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF',
);

describe('cognito-srp', () => {
  const a = BigInt(`0x${'a'.repeat(256)}`);
  const A = modPow(2n, a, N);

  it('A = g^a mod N igual ao da biblioteca da AWS', () => {
    expect(createHash('sha256').update(A.toString(16)).digest('hex')).toBe('65b901374f8756b43d62df7129aa1a3fc7b08e073c80ad36e40706b81461bbdb');
  });

  it('assinatura do PASSWORD_VERIFIER igual à da biblioteca da AWS', () => {
    const assinatura = assinaturaSrp({
      pool: 'TesteVetor1',
      idSrp: 'usuario-de-teste-0000',
      senha: 'senha-de-teste',
      a,
      A,
      B: BigInt(`0x${'b'.repeat(768)}`),
      saltHex: '5a1f00d1e2',
      secretBlock: 'YmxvY28tc2VjcmV0by1kZS10ZXN0ZQ==',
      agora: 'Thu Nov 19 14:03:07 UTC 2026',
    });
    expect(assinatura).toBe('IyBMzIbxJyaJmGa/M2XJtwnkbGCYV7PT1JiqextMyoE=');
  });

  it('padHex: tamanho par e zero à frente quando o bit alto está ligado', () => {
    expect(padHex(0xabcn)).toBe('0abc');
    expect(padHex(0x8fn)).toBe('008f');
    expect(padHex(0x7fn)).toBe('7f');
  });

  it('data no formato do Cognito (dia sem zero à esquerda, UTC)', () => {
    expect(dataCognito(new Date('2026-11-05T09:03:07Z'))).toBe('Thu Nov 5 09:03:07 UTC 2026');
  });
});
