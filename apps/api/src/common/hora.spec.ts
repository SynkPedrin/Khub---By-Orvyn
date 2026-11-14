import { horaCurta } from './hora';

describe('horaCurta', () => {
  const original = process.env.APP_TIMEZONE;
  afterEach(() => { process.env.APP_TIMEZONE = original; });

  it('usa o fuso de Brasília por padrão, não o do servidor (Render roda em UTC)', () => {
    delete process.env.APP_TIMEZONE;
    expect(horaCurta(new Date('2026-11-13T14:05:00Z'))).toBe('11:05');
  });

  it('respeita APP_TIMEZONE', () => {
    process.env.APP_TIMEZONE = 'America/Manaus';
    expect(horaCurta(new Date('2026-11-13T14:05:00Z'))).toBe('10:05');
  });
});
