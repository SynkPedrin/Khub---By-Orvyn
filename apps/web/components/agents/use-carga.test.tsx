import { it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, cleanup, waitFor } from '@testing-library/react';
import { useCarga } from './kit';
afterEach(cleanup);
it('resposta antiga não substitui o período atual nem aparece sob o filtro novo', async () => {
  let resolver!: (n: string) => void;
  const lenta = new Promise<string>((r) => { resolver = r; });
  const fn = vi.fn((periodo: number) => periodo === 30 ? lenta : Promise.resolve('7 dias'));
  function Tela({ periodo }: { periodo: number }) {
    const carga = useCarga(() => fn(periodo), [periodo]);
    return <p>{carga.carregando ? 'Carregando' : carga.dados}</p>;
  }
  const { rerender } = render(<Tela periodo={30} />);
  rerender(<Tela periodo={7} />);
  await waitFor(() => expect(screen.getByText('7 dias')).toBeTruthy());
  await act(async () => resolver('30 dias'));
  expect(screen.queryByText('30 dias')).toBeNull();
  expect(screen.getByText('7 dias')).toBeTruthy();
});
