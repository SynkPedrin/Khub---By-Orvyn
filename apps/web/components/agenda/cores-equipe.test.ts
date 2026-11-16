import { describe, expect, it } from 'vitest';
import { COR_SEM_PROFISSIONAL, MARCA_STATUS, PALETA_EQUIPE, paletaEquipe, procedimento } from './cores-equipe';

describe('cores da equipe na agenda', () => {
  const profs = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}` }));

  it('catálogo grande (23, como o importado do Avec): quem aparece no dia nunca divide cor', () => {
    const grande = Array.from({ length: 23 }, (_, i) => ({ id: `g${String(i).padStart(2, '0')}` }));
    const doDia = ['g00', 'g08', 'g13', 'g20', 'g21', 'g03', 'g05', 'g11'];
    const cor = paletaEquipe(grande, [...doDia, null, 'g00']);
    expect(new Set(doDia.map((id) => cor(id).faixa)).size).toBe(doDia.length);
    // ordem do catálogo: g00 fica com a primeira cor
    expect(cor('g00')).toBe(PALETA_EQUIPE[0]);
  });

  it('as 12 primeiras profissionais nunca repetem cor', () => {
    const cor = paletaEquipe(profs);
    expect(new Set(profs.map((p) => cor(p.id).faixa)).size).toBe(12);
  });

  it('cor é estável e segue a ordem do catálogo', () => {
    expect(paletaEquipe(profs)('p3')).toBe(PALETA_EQUIPE[3]);
    expect(paletaEquipe(profs)('p3')).toBe(paletaEquipe(profs)('p3'));
  });

  it('fora do catálogo ganha cor estável; sem profissional fica neutro', () => {
    const cor = paletaEquipe(profs);
    expect(cor('removida')).toBe(cor('removida'));
    expect(PALETA_EQUIPE).toContain(cor('removida'));
    expect(cor(null)).toBe(COR_SEM_PROFISSIONAL);
  });

  it('status vira marcador, não cor', () => {
    expect(MARCA_STATUS.agendado.icone).toBeNull();
    expect(MARCA_STATUS.confirmado.icone).toBe('check');
    expect(MARCA_STATUS.faltou.bloco).toContain('outline-dashed');
  });

  it('procedimento usa o serviço e cai no título', () => {
    expect(procedimento({ servicoNome: 'Manutenção Cílios', titulo: 'x' })).toBe('Manutenção Cílios');
    expect(procedimento({ servicoNome: null, titulo: 'Reunião' })).toBe('Reunião');
  });
});
