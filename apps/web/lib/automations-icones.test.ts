import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COR_FAMILIA, TIPOS_COM_SIMBOLO, familiaDoTipo } from '@/components/automations/IconeNo';

// Fonte da verdade dos tipos de nó: o catálogo da API.
const catalogo = readFileSync(join(__dirname, '../../api/src/automations/catalogo.ts'), 'utf8');
const TIPOS = [...new Set([...catalogo.matchAll(/tipo: '((?:gatilho|controle|acao)\.[a-z_]+)'/g)].map((m) => m[1]))];

describe('logos dos nós de automação', () => {
  it('lê os tipos do catálogo da API', () => {
    expect(TIPOS.length).toBeGreaterThanOrEqual(40);
  });
  it('todo gatilho, controle e ação do catálogo tem logo própria desenhada', () => {
    expect(TIPOS.filter((t) => !TIPOS_COM_SIMBOLO.includes(t))).toEqual([]);
  });
  it('toda família tem cor e os nós de IA ficam na família IA', () => {
    for (const t of TIPOS) expect(COR_FAMILIA[familiaDoTipo(t)]).toBeDefined();
    expect(familiaDoTipo('acao.ia')).toBe('ia');
    expect(familiaDoTipo('acao.ativar_ia')).toBe('ia');
    expect(familiaDoTipo('gatilho.tag_adicionada')).toBe('tag');
    expect(familiaDoTipo('gatilho.agendamento_criado')).toBe('agenda');
  });
});
