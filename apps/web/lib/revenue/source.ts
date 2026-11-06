'use client';

import { useEffect, useState } from 'react';
import { modoDemo } from '../demo/flag';

/**
 * FONTE DE DADOS
 * ==============
 *
 * Decide, num lugar só, se a tela lê dado real ou dado de vitrine — e nunca
 * mistura os dois. Meia tela real com meia tela fabricada é a pior variante
 * possível: o operador não tem como saber em qual metade confiar.
 *
 * Estados possíveis:
 *   carregando → o que a tela mostra como esqueleto
 *   pronto     → tem dado (real ou demo, e a tela sabe qual)
 *   vazio      → consultou e não há nada (não é erro)
 *   erro       → falhou; a tela oferece "tentar de novo"
 */
export type Estado<T> =
  | { fase: 'carregando' }
  | { fase: 'pronto'; dados: T; demo: boolean }
  | { fase: 'vazio'; demo: boolean }
  | { fase: 'erro'; mensagem: string; recarregar: () => void };

/**
 * Carrega dados de um módulo.
 *
 * @param buscarReal   consulta a API de verdade. Se o módulo ainda não tem
 *                     backend, passe `null` — a tela cai em "vazio" em vez de
 *                     inventar número.
 * @param dadosDemo    função que devolve o dataset de vitrine. Só é chamada
 *                     quando `modoDemo()` é verdadeiro.
 * @param estaVazio    como saber que a resposta veio sem conteúdo.
 */
export function useFonte<T>(
  buscarReal: (() => Promise<T>) | null,
  dadosDemo: () => T,
  estaVazio?: (d: T) => boolean,
): Estado<T> {
  const [estado, setEstado] = useState<Estado<T>>({ fase: 'carregando' });
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let vivo = true;
    const recarregar = () => setTentativa((n) => n + 1);

    // Modo demo: síncrono, sem rede. O selo "DEMO" fica visível na tela.
    if (modoDemo()) {
      const d = dadosDemo();
      setEstado({ fase: 'pronto', dados: d, demo: true });
      return;
    }

    if (!buscarReal) {
      // Módulo sem backend ainda. Tela vazia honesta.
      setEstado({ fase: 'vazio', demo: false });
      return;
    }

    setEstado({ fase: 'carregando' });
    buscarReal()
      .then((d) => {
        if (!vivo) return;
        if (estaVazio?.(d)) setEstado({ fase: 'vazio', demo: false });
        else setEstado({ fase: 'pronto', dados: d, demo: false });
      })
      .catch((e: unknown) => {
        if (!vivo) return;
        setEstado({
          fase: 'erro',
          mensagem: e instanceof Error ? e.message : 'Falha ao carregar os dados.',
          recarregar,
        });
      });

    return () => {
      vivo = false;
    };
    // `dadosDemo`/`estaVazio` são estáveis por chamada; reagir a eles causaria
    // refetch a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscarReal, tentativa]);

  return estado;
}
