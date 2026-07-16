'use client';

import { useState } from 'react';
import { AppSidebar } from '@/components/app/AppSidebar';
import { DynamicIsland } from '@/components/app/DynamicIsland';
import { NyroDock } from '@/components/app/NyroDock';
import { CommandBar } from '@/components/app/CommandBar';
import { Icon } from '@/components/icons';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [drawer, setDrawer] = useState(false);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* faixa reservada para a ilha dinâmica (fixed) */}
      <div className="h-[7.5rem] shrink-0" />

      <div className="flex min-h-0 flex-1">
        {/* Sidebar de vidro flutuante (desktop) */}
        <aside className="hidden shrink-0 pb-3 pl-3 pr-1 lg:block">
          <AppSidebar />
        </aside>

        {/* Conteúdo */}
        <main className="min-w-0 flex-1 overflow-y-auto scrollbar-thin pr-1">{children}</main>
      </div>

      {/* Ilha dinâmica (logo canto superior esquerdo + navbar no hover) */}
      <DynamicIsland onMobileMenu={() => setDrawer(true)} />

      {/* Drawer mobile */}
      {drawer && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDrawer(false)} />
          <div className="absolute left-3 top-3 bottom-3 animate-fade-in">
            <button className="absolute -right-11 top-2 rounded-full bg-surface p-2 text-fg shadow-card" onClick={() => setDrawer(false)}>
              <Icon name="close" />
            </button>
            <AppSidebar onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      )}

      <NyroDock />
      <CommandBar />
    </div>
  );
}
