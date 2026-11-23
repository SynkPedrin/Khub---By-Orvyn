'use client';

import { useState } from 'react';
import { Button, Select, Switch, Textarea, Modal, Tooltip, SkeletonLines, useToast, AnimatedNumber } from '@/components/kit';
import { EmptyState } from '@/components/revenue/States';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';

/**
 * /design-system — brand board vivo do KHUB v2 (docs/brand/02-direcao-de-arte.md).
 * Logo, cores com contraste, tipografia, gradientes, glass, ícones e
 * componentes com todos os estados, nos dois temas (toggle no topo).
 */

function Secao({ titulo, desc, children }: { titulo: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 border-t border-line pt-8">
      <header>
        <h2 className="font-display text-xl font-semibold tracking-tight text-fg">{titulo}</h2>
        {desc && <p className="mt-1 text-sm text-muted">{desc}</p>}
      </header>
      {children}
    </section>
  );
}

function Amostra({ nome, cor, texto = '#f4f4f6' }: { nome: string; cor: string; texto?: string }) {
  return (
    <div className="overflow-hidden rounded-card border border-line">
      <div className="flex h-16 items-end p-2" style={{ background: cor }}>
        <span className="font-mono text-2xs" style={{ color: texto }}>{cor}</span>
      </div>
      <div className="bg-surface px-2 py-1.5 text-2xs text-muted">{nome}</div>
    </div>
  );
}

