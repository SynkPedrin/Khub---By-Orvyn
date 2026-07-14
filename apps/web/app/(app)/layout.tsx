'use client';

import { useState } from 'react';
import { AppSidebar } from '@/components/app/AppSidebar';
import { AppTopbar } from '@/components/app/AppTopbar';
import { NyroDock } from '@/components/app/NyroDock';
import { CommandBar } from '@/components/app/CommandBar';
import { Icon } from '@/components/icons';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [drawer, setDrawer] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      {/* Sidebar desktop */}
      <aside className="hidden shrink-0 lg:block">
        <AppSidebar />
      </aside>

      {/* Drawer mobile */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
          <div className="absolute left-0 top-0 h-full animate-fade-in shadow-pop">
            <button className="absolute -right-11 top-3 rounded-lg bg-surface p-2 text-fg" onClick={() => setDrawer(false)}>
              <Icon name="close" />
            </button>
            <AppSidebar onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopbar onMenu={() => setDrawer(true)} />
        <main className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">{children}</main>
      </div>

      <NyroDock />
      <CommandBar />
    </div>
  );
}
