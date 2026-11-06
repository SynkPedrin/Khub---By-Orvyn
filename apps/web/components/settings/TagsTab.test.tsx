import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  tags: vi.fn(),
  createTag: vi.fn(),
  deleteTag: vi.fn(),
}));
vi.mock('@/lib/settings', () => ({ settingsApi: api }));

import { TagsTab } from './TagsTab';
import { ApiError } from '@/lib/api-error';

const tag = { id: 't1', name: 'cliente-vip', color: '#7B2EFF', descricao: '', usos: 3, createdAt: '2026-10-01' };

beforeEach(() => { api.tags.mockResolvedValue([tag]); api.createTag.mockResolvedValue(tag); api.deleteTag.mockResolvedValue(undefined); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('aba Tags (regressão: o botão "Criar tag" lia `scopes`, que só existe na aba de chaves de API, e derrubava a aba com ReferenceError)', () => {
  it('renderiza sem lançar e lista as tags existentes', async () => {
    render(<TagsTab />);
    expect(await screen.findByText('cliente-vip')).toBeTruthy();
    expect(screen.getByText('3 uso(s)')).toBeTruthy();
  });

  it('"Criar tag" começa desabilitado e habilita ao digitar o nome (sem depender de escopos)', async () => {
    render(<TagsTab />);
    await screen.findByText('cliente-vip');
    const botao = screen.getByRole('button', { name: /criar tag/i }) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('cliente-vip'), { target: { value: 'novo-lead' } });
    expect(botao.disabled).toBe(false);
  });

  it('cria a tag com nome aparado e cor padrão, e recarrega a lista', async () => {
    render(<TagsTab />);
    await screen.findByText('cliente-vip');
    fireEvent.change(screen.getByPlaceholderText('cliente-vip'), { target: { value: '  novo-lead  ' } });
    fireEvent.click(screen.getByRole('button', { name: /criar tag/i }));
    await waitFor(() => expect(api.createTag).toHaveBeenCalledWith({ name: 'novo-lead', color: '#7B2EFF' }));
    await waitFor(() => expect(api.tags).toHaveBeenCalledTimes(2));
  });

  it('mostra o erro da API em vez de falhar em silêncio', async () => {
    api.createTag.mockRejectedValue(new ApiError(409, { detail: 'Já existe uma tag com esse nome.' }));
    render(<TagsTab />);
    await screen.findByText('cliente-vip');
    fireEvent.change(screen.getByPlaceholderText('cliente-vip'), { target: { value: 'cliente-vip' } });
    fireEvent.click(screen.getByRole('button', { name: /criar tag/i }));
    expect(await screen.findByText('Já existe uma tag com esse nome.')).toBeTruthy();
  });

  it('estado vazio orienta o usuário', async () => {
    api.tags.mockResolvedValue([]);
    render(<TagsTab />);
    expect(await screen.findByText(/nenhuma tag ainda/i)).toBeTruthy();
  });
});
