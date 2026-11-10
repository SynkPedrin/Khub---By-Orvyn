import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import { ProblemDetailsFilter } from './problem-details.filter';
import { ConfigRequiredException } from '../config/config.service';
import type { ArgumentsHost } from '@nestjs/common';

/** Host falso: captura o corpo e o status enviados. */
function host(url = '/v1/teste') {
  const enviado: { status?: number; body?: any; header?: Record<string, string> } = { header: {} };
  const res = {
    setHeader: (k: string, v: string) => { enviado.header![k] = v; },
    status: (s: number) => { enviado.status = s; return res; },
    type: () => res,
    send: (b: unknown) => { enviado.body = b; return res; },
  };
  const req = { url, method: 'POST', headers: {} };
  return {
    h: { switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }) } as unknown as ArgumentsHost,
    enviado,
  };
}

describe('ProblemDetailsFilter (RFC 7807)', () => {
  const filtro = new ProblemDetailsFilter();

  it('erro simples vira problem+json com correlation-id', () => {
    const { h, enviado } = host();
    filtro.catch(new NotFoundException('contato inexistente'), h);
    expect(enviado.status).toBe(404);
    expect(enviado.body).toMatchObject({ type: 'https://orvyn.dev/errors/404', title: 'contato inexistente', status: 404, instance: '/v1/teste' });
    expect(enviado.body.correlationId).toBeTruthy();
    expect(enviado.header!['x-correlation-id']).toBe(enviado.body.correlationId);
  });

  it('preserva campos de extensão do serviço (problemas da validação de workflow)', () => {
    const { h, enviado } = host();
    const problemas = [{ noId: 'n1', problema: 'Enviar SMS: texto obrigatório' }];
    filtro.catch(new BadRequestException({ title: 'workflow inválido', problemas }), h);

    expect(enviado.status).toBe(400);
    // sem isto a UI mostra "Bad Request" e o usuário não sabe o que corrigir
    expect(enviado.body.problemas).toEqual(problemas);
    expect(enviado.body.title).toBe('workflow inválido');
  });

  it('gating: 501 com code/provider/missing (status continua numérico — invariante 3)', () => {
    const { h, enviado } = host();
    filtro.catch(new ConfigRequiredException('meta', ['META_APP_ID', 'META_APP_SECRET']), h);

    expect(enviado.status).toBe(501);
    expect(enviado.body).toMatchObject({
      status: 501, // RFC 7807: numérico, sempre
      code: 'config_required',
      provider: 'meta',
      missing: ['META_APP_ID', 'META_APP_SECRET'],
    });
  });

  it('erros do class-validator viram lista em `errors`, não somem', () => {
    const { h, enviado } = host();
    filtro.catch(new BadRequestException({ statusCode: 400, error: 'Bad Request', message: ['nome deve ser string', 'email inválido'] }), h);
    expect(enviado.body.errors).toEqual(['nome deve ser string', 'email inválido']);
    expect(enviado.body.statusCode).toBeUndefined(); // ruído do Nest não vaza
    expect(enviado.body.error).toBeUndefined();
  });

  it('erro não-HTTP vira 500 sem vazar a mensagem interna', () => {
    const { h, enviado } = host();
    filtro.catch(new Error('senha do banco é 1234'), h);
    expect(enviado.status).toBe(500);
    expect(enviado.body.title).toBe('Erro interno');
    expect(JSON.stringify(enviado.body)).not.toContain('1234');
  });

  it('`status` do payload não sobrescreve o código HTTP', () => {
    const { h, enviado } = host();
    filtro.catch(new HttpException({ status: 'config_required', provider: 'stevo' }, 501), h);
    expect(enviado.body.status).toBe(501);
    expect(typeof enviado.body.status).toBe('number');
  });
});
