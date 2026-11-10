'use client';

import { motion } from 'framer-motion';
import { usePathname } from 'next/navigation';
import { pageVariants } from '@/lib/motion';

/**
 * Entrada suave do conteúdo de rota: fade + leve subida (sem blur, Q1.7).
 *
 * Deliberadamente SEM `AnimatePresence`/`exit`: isso exigiria desmontar a
 * página anterior antes de montar a próxima, o que conflita com streaming,
 * Suspense e layouts persistentes do App Router (pode prender a navegação
 * ou gerar tela em branco). `key={pathname}` já é suficiente pra disparar
 * a animação de entrada a cada rota nova, sem esse risco.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <motion.div key={pathname} variants={pageVariants} initial="initial" animate="animate">
      {children}
    </motion.div>
  );
}
