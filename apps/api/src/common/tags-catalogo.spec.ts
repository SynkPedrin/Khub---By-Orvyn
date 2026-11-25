import { chaveParecida, garantirTagsNoCatalogo, normalizarTag, tagsDoGrafo } from './tags-catalogo';
import { hasPermission, permissionFor } from '../auth/permissions.guard';
import type { Prisma } from '@prisma/client';

describe('tags × automações (ADR-0055)', () => {
  it('lê a tag de cada papel do fluxo, inclusive condição e espera', () => {
    const grafo = {
      nos: [
        { id: 'g', tipo: 'gatilho.tag_adicionada', config: { tag: ' teste  ia ' } },
        { id: 'a', tipo: 'acao.adicionar_tag', config: { tag: 'metaads' } },
        { id: 'r', tipo: 'acao.remover_tag', config: { tag: 'follow-up' } },
        { id: 'u', tipo: 'acao.atualizar_contato', config: { tagsAdicionar: ['vip'], tagsRemover: ['lead frio'] } },
        { id: 's', tipo: 'gatilho.agendado', config: { alvo: 'segmento', tags: ['aniversariante'] } },
        { id: 'e', tipo: 'controle.esperar_ate', config: { modo: 'evento', evento: 'tag_adicionada', tag: 'pagou' } },
        { id: 'm', tipo: 'controle.meta', config: { evento: 'etapa_mudou', tag: 'ignorada' } },
        { id: 'c', tipo: 'controle.condicao', config: { ramos: [{ id: 'x', regras: [{ campo: 'contato.tags', operador: 'contem', valor: 'metaads' }, { campo: 'contato.email', operador: 'existe' }] }] } },
      ],
    };
    expect(tagsDoGrafo(grafo).map((u) => `${u.papel}:${u.tag}`)).toEqual([
      'gatilho:teste ia', 'adiciona:metaads', 'remove:follow-up', 'adiciona:vip', 'remove:lead frio',
      'segmento:aniversariante', 'espera:pagou', 'condicao:metaads',
    ]);
  });

  it('grafo vazio ou malformado não quebra', () => {
    expect(tagsDoGrafo(null)).toEqual([]);
    expect(tagsDoGrafo({ nos: [{ tipo: 'acao.adicionar_tag' }] })).toEqual([]);
  });

  it('normaliza e acha variações da mesma tag', () => {
    expect(normalizarTag('  Meta   Ads  ')).toBe('Meta Ads');
    expect(normalizarTag('x'.repeat(50))).toHaveLength(40);
    expect(chaveParecida('Meta Ads')).toBe(chaveParecida('meta-ads'));
    expect(chaveParecida('Serviço Escolhido')).toBe(chaveParecida('servico_escolhido'));
    expect(chaveParecida('vip')).not.toBe(chaveParecida('vip2'));
  });

  it('garante no catálogo uma vez por tag (sem repetir por caixa)', async () => {
    const exec = jest.fn().mockResolvedValue(1);
    await garantirTagsNoCatalogo({ $executeRaw: exec } as unknown as Prisma.TransactionClient, 't', ['VIP', 'vip', ' ', 'Lead Frio']);
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it('criar tag e sincronizar é de quem marca contato; renomear/excluir é da conta', () => {
    const u = (role: string) => ({ identityId: 'i', tenantId: 't', role, email: 'e' });
    expect(hasPermission(u('member'), permissionFor('settings', 'tags', 'POST'))).toBe(true);
    expect(hasPermission(u('manager'), permissionFor('settings', 'tags/sincronizar', 'POST'))).toBe(true);
    expect(hasPermission(u('member'), permissionFor('settings', 'tags/cruzamento', 'GET'))).toBe(true);
    expect(hasPermission(u('manager'), permissionFor('settings', 'tags/:id', 'PATCH'))).toBe(false);
    expect(hasPermission(u('manager'), permissionFor('settings', 'tags/:id', 'DELETE'))).toBe(false);
    expect(hasPermission(u('admin'), permissionFor('settings', 'tags/:id', 'DELETE'))).toBe(true);
    expect(hasPermission(u('viewer'), permissionFor('settings', 'tags', 'POST'))).toBe(false);
  });
});
