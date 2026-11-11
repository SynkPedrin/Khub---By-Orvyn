import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Confirm, Menu, Modal, ToastProvider, useToast } from './index';
import { conversaoHonesta } from '@/lib/revenue/conversao';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.style.overflow = '';
});

function Disparador() {
  const toast = useToast();
  return (
    <>
      <button onClick={() => toast.success('Etapa atualizada.')}>ok</button>
      <button onClick={() => toast.error('Não foi possível mover.', { description: 'Tente de novo.' })}>erro</button>
      <button onClick={() => toast.info('Sem prazo.', { duration: 0 })}>fixo</button>
    </>
  );
}

describe('Toast', () => {
  it('anuncia sucesso numa região polite e erro numa região assertive', () => {
    render(
      <ToastProvider>
        <Disparador />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('ok'));
    fireEvent.click(screen.getByText('erro'));
    const status = screen.getByRole('status');
    const alerta = screen.getByRole('alert');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(alerta.getAttribute('aria-live')).toBe('assertive');
    expect(status.textContent).toContain('Etapa atualizada.');
    expect(alerta.textContent).toContain('Não foi possível mover.');
    expect(alerta.textContent).toContain('Tente de novo.');
  });

  it('empilha, respeita o máximo e some sozinho no prazo (erro dura mais)', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider max={2}>
        <Disparador />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('ok'));
    fireEvent.click(screen.getByText('ok'));
    fireEvent.click(screen.getByText('erro'));
    // max=2: o mais antigo saiu.
    expect(screen.getAllByText('Etapa atualizada.')).toHaveLength(1);
    expect(screen.getByText('Não foi possível mover.')).toBeTruthy();
    act(() => vi.advanceTimersByTime(4100));
    expect(screen.queryByText('Etapa atualizada.')).toBeNull();
    expect(screen.getByText('Não foi possível mover.')).toBeTruthy();
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.queryByText('Não foi possível mover.')).toBeNull();
  });

  it('fecha no X e `duration: 0` não some sozinho', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Disparador />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('fixo'));
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText('Sem prazo.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar aviso' }));
    expect(screen.queryByText('Sem prazo.')).toBeNull();
  });

  it('fora do provider não quebra a tela', () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(<Disparador />);
    expect(() => fireEvent.click(screen.getByText('ok'))).not.toThrow();
    aviso.mockRestore();
  });
});

function ComModal() {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button onClick={() => setAberto(true)}>Abrir</button>
      <Modal open={aberto} onClose={() => setAberto(false)} title="Editar negócio" footer={<button>Salvar</button>}>
        <input aria-label="Título" />
      </Modal>
    </>
  );
}

describe('Modal (foco)', () => {
  it('é um diálogo modal rotulado pelo título e trava a rolagem', () => {
    render(<ComModal />);
    fireEvent.click(screen.getByText('Abrir'));
    const dialogo = screen.getByRole('dialog');
    expect(dialogo.getAttribute('aria-modal')).toBe('true');
    expect(dialogo.getAttribute('aria-labelledby')).toBe(screen.getByText('Editar negócio').id);
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('foca o primeiro controle, prende o Tab dentro e volta o foco ao fechar com Esc', () => {
    render(<ComModal />);
    const abrir = screen.getByText('Abrir');
    abrir.focus();
    fireEvent.click(abrir);
    const fechar = screen.getByRole('button', { name: 'Fechar' });
    const salvar = screen.getByRole('button', { name: 'Salvar' });
    expect(document.activeElement).toBe(fechar);

    // Tab no último volta ao primeiro; Shift+Tab no primeiro vai ao último.
    salvar.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(fechar);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(salvar);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(abrir);
    expect(document.body.style.overflow).toBe('');
  });

  it('Confirm foca "Cancelar" (Enter por engano não exclui) e só o do topo responde ao Esc', () => {
    const fecharModal = vi.fn();
    const fecharConfirm = vi.fn();
    // Como na tela: o Confirm abre depois, sobre um diálogo já aberto.
    const arvore = (confirmAberto: boolean) => (
      <Modal open onClose={fecharModal} title="Negócio">
        <Confirm open={confirmAberto} onClose={fecharConfirm} onConfirm={() => undefined} title="Excluir?" />
      </Modal>
    );
    const { rerender } = render(arvore(false));
    rerender(arvore(true));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(fecharConfirm).toHaveBeenCalledTimes(1);
    expect(fecharModal).not.toHaveBeenCalled();
  });
});

describe('Menu (teclado)', () => {
  it('abre com seta, navega, escolhe com Enter e devolve o foco', () => {
    const mover = vi.fn();
    render(
      <Menu
        label="Ações"
        trigger="..."
        items={[
          { type: 'label', id: 'r', label: 'Mover para' },
          { id: 'a', label: 'Proposta', onSelect: () => mover('a') },
          { id: 'b', label: 'Negociação', onSelect: () => mover('b') },
        ]}
      />,
    );
    const botao = screen.getByRole('button', { name: 'Ações' });
    botao.focus();
    fireEvent.keyDown(botao, { key: 'ArrowDown' });
    const itens = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(itens[0]);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(itens[1]);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Enter' });
    expect(mover).toHaveBeenCalledWith('b');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(botao);
  });

  it('Esc fecha sem escolher', () => {
    const escolher = vi.fn();
    render(<Menu label="Ações" trigger="..." items={[{ id: 'a', label: 'Proposta', onSelect: escolher }]} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Ações' }), { key: 'Enter' });
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(escolher).not.toHaveBeenCalled();
  });
});

describe('conversaoHonesta (dashboard)', () => {
  const base = { contatos: 10, negocios: 3, valorFunil: 1000, ganho: 500 };
  it('com menos de 5 fechados mostra "Poucos dados" e a contagem real, não 100%', () => {
    expect(conversaoHonesta({ ...base, conversao: 100, conversaoBase: 'fechados', ganhos: 1, perdidos: 0 })).toEqual({
      value: 'Poucos dados',
      comparacao: '1 de 1 fechado ganho',
    });
  });
  it('com 5 ou mais fechados mostra o percentual com a base', () => {
    const r = conversaoHonesta({ ...base, conversao: 60, conversaoBase: 'fechados', ganhos: 3, perdidos: 2 });
    expect(r.value).toMatch(/60/);
    expect(r.comparacao).toBe('3 de 5 fechados ganhos');
  });
  it('sem nenhum fechamento não inventa taxa', () => {
    expect(conversaoHonesta({ ...base, conversao: 40, conversaoBase: 'etapa_final' }).value).toBe('Poucos dados');
    expect(conversaoHonesta({ ...base, conversao: 0, conversaoBase: null }).value).toBe('Poucos dados');
  });
});
