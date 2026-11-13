import { describe, expect, it } from 'vitest';
import { PRIMARY_NAV } from '@/components/shell/nav';
import { filtrarPorModulos, moduloDaRota, podeVer, telaInicial } from './modulos';

describe('acesso por módulo (ADR-0045)', () => {
  it('sem restrição, vê tudo', () => {
    expect(podeVer(null, '/nyro')).toBe(true);
    expect(filtrarPorModulos(PRIMARY_NAV, undefined)).toHaveLength(PRIMARY_NAV.length);
  });

  it('rota de subtela pertence ao módulo', () => {
    expect(moduloDaRota('/agentes/123')).toBe('ia');
    expect(moduloDaRota('/conversas')).toBe('conversas');
    expect(moduloDaRota('/configuracoes')).toBeNull();
  });

  it('colaborador sem IA não vê NICO nem Agentes; configurações sempre aparecem', () => {
    const menu = filtrarPorModulos(PRIMARY_NAV, ['conversas', 'agenda']).map((i) => i.href);
    expect(menu).toEqual(['/conversas', '/agenda', '/configuracoes']);
    expect(podeVer(['conversas'], '/agentes')).toBe(false);
  });

  it('liberar a IA faz NICO e Agentes aparecerem', () => {
    const menu = filtrarPorModulos(PRIMARY_NAV, ['conversas', 'ia']).map((i) => i.href);
    expect(menu).toContain('/nyro');
    expect(menu).toContain('/agentes');
  });

  it('todo item do menu principal tem módulo, menos Configurações', () => {
    const semModulo = PRIMARY_NAV.filter((i) => moduloDaRota(i.href) === null).map((i) => i.href);
    expect(semModulo).toEqual(['/configuracoes']);
  });

  it('tela inicial é a primeira liberada', () => {
    expect(telaInicial(null)).toBe('/dashboard');
    expect(telaInicial(['agenda', 'conversas'])).toBe('/conversas');
    expect(telaInicial([])).toBe('/configuracoes');
  });
});
