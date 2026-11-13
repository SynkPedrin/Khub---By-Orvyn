import { TRANSICOES, totalDaProposta, itensSchema } from './proposals.service';
import { statusDoCliente } from './carteira.service';
import { normalizarLinha, valorBR } from './importacao.service';
import { hasPermission, permissionFor } from '../auth/permissions.guard';
import type { AuthUser } from '../auth/decorators';

describe('Propostas — total e máquina de estados (ADR-0042)', () => {
  it('total = Σ quantidade × unitário − desconto, em centavos exatos', () => {
    expect(totalDaProposta([{ descricao: 'Progressiva', quantidade: 3, valorUnitario: 0.1 }], 0)).toBe(0.3);
    expect(totalDaProposta([{ descricao: 'A', quantidade: 2, valorUnitario: 150 }, { descricao: 'B', quantidade: 1, valorUnitario: 49.9 }], 20)).toBe(329.9);
  });
  it('desconto maior que o bruto não deixa total negativo', () => {
    expect(totalDaProposta([{ descricao: 'A', quantidade: 1, valorUnitario: 10 }], 50)).toBe(0);
  });
  it('item inválido é recusado com motivo', () => {
    expect(itensSchema.safeParse([{ descricao: '', quantidade: 1, valorUnitario: 1 }]).success).toBe(false);
    expect(itensSchema.safeParse([{ descricao: 'x', quantidade: 0, valorUnitario: 1 }]).success).toBe(false);
    expect(itensSchema.safeParse([{ descricao: 'x', quantidade: 1, valorUnitario: -1 }]).success).toBe(false);
  });
  it('transições: só envia rascunho; aceite/recusa só de enviada/expirada; reabrir volta a rascunho', () => {
    expect(TRANSICOES.enviar).toEqual({ de: ['rascunho'], para: 'enviada' });
    expect(TRANSICOES.aceitar.de).not.toContain('rascunho');
    expect(TRANSICOES.recusar.de).not.toContain('aceita');
    expect(TRANSICOES.reabrir.para).toBe('rascunho');
    expect(TRANSICOES.cancelar.de).not.toContain('aceita');
  });
});

describe('Carteira — status do cliente', () => {
  it('ativo até o limite, em risco até o segundo limite, depois inativo', () => {
    expect(statusDoCliente(0, 90, 180)).toBe('ativo');
    expect(statusDoCliente(90, 90, 180)).toBe('ativo');
    expect(statusDoCliente(91, 90, 180)).toBe('em_risco');
    expect(statusDoCliente(180, 90, 180)).toBe('em_risco');
    expect(statusDoCliente(181, 90, 180)).toBe('inativo');
  });
});

describe('Importação — normalização de linha', () => {
  it('junta primeiro nome + sobrenome (export do GHL) e normaliza telefone com DDI', () => {
    const r = normalizarLinha({ primeiroNome: 'Marina', sobrenome: 'Alves', telefone: '(11) 97777-1234', email: ' MARINA@EXEMPLO.COM ' });
    expect(r).toMatchObject({ nome: 'Marina Alves', telefone: '5511977771234', email: 'marina@exemplo.com' });
  });
  it('telefone já com DDI fica como está; curto demais é descartado', () => {
    expect(normalizarLinha({ nome: 'A', telefone: '+55 11 97777-1234' }).telefone).toBe('5511977771234');
    expect(normalizarLinha({ nome: 'A', telefone: '1234' }).telefone).toBeNull();
  });
  it('tags separadas por vírgula, ponto e vírgula ou barra, sem repetição', () => {
    expect(normalizarLinha({ nome: 'A', tags: 'cliente, vip;vip|meta ads' }).tags).toEqual(['cliente', 'vip', 'meta ads']);
  });
  it('linha sem nome, e-mail e telefone é erro legível', () => {
    expect(() => normalizarLinha({ empresa: 'X' })).toThrow('linha sem nome, e-mail ou telefone');
  });
  it('sem nome usa e-mail ou telefone como nome', () => {
    expect(normalizarLinha({ email: 'a@b.com' }).nome).toBe('a@b.com');
  });
  it('campo personalizado com chave inválida é ignorado; cidade e observação viram campos', () => {
    const r = normalizarLinha({ nome: 'A', cidade: 'Campinas', observacao: 'veio do GHL', campos: { 'chave valida': 'x', procedimento: 'progressiva' } });
    expect(r.campos).toEqual({ procedimento: 'progressiva', cidade: 'Campinas', observacao_importacao: 'veio do GHL' });
  });
  it('valor no formato brasileiro', () => {
    expect(valorBR('R$ 1.234,56')).toBe(1234.56);
    expect(valorBR('1234.5')).toBe(1234.5);
    expect(valorBR('abc')).toBeNull();
    expect(valorBR('')).toBeNull();
  });
});

describe('Permissões — estrutura do funil e importação são de gestor (ADR-0042)', () => {
  const papel = (role: string): AuthUser => ({ identityId: 'i', tenantId: 't', role, email: 'e' });
  it('mover negócio continua liberado para member; mexer na estrutura não', () => {
    expect(permissionFor('crm', 'deals/:id/stage', 'PATCH')).toBe('pipeline.write');
    expect(permissionFor('crm', 'pipelines', 'POST')).toBe('pipeline.configure');
    expect(permissionFor('crm', 'stages/:id', 'DELETE')).toBe('pipeline.configure');
    expect(permissionFor('crm', 'pipelines', 'GET')).toBe('pipeline.read');
    expect(hasPermission(papel('member'), 'pipeline.configure')).toBe(false);
    expect(hasPermission(papel('manager'), 'pipeline.configure')).toBe(true);
    expect(hasPermission(papel('admin'), 'pipeline.configure')).toBe(true);
  });
  it('importação: manager sim, member e viewer não', () => {
    expect(permissionFor('crm', 'import/contacts', 'POST')).toBe('contacts.import');
    expect(hasPermission(papel('manager'), 'contacts.import')).toBe(true);
    expect(hasPermission(papel('member'), 'contacts.import')).toBe(false);
    expect(hasPermission(papel('viewer'), 'contacts.import')).toBe(false);
  });
  it('propostas seguem o funil: member escreve, viewer só lê', () => {
    expect(permissionFor('crm', 'proposals', 'POST')).toBe('pipeline.write');
    expect(hasPermission(papel('member'), 'pipeline.write')).toBe(true);
    expect(hasPermission(papel('viewer'), permissionFor('crm', 'proposals', 'GET'))).toBe(true);
    expect(hasPermission(papel('viewer'), 'pipeline.write')).toBe(false);
  });
  it('remover membro exige users.manage; sair de todos os dispositivos é do próprio usuário', () => {
    expect(permissionFor('settings', 'members/:identityId', 'DELETE')).toBe('users.manage');
    expect(hasPermission(papel('manager'), 'users.manage')).toBe(false);
    expect(permissionFor('settings', 'sessions/revoke-all', 'POST')).toBe('profile.read');
    expect(hasPermission(papel('viewer'), 'profile.read')).toBe(true);
  });
});
