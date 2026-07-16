'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Avatar, Badge, Button, Card, Field, Input, cx } from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { settingsApi, type AuditRow, type Business, type Member, type Invite, type Profile } from '@/lib/settings';
import { ACCENTS, BGS, applyPrefs, type Prefs } from '@/lib/personalization';

type Tab = 'perfil' | 'personalizacao' | 'empresa' | 'equipe' | 'integracoes' | 'auditoria';
const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: 'perfil', label: 'Meu perfil', icon: 'user' },
  { key: 'personalizacao', label: 'Personalização', icon: 'sparkles' },
  { key: 'empresa', label: 'Empresa', icon: 'finance' },
  { key: 'equipe', label: 'Equipe & permissões', icon: 'contacts' },
  { key: 'integracoes', label: 'Integrações', icon: 'marketing' },
  { key: 'auditoria', label: 'Auditoria', icon: 'knowledge' },
];
const IDIOMAS = ['pt-BR', 'en-US', 'es-ES'];
const ROLES = ['owner', 'admin', 'member', 'viewer'];

function Saved({ on }: { on: boolean }) {
  return on ? <span className="ml-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">✓ salvo</span> : null;
}

export default function ConfiguracoesPage() {
  const [tab, setTab] = useState<Tab>('perfil');
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('tab') as Tab | null;
    if (q && TABS.some((t) => t.key === q)) setTab(q);
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-extrabold tracking-tight text-fg">Configurações</h1>
      <p className="mt-1 text-sm text-muted">Conta, perfil, equipe e personalização — tudo salvo no seu tenant.</p>

      <div className="mt-6 flex flex-col gap-6 lg:flex-row">
        <nav className="flex gap-1 overflow-x-auto lg:w-56 lg:flex-col lg:overflow-visible">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className={cx('flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition-colors', tab === t.key ? 'bg-brand/12 font-bold text-brand' : 'text-fg hover:bg-surface2')}>
              <Icon name={t.icon} size={18} className={tab === t.key ? 'text-brand' : 'text-muted'} /> {t.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          {tab === 'perfil' && <PerfilTab />}
          {tab === 'personalizacao' && <PersonalizacaoTab />}
          {tab === 'empresa' && <EmpresaTab />}
          {tab === 'equipe' && <EquipeTab />}
          {tab === 'integracoes' && <IntegracoesTab />}
          {tab === 'auditoria' && <AuditoriaTab />}
        </div>
      </div>
    </div>
  );
}

function PerfilTab() {
  const [p, setP] = useState<Profile | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { settingsApi.profile().then(setP).catch(() => undefined); }, []);
  const save = async () => { if (!p) return; await settingsApi.updateProfile({ nome: p.nome, idioma: p.idioma }); setSaved(true); setTimeout(() => setSaved(false), 2000); };
  if (!p) return <Card className="p-6 text-sm text-muted">Carregando…</Card>;
  return (
    <Card className="p-6">
      <div className="mb-5 flex items-center gap-3">
        <Avatar name={p.nome} size={56} />
        <div><p className="text-lg font-bold text-fg">{p.nome}</p><Badge tone="brand">{p.role}</Badge></div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome"><Input value={p.nome} onChange={(e) => setP({ ...p, nome: e.target.value })} /></Field>
        <Field label="E-mail"><Input value={p.email} disabled /></Field>
        <Field label="Idioma">
          <select className="input" value={p.idioma} onChange={(e) => setP({ ...p, idioma: e.target.value })}>{IDIOMAS.map((i) => <option key={i}>{i}</option>)}</select>
        </Field>
      </div>
      <div className="mt-5 flex items-center"><Button onClick={save}>Salvar perfil</Button><Saved on={saved} /></div>
    </Card>
  );
}

