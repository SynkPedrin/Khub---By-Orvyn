'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { MotionConfig } from 'framer-motion';
import { Sidebar } from '@/components/shell/Sidebar';
import { Topbar } from '@/components/shell/Topbar';
import { BrandSignature } from '@/components/shell/BrandMark';
import { AmbientBackground } from '@/components/shell/AmbientBackground';
import { PageTransition } from '@/components/shell/PageTransition';
import { PersonalizationProvider } from '@/components/app/PersonalizationProvider';
import { CommandBar } from '@/components/app/CommandBar';
import { NyroDock } from '@/components/app/NyroDock';
import { Icon } from '@/components/icons';
import { ToastProvider, useFocusTrap, useScrollLock } from '@/components/kit';

/**
 * Shell do KHUB Revenue OS.
 *
 * Duas superfícies de Liquid Glass flutuando sobre o ambient (ADR-0029):
 * sidebar à esquerda e topbar no topo. O conteúdo rola por baixo delas.
 *
 * Layout: a sidebar é fixa e não rola; só o `<main>` rola. Isso mantém a
 * navegação sempre alcançável em telas densas (pipeline, inbox, canvas).
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const pathname = usePathname();

  // Navegar fecha o drawer — inclusive quando a navegação parte de um link
  // dentro do conteúdo, não só da sidebar.
  useEffect(() => {
    setDrawer(false);
  }, [pathname]);

  // Drawer mobile é um diálogo: trava a rolagem do corpo, prende o foco,
  // fecha com Esc e devolve o foco ao botão do menu (Q1.8).
  const gaveta = useRef<HTMLDivElement>(null);
  useScrollLock(drawer);
  useFocusTrap(gaveta, drawer, { onEsc: () => setDrawer(false) });

  return (
    // "Reduzir movimento" do sistema desliga transform/layout do framer-motion
    // na área logada inteira (o CSS global já zera as animações de CSS).
    <MotionConfig reducedMotion="user">
    <ToastProvider>
    <PersonalizationProvider>
      <a href="#conteudo" className="skip-link">
        Pular para o conteúdo
      </a>

      <AmbientBackground />

      <div className="relative flex h-[100dvh] overflow-hidden">
        {/* Sidebar flutuante — desktop */}
        <aside className="hidden shrink-0 p-3 lg:block">
          <Sidebar />
        </aside>

        {/* Coluna de conteúdo */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="p-3 pb-0">
            <Topbar onMobileMenu={() => setDrawer(true)} />
          </div>

          <main id="conteudo" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
            {/* Assinatura sempre no pé: em página curta não flutua no meio (ADR-0036). */}
            <div className="flex min-h-full flex-col">
              <div className="flex-1">
                <PageTransition>{children}</PageTransition>
              </div>
              <BrandSignature className="border-t border-line" />
            </div>
          </main>
        </div>

        {/* Drawer de navegação — mobile e tablet */}
        {drawer && (
          <div
            ref={gaveta}
            className="fixed inset-0 z-drawer lg:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Menu de navegação"
          >
            <button
              type="button"
              className="lg-backdrop absolute inset-0"
              onClick={() => setDrawer(false)}
              aria-label="Fechar menu de navegação"
              // Só para o toque/clique fora; no teclado o X e o Esc fecham.
              tabIndex={-1}
            />
            <div className="absolute inset-y-0 left-0 animate-fade-in p-2">
              <Sidebar onNavigate={() => setDrawer(false)} />
            </div>
            <button
              type="button"
              className="btn btn-icon btn-sm absolute left-[calc(var(--sidebar-w)+20px)] top-4"
              onClick={() => setDrawer(false)}
              aria-label="Fechar menu"
            >
              <Icon name="close" size={18} />
            </button>
          </div>
        )}

        <CommandBar />
        {/* NICO, a agente interna de marketing, à mão em qualquer tela (ADR-0040). */}
        <NyroDock />
      </div>
    </PersonalizationProvider>
    </ToastProvider>
    </MotionConfig>
  );
}
