'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/shell/Sidebar';
import { Topbar } from '@/components/shell/Topbar';
import { OrvynSignature } from '@/components/shell/OrvynMark';
import { AmbientBackground } from '@/components/shell/AmbientBackground';
import { PageTransition } from '@/components/shell/PageTransition';
import { PersonalizationProvider } from '@/components/app/PersonalizationProvider';
import { CommandBar } from '@/components/app/CommandBar';
import { Icon } from '@/components/icons';

/**
 * Shell do ORVYN Revenue OS.
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

  // Drawer aberto trava o scroll do corpo (senão a página rola por baixo).
  useEffect(() => {
    if (!drawer) return;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = anterior;
    };
  }, [drawer]);

  return (
    <PersonalizationProvider>
      <a href="#conteudo" className="skip-link">
        Pular para o conteúdo
      </a>

      <AmbientBackground />

      <div className="relative flex h-screen overflow-hidden">
        {/* Sidebar flutuante — desktop */}
        <aside className="hidden shrink-0 p-3 lg:block">
          <Sidebar />
        </aside>

        {/* Coluna de conteúdo */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="p-3 pb-0">
            <Topbar onMobileMenu={() => setDrawer(true)} />
          </div>

          <main id="conteudo" className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
            <PageTransition>{children}</PageTransition>
            <OrvynSignature className="border-t border-line" />
          </main>
        </div>

        {/* Drawer de navegação — mobile e tablet */}
        {drawer && (
          <div className="fixed inset-0 z-drawer lg:hidden">
            <button
              type="button"
              className="lg-backdrop absolute inset-0"
              onClick={() => setDrawer(false)}
              aria-label="Fechar menu de navegação"
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
      </div>
    </PersonalizationProvider>
  );
}
