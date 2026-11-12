// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cabecalhosParaApi, caminhoPublicoPermitido, ipDoVisitante } from './proxy';
import { corSegura, textoSobre } from './tipos';
import { campoNovo, codigosDeCompartilhar, novoIdCampo } from '../formularios';
import { horariosDaGrade } from '../paginas-agendamento';
import { mover } from '@/components/formularios/Construtor';

const TOKEN = 'a'.repeat(43);

describe('proxy público (/api/public)', () => {
  it.each(['forms/contato-site', 'forms/contato-site/submit', 'booking/consulta-1', 'booking/consulta-1/slots', 'booking/consulta-1/book', `reservas/${TOKEN}`, `reservas/${TOKEN}/ics`, `reservas/${TOKEN}/cancelar`])('repassa %s', (c) => expect(caminhoPublicoPermitido(c)).toBe(true));
  it.each(['forms', 'forms/../crm/contacts', 'crm/contacts', 'forms/x/submit', 'booking/consulta-1/admin', 'reservas/curto', 'forms/ABC-maiusculo'])('recusa %s', (c) => expect(caminhoPublicoPermitido(c)).toBe(false));

  it('IP do visitante: primeiro do x-forwarded-for; lixo é ignorado', () => {
    expect(ipDoVisitante(new Headers({ 'x-forwarded-for': '200.1.2.3, 10.0.0.1' }))).toBe('200.1.2.3');
    expect(ipDoVisitante(new Headers({ 'x-real-ip': '2804:14c::1' }))).toBe('2804:14c::1');
    expect(ipDoVisitante(new Headers({ 'x-forwarded-for': '<script>' }))).toBeNull();
  });

  it('só manda o IP para a API junto com o segredo do proxy', () => {
    const h = new Headers({ 'x-forwarded-for': '200.1.2.3' });
    const antes = process.env.KHUB_PROXY_SECRET;
    delete process.env.KHUB_PROXY_SECRET;
    expect(cabecalhosParaApi(h)['x-khub-client-ip']).toBeUndefined();
    process.env.KHUB_PROXY_SECRET = 's'.repeat(32);
    expect(cabecalhosParaApi(h)).toMatchObject({ 'x-khub-client-ip': '200.1.2.3', 'x-khub-proxy-secret': 's'.repeat(32) });
    if (antes === undefined) delete process.env.KHUB_PROXY_SECRET;
    else process.env.KHUB_PROXY_SECRET = antes;
  });
});

describe('marca do tenant', () => {
  it('só aceita #RRGGBB', () => {
    expect(corSegura('#b6ff00')).toBe('#b6ff00');
    expect(corSegura('red; background:url(x)')).toBeUndefined();
  });
  it('texto escuro em cor clara e claro em cor escura (tokens, sem cor literal)', () => {
    expect(textoSobre('#b6ff00')).toBe('var(--base-0)');
    expect(textoSobre('#1d1d6b')).toBe('var(--text)');
  });
});

describe('construtor de formulário', () => {
  it('id novo no formato aceito pela API e sem repetir', () => {
    const id = novoIdCampo('phone', []);
    expect(id).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
  });
  it('e-mail novo liga ao contato só se o e-mail ainda estiver livre', () => {
    const a = campoNovo('email', []);
    expect(a.mapear).toEqual({ tipo: 'nativo', campo: 'email' });
    expect(campoNovo('email', [a]).mapear).toBeNull();
  });
  it('reordenar move sem mutar', () => {
    const l = ['a', 'b', 'c'];
    expect(mover(l, 0, 2)).toEqual(['b', 'c', 'a']);
    expect(l).toEqual(['a', 'b', 'c']);
    expect(mover(l, 0, 5)).toBe(l);
  });
  it('códigos de compartilhar', () => {
    const c = codigosDeCompartilhar('https://app.exemplo.com', 'contato-site');
    expect(c.link).toBe('https://app.exemplo.com/f/contato-site');
    expect(c.iframe).toContain('src="https://app.exemplo.com/f/contato-site/embed"');
    expect(c.script).toContain('data-khub-form="contato-site"');
  });
});

describe('prévia da página de agendamento', () => {
  it('grade respeita duração + intervalo e o fim da faixa', () => {
    const p = { horarios: { '1': [{ de: '09:00', ate: '11:00' }] }, duracaoMin: 45, intervaloMin: 15 };
    expect(horariosDaGrade(p, '1')).toEqual(['09:00', '10:00']);
    expect(horariosDaGrade(p, '2')).toEqual([]);
  });
});