function PersonalizacaoTab() {
  const [prefs, setPrefs] = useState<Prefs>({ accent: 'roxo', bg: 'aurora', theme: 'system' });
  useEffect(() => { settingsApi.profile().then((p) => setPrefs((prev) => ({ ...prev, ...(p.prefs as Prefs) }))).catch(() => undefined); }, []);
  const update = (patch: Prefs) => { const next = { ...prefs, ...patch }; setPrefs(next); applyPrefs(next); settingsApi.updateProfile({ prefs: next as Record<string, unknown> }).catch(() => undefined); };
  return (
    <div className="space-y-5">
      <Card className="p-6">
        <h2 className="font-bold text-fg">Cor de destaque</h2>
        <p className="text-xs text-muted">Muda a cor do CRM inteiro (aplica na hora).</p>
        <div className="mt-4 flex flex-wrap gap-3">
          {ACCENTS.map((a) => (
            <button key={a.key} onClick={() => update({ accent: a.key })} className={cx('flex items-center gap-2 rounded-xl border px-3 py-2 text-sm', prefs.accent === a.key ? 'border-brand ring-2 ring-brand/30' : 'border-line')}>
              <span className="h-5 w-5 rounded-full" style={{ background: a.brand }} /> {a.nome}
            </button>
          ))}
        </div>
      </Card>
      <Card className="p-6">
        <h2 className="font-bold text-fg">Fundo</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {BGS.map((b) => (
            <button key={b.key} onClick={() => update({ bg: b.key })} className={cx('rounded-xl border p-3 text-left text-sm', prefs.bg === b.key ? 'border-brand ring-2 ring-brand/30' : 'border-line')}>
              <span className="mb-2 block h-10 rounded-lg" style={{ background: b.light, border: '1px solid var(--border)' }} />
              {b.nome}
            </button>
          ))}
        </div>
      </Card>
      <Card className="p-6">
        <h2 className="font-bold text-fg">Tema</h2>
        <div className="mt-4 flex gap-2">
          {(['light', 'dark', 'system'] as const).map((t) => (
            <button key={t} onClick={() => update({ theme: t })} className={cx('rounded-xl border px-4 py-2 text-sm capitalize', prefs.theme === t ? 'border-brand bg-brand/10 font-bold text-brand' : 'border-line text-fg')}>
              {t === 'light' ? 'Claro' : t === 'dark' ? 'Escuro' : 'Sistema'}
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}

function EmpresaTab() {
  const [b, setB] = useState<Business | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { settingsApi.business().then(setB).catch(() => undefined); }, []);
  const save = async () => { if (!b) return; await settingsApi.updateBusiness({ nome: b.nome, endereco: b.endereco ?? '', telefone: b.telefone ?? '', website: b.website ?? '', idioma: b.idioma, nicho: b.nicho ?? '' }); setSaved(true); setTimeout(() => setSaved(false), 2000); };
  if (!b) return <Card className="p-6 text-sm text-muted">Carregando…</Card>;
  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-bold text-fg">Perfil da empresa</h2>
        <Badge tone="neutral">plano {b.plano}</Badge>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome da empresa"><Input value={b.nome} onChange={(e) => setB({ ...b, nome: e.target.value })} /></Field>
        <Field label="Telefone"><Input value={b.telefone ?? ''} onChange={(e) => setB({ ...b, telefone: e.target.value })} placeholder="+55…" /></Field>
        <Field label="Endereço"><Input value={b.endereco ?? ''} onChange={(e) => setB({ ...b, endereco: e.target.value })} placeholder="Rua, nº, cidade" /></Field>
        <Field label="Website"><Input value={b.website ?? ''} onChange={(e) => setB({ ...b, website: e.target.value })} placeholder="https://" /></Field>
        <Field label="Idioma"><select className="input" value={b.idioma} onChange={(e) => setB({ ...b, idioma: e.target.value })}>{IDIOMAS.map((i) => <option key={i}>{i}</option>)}</select></Field>
        <Field label="Nicho"><Input value={b.nicho ?? ''} onChange={(e) => setB({ ...b, nicho: e.target.value })} placeholder="medico, juridico…" /></Field>
      </div>
      <div className="mt-5 flex items-center"><Button onClick={save}>Salvar empresa</Button><Saved on={saved} /></div>
    </Card>
  );
}

function EquipeTab() {
  const [data, setData] = useState<{ members: Member[]; invites: Invite[] } | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [link, setLink] = useState('');
  const [msg, setMsg] = useState('');
  const load = () => settingsApi.members().then(setData).catch(() => undefined);
  useEffect(() => { load(); }, []);

  const invite = async () => {
    if (!email) return;
    const r = await settingsApi.invite(email, role);
    setLink(r.acceptUrl);
    setMsg(r.emailSent ? 'Convite enviado por e-mail.' : 'Convite criado. Copie o link (envio por e-mail requer configurar SMTP/Gmail OAuth2).');
    setEmail(''); load();
  };

  return (
    <div className="space-y-5">
      <Card className="p-6">
        <h2 className="mb-3 font-bold text-fg">Convidar usuário</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1"><Field label="E-mail"><Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="pessoa@empresa.com" /></Field></div>
          <Field label="Papel"><select className="input" value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select></Field>
          <Button onClick={invite}><Icon name="plus" size={16} /> Convidar</Button>
        </div>
        {msg && <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">{msg}</p>}
        {link && (
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-line bg-surface2 px-3 py-2 text-xs">
            <span className="min-w-0 flex-1 truncate text-muted">{link}</span>
            <button onClick={() => navigator.clipboard?.writeText(link)} className="font-semibold text-brand">Copiar</button>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-line px-5 py-3"><h2 className="font-bold text-fg">Membros</h2></div>
        <table className="w-full text-sm">
          <tbody>
            {data?.members.map((m) => (
              <tr key={m.identityId} className="border-b border-line last:border-0">
                <td className="px-5 py-3"><div className="flex items-center gap-3"><Avatar name={m.nome ?? m.email} size={34} /><div><p className="font-semibold text-fg">{m.nome ?? '—'}</p><p className="text-xs text-muted">{m.email}</p></div></div></td>
                <td className="px-5 py-3 text-right">
                  <select className="input w-32" value={m.role} onChange={async (e) => { await settingsApi.changeRole(m.identityId, e.target.value); load(); }}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
                </td>
              </tr>
            ))}
            {!data && <tr><td className="px-5 py-6 text-sm text-muted">Carregando…</td></tr>}
          </tbody>
        </table>
      </Card>

      {(data?.invites.length ?? 0) > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="border-b border-line px-5 py-3"><h2 className="font-bold text-fg">Convites pendentes</h2></div>
          {data?.invites.map((i) => (
            <div key={i.id} className="flex items-center justify-between border-b border-line px-5 py-3 last:border-0 text-sm">
              <div><p className="font-semibold text-fg">{i.email}</p><p className="text-xs text-muted">papel {i.role} · expira {new Date(i.expiresAt).toLocaleDateString('pt-BR')}</p></div>
              <button onClick={async () => { await settingsApi.revokeInvite(i.id); load(); }} className="text-xs font-semibold text-red-600 dark:text-red-400">Revogar</button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function IntegracoesTab() {
  const [rows, setRows] = useState<{ id: string; provider: string; status: string; health: string; lastSyncAt: string | null }[] | null>(null);
  useEffect(() => { settingsApi.integrations().then(setRows).catch(() => setRows([])); }, []);
  const tone = (h: string) => (h === 'ok' ? 'green' : h === 'down' || h === 'degraded' ? 'amber' : 'neutral') as 'green' | 'amber' | 'neutral';
  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center justify-between"><h2 className="font-bold text-fg">Integrações conectadas</h2><Link href="/marketing/ads" className="text-xs font-semibold text-brand hover:underline">Conectar mais →</Link></div>
      <div className="space-y-2">
        {rows?.map((r) => (
          <div key={r.id} className="flex items-center justify-between rounded-xl border border-line bg-surface2 px-4 py-3">
            <div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand/12 text-brand"><Icon name="marketing" size={17} /></span><div><p className="font-semibold capitalize text-fg">{r.provider}</p><p className="text-xs text-muted">{r.status}{r.lastSyncAt ? ` · sync ${new Date(r.lastSyncAt).toLocaleString('pt-BR')}` : ''}</p></div></div>
            <Badge tone={tone(r.health)}>● {r.health}</Badge>
          </div>
        ))}
        {rows && rows.length === 0 && <p className="rounded-xl border border-dashed border-line py-8 text-center text-sm text-muted">Nenhuma integração conectada. <Link href="/marketing/ads" className="font-semibold text-brand">Conectar Meta/Google/TikTok</Link></p>}
      </div>
    </Card>
  );
}

function AuditoriaTab() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  useEffect(() => { settingsApi.audit().then(setRows).catch(() => setRows([])); }, []);
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-line px-5 py-3"><h2 className="font-bold text-fg">Histórico de ações</h2><p className="text-xs text-muted">Log imutável de tudo que acontece no tenant.</p></div>
      <div className="max-h-[60vh] overflow-y-auto scrollbar-thin">
        <table className="w-full text-sm">
          <tbody>
            {rows?.map((a) => (
              <tr key={a.id} className="border-b border-line last:border-0">
                <td className="px-5 py-2.5"><span className="rounded-md bg-surface3 px-2 py-0.5 font-mono text-[11px] text-fg">{a.acao}</span></td>
                <td className="px-3 py-2.5 text-xs text-muted">{a.entidade}{a.entidadeId ? ` · ${a.entidadeId.slice(0, 8)}` : ''}</td>
                <td className="px-3 py-2.5 text-xs text-muted">{a.actorType}</td>
                <td className="px-5 py-2.5 text-right text-xs text-muted">{new Date(a.ts).toLocaleString('pt-BR')}</td>
              </tr>
            ))}
            {rows && rows.length === 0 && <tr><td className="px-5 py-8 text-center text-sm text-muted">Sem registros ainda.</td></tr>}
            {!rows && <tr><td className="px-5 py-8 text-center text-sm text-muted">Carregando…</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
