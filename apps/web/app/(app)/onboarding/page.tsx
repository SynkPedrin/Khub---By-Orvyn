'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, Button, Card, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { blueprints, type Blueprint, type Sugestao } from '@/lib/blueprints';

const NYRO_Q = 'Quero configurar meu KHUB do zero. Me pergunte sobre meu nicho e monte meu funil, etapas e automações.';

export default function OnboardingPage() {
  const router = useRouter();
  const [lista, setLista] = useState<Blueprint[] | null>(null);
  const [sug, setSug] = useState<Sugestao | null>(null);
  const [aplicando, setAplicando] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    blueprints.listar().then(setLista).catch(() => setLista([]));
    blueprints.sugerido().then(setSug).catch(() => setSug(null));
  }, []);

  const aplicar = async (key: string) => {
    setAplicando(key); setMsg(null);
    try {
      const r = await blueprints.aplicar(key);
      if (r.jaAplicado) { setMsg('Esse blueprint já foi aplicado neste tenant.'); setAplicando(null); return; }
      router.push('/pipeline');
    } catch { setMsg('Não consegui aplicar o blueprint. Tente novamente.'); setAplicando(null); }
  };

  const destaque = sug?.sugerido?.id;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
      <header className="text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl text-white shadow-brand" style={{ background: 'linear-gradient(135deg, var(--brand-bright), var(--brand-deep))' }}>
          <Icon name="sparkles" size={26} />
        </span>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-fg">Vamos montar seu KHUB</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted">
          Escolha o modelo do seu nicho, a gente cria o <strong>funil com as etapas certas</strong> e instala as
          <strong> automações prontas</strong>. Dá pra ajustar tudo depois.
        </p>
        <Link href={`/nyro?q=${encodeURIComponent(NYRO_Q)}`} className="btn btn-primary mt-4">
          <Icon name="sparkles" size={16} /> Deixe a NICO montar por mim
        </Link>
      </header>

      {sug?.jaAplicado && (
        <p className="rounded-xl bg-emerald-500/10 px-4 py-2.5 text-center text-sm text-emerald-700 dark:text-emerald-400">
          Você já aplicou um blueprint. Pode aplicar outro ou ajustar no <Link href="/pipeline" className="font-semibold underline">pipeline</Link>.
        </p>
      )}
      {msg && <p className="rounded-xl bg-amber-500/10 px-4 py-2.5 text-center text-sm text-amber-700 dark:text-amber-400">{msg}</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {lista?.map((b) => (
          <Card key={b.id} className={cx('flex h-full flex-col p-5', destaque === b.id && 'ring-2 ring-brand')}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-bold text-fg">{b.nome}</p>
                <p className="text-[11px] uppercase tracking-wide text-muted">{b.familia}</p>
              </div>
              {destaque === b.id ? <Badge tone="brand">sugerido</Badge> : <Badge tone="neutral">tier {b.tier}</Badge>}
            </div>
            <div className="mt-3 flex-1 space-y-2 text-xs text-muted">
              <div>
                <p className="font-semibold text-fg">Funil ({b.etapas.length} etapas)</p>
                <p className="line-clamp-2">{b.etapas.map((e) => e.nome).join(' → ')}</p>
              </div>
              <div>
                <p className="font-semibold text-fg">{b.automacoes.length} automações</p>
              </div>
              {b.orgaoRegulador && <p className="text-[11px]">Compliance: <span className="font-semibold">{b.orgaoRegulador}</span></p>}
            </div>
            <Button onClick={() => aplicar(b.id)} disabled={aplicando === b.id} className="mt-4 w-full text-sm">
              {aplicando === b.id ? 'Montando…' : <><Icon name="plus" size={15} /> Aplicar este modelo</>}
            </Button>
          </Card>
        ))}
        {lista && lista.length === 0 && <p className="col-span-full text-center text-sm text-muted">Nenhum blueprint disponível.</p>}
        {!lista && <p className="col-span-full text-center text-sm text-muted">Carregando modelos…</p>}
      </div>

      <p className="text-center text-xs text-muted">Aplicar um modelo cria dados reais no seu CRM (funil + automações), nada é simulado.</p>
    </div>
  );
}
