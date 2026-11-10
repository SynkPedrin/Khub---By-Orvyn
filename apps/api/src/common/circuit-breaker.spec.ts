import { CircuitBreaker } from './circuit-breaker';

describe('CircuitBreaker', () => {
  it('abre após atingir o limite de falhas e falha rápido', async () => {
    const cb = new CircuitBreaker({ nome: 'teste', limiteFalhas: 3, cooldownMs: 10_000 });
    const boom = () => Promise.reject(new Error('externo caiu'));

    // 3 falhas reais chegam ao serviço
    for (let i = 0; i < 3; i++) {
      await expect(cb.run(boom)).rejects.toThrow('externo caiu');
    }
    // 4ª: circuito aberto → fail-fast, sem chamar a função
    let chamou = false;
    await expect(cb.run(async () => { chamou = true; return 1; })).rejects.toThrow(/circuito aberto/);
    expect(chamou).toBe(false);
  });

  it('meio-aberto: um sucesso fecha o circuito de novo', async () => {
    const cb = new CircuitBreaker({ nome: 'teste', limiteFalhas: 2, cooldownMs: -1 }); // cooldown vencido na hora
    const boom = () => Promise.reject(new Error('falha'));
    await expect(cb.run(boom)).rejects.toThrow();
    await expect(cb.run(boom)).rejects.toThrow(); // abre

    // cooldown negativo → já passou; a próxima é meio-aberta e deixa passar
    await expect(cb.run(async () => 'ok')).resolves.toBe('ok');
    // fechado: chamadas normais seguem
    await expect(cb.run(async () => 'ok2')).resolves.toBe('ok2');
  });
});