export default function DesignSystemPage() {
  const toast = useToast();
  const [modal, setModal] = useState(false);
  const [tema, setTema] = useState<'dark' | 'light'>('dark');
  const [numero, setNumero] = useState(22401);
  const [sel, setSel] = useState('30d');
  const [liga, setLiga] = useState(true);

  const mudaTema = (t: 'dark' | 'light') => {
    setTema(t);
    document.documentElement.setAttribute('data-theme', t);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-10 px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-lime-ink">KHUB · Brand board v2</p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-fg">Signal + Intelligence</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Lime = sinal (ação). Violeta = inteligência (IA). Vidro = camada. Aurora = momento. Referência: docs/brand/.
          </p>
        </div>
        <Select
          size="sm"
          value={tema}
          onChange={(t) => mudaTema(t as 'dark' | 'light')}
          options={[{ value: 'dark', label: 'Tema escuro' }, { value: 'light', label: 'Tema claro' }]}
          aria-label="Tema do brand board"
        />
      </header>

      <Secao titulo="Logo" desc="Lockup completo, símbolo K e avatar NICO. Versão branca para fundos escuros.">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            { src: '/khub-logo.png', nome: 'khub-logo (claro)' },
            { src: '/khub-logo-white.png', nome: 'khub-logo-white (escuro)', escuro: true },
            { src: '/khub-mark.png', nome: 'khub-mark' },
            { src: '/nico-avatar.png', nome: 'nico-avatar' },
          ].map((l) => (
            <div key={l.src} className={cx('flex h-28 items-center justify-center rounded-card border border-line p-4', l.escuro ? 'bg-[#050506]' : 'bg-surface')}>
              <img src={l.src} alt={l.nome} className="max-h-full max-w-full object-contain" />
            </div>
          ))}
        </div>
      </Secao>

      <Secao titulo="Cores" desc="Neutros frios, lime de sinal, violeta de inteligência, semânticas e dados. Contraste: docs/brand/contraste.md.">
        <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
          <Amostra nome="bg-0" cor="#050506" />
          <Amostra nome="surface-1" cor="#0f0f12" />
          <Amostra nome="surface-3" cor="#1c1c22" />
          <Amostra nome="lime-500" cor="#b6ff00" texto="#0b1000" />
          <Amostra nome="lime-900" cor="#1d2605" />
          <Amostra nome="violet-600" cor="#5511cc" />
          <Amostra nome="violet-800" cor="#331177" />
          <Amostra nome="violet-950" cor="#12062e" />
          <Amostra nome="success" cor="#2ee6a6" texto="#0b1000" />
          <Amostra nome="warning" cor="#ffb547" texto="#0b1000" />
          <Amostra nome="danger" cor="#ff5d6c" texto="#0b1000" />
          <Amostra nome="info" cor="#5eb0ff" texto="#0b1000" />
        </div>
        <div className="rounded-card border border-line p-4">
          <p className="mb-3 text-xs text-muted">Gradiente assinatura (máx. 1 por tela):</p>
          <div className="h-20 rounded-card" style={{ background: 'var(--gradient-signature)' }} />
        </div>
      </Secao>

      <Secao titulo="Tipografia" desc="Space Grotesk (display), Manrope (UI), JetBrains Mono (dados), Instrument Serif (acento editorial).">
        <div className="space-y-3 rounded-card border border-line p-5">
          <p className="font-display text-2xl font-semibold tracking-tight text-fg">Display · Space Grotesk 28</p>
          <p className="text-sm text-fg">UI · Manrope 13 — corpo de trabalho da interface.</p>
          <p className="font-mono text-sm text-muted">Mono · JetBrains 13 — R$ 22.401,90 · #a37bce39 · 14:32</p>
          <p className="font-serif text-xl italic text-fg">Acento editorial · Instrument Serif</p>
        </div>
      </Secao>

      <Secao titulo="Botões" desc="Primary lime (uma por tela), AI violeta, secondary glass, soft, ghost, danger. Todos os estados.">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Primário</Button>
          <Button variant="ai" icon="sparkles">Ação da NICO</Button>
          <Button variant="secondary">Secundário</Button>
          <Button variant="soft">Soft</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Perigo</Button>
          <Button variant="primary" loading>Carregando</Button>
          <Button variant="primary" disabled>Desabilitado</Button>
          <Button variant="secondary" size="sm">Pequeno</Button>
        </div>
      </Secao>

      <Secao titulo="Formulários" desc="Controles compactos, foco lime (--signal-ring via tokens), erro só após interação.">
        <div className="grid max-w-xl gap-4">
          <input className="input" placeholder="Input padrão (.input)" />
          <Select value={sel} onChange={setSel} options={[{ value: '7d', label: 'Últimos 7 dias' }, { value: '30d', label: 'Últimos 30 dias' }]} aria-label="Período" />
          <Textarea placeholder="Textarea" maxLength={120} showCount value="" onChange={() => {}} />
          <Switch checked={liga} onChange={setLiga} label="Automação ativa" description="Switch com role=switch e aria-checked." />
        </div>
      </Secao>

      <Secao titulo="Feedback" desc="Toast com ação Desfazer, modal glass, tooltip, skeleton e empty state ilustrado.">
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => toast.success('Negócio movido para Negociação.', { action: { label: 'Desfazer', onClick: () => toast.info('Ação desfeita.') } })}>
            Toast com Desfazer
          </Button>
          <Button variant="secondary" onClick={() => toast.error('Não foi possível salvar.', { description: 'Tente de novo em instantes.' })}>Toast de erro</Button>
          <Button variant="secondary" onClick={() => setModal(true)}>Abrir modal</Button>
          <Tooltip content="Tooltip do kit"><Button variant="ghost">Tooltip</Button></Tooltip>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-card border border-line p-4"><SkeletonLines /></div>
          <EmptyState icon="inbox" title="Nenhuma conversa por aqui" description="Quando um lead chamar, a conversa aparece nesta lista." />
        </div>
        <Modal open={modal} onClose={() => setModal(false)} title="Modal do kit">
          <p className="text-sm text-muted">Glass apenas em camadas flutuantes — nunca em listas ou tabelas.</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setModal(false)}>Cancelar</Button>
            <Button variant="primary" onClick={() => setModal(false)}>Confirmar</Button>
          </div>
        </Modal>
      </Secao>

      <Secao titulo="Dados" desc="AnimatedNumber (próprio, sem dep) e ordem fixa de séries: lime, violeta, ciano, âmbar, rosa, cinza.">
        <div className="flex items-center gap-6 rounded-card border border-line p-5">
          <div>
            <p className="text-xs text-muted">Receita (30d)</p>
            <p className="font-display text-2xl font-semibold text-fg">
              <AnimatedNumber value={numero} format={(n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })} />
            </p>
          </div>
          <Button variant="soft" size="sm" onClick={() => setNumero((n) => (n === 22401 ? 38950 : 22401))}>Alternar período</Button>
          <div className="flex items-end gap-1.5" aria-hidden>
            {['var(--data-1)', 'var(--data-2)', 'var(--data-3)', 'var(--data-4)', 'var(--data-5)', 'var(--data-6)'].map((c, i) => (
              <span key={c} className="w-4 rounded-badge" style={{ background: c, height: 40 - i * 5 }} />
            ))}
          </div>
        </div>
      </Secao>

      <Secao titulo="Aurora e AI border" desc="Momentos de marca (máx. 1 por tela) e a borda cônica da IA pensando.">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="aurora flex h-32 items-center justify-center rounded-card border border-line">
            <span className="font-display text-lg font-medium text-fg">.aurora — boas-vindas, login, NICO</span>
          </div>
          <div className="ai-border flex h-32 items-center justify-center rounded-card">
            <span className="flex items-center gap-2 text-sm text-violet-300"><Icon name="sparkles" size={16} /> NICO pensando…</span>
          </div>
        </div>
      </Secao>
    </div>
  );
}
