'use client';

import { Icon } from '../icons';
import { seloDemo } from '@/lib/demo/flag';

/**
 * Selo de modo demonstração.
 *
 * Aparece no cabeçalho de toda tela enquanto o modo demo está ativo. Não é
 * decoração: é a garantia de que ninguém confunde vitrine com operação. Em
 * produção não renderiza nada.
 */
export function SeloDemo() {
  const rotulo = seloDemo();
  if (!rotulo) return null;

  return (
    <span className="pill pill-warning" title="Os números desta tela são fabricados para demonstração da interface.">
      <Icon name="info" size={12} />
      {rotulo}
    </span>
  );
}
