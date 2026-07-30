'use client';

import { useEffect, useState } from 'react';
import { Avatar, Badge, Button, Card, Field, Input, cx } from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { settingsApi, type AuditRow, type Business, type Member, type Invite, type Profile, type Tag, type ApiKey, type ApiKeyCreated } from '@/lib/settings';
import { useRef } from 'react';
import { ACCENTS, otimizarImagem } from '@/lib/personalization';
import { usePersonalization } from '@/components/app/PersonalizationProvider';
import { IntegrationsMarketplace } from '@/components/app/IntegrationsMarketplace';
import { ApiError } from '@/lib/api-error';

type Tab = 'perfil' | 'personalizacao' | 'empresa' | 'equipe' | 'integracoes' | 'tags' | 'chaves' | 'auditoria';
const TABS: { key: Tab; label: string; icon: IconName; grupo: 'Conta' | 'Avançado' }[] = [
  { key: 'perfil', label: 'Meu perfil', icon: 'user', grupo: 'Conta' },
  { key: 'personalizacao', label: 'Personalização', icon: 'sparkles', grupo: 'Conta' },
  { key: 'empresa', label: 'Empresa', icon: 'finance', grupo: 'Conta' },
  { key: 'equipe', label: 'Equipe & permissões', icon: 'contacts', grupo: 'Conta' },
  { key: 'integracoes', label: 'Integrações', icon: 'marketing', grupo: 'Avançado' },
  { key: 'tags', label: 'Tags', icon: 'sparkles', grupo: 'Avançado' },
  { key: 'chaves', label: 'Private integrations', icon: 'settings', grupo: 'Avançado' },
  { key: 'auditoria', label: 'Auditoria', icon: 'knowledge', grupo: 'Avançado' },
];
const GRUPOS = ['Conta', 'Avançado'] as const;
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

  const atual = TABS.find((t) => t.key === tab)!;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      {/* Hero em vidro: legível sobre qualquer fundo (inclusive imagem custom) */}
      <header className="glass crystal-edge flex items-center gap-4 rounded-[1.6rem] px-6 py-5">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white shadow-brand" style={{ background: 'linear-gradient(135deg, var(--brand-bright), var(--brand-deep))' }}>
          <Icon name="settings" size={22} />
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight text-fg">Configurações</h1>
          <p className="mt-0.5 text-sm text-muted">Conta, perfil, equipe, integrações e personalização — tudo salvo no seu tenant.</p>
        </div>
      </header>

      <div className="mt-6 flex flex-col gap-6 lg:flex-row">
        <nav className="glass crystal-edge flex shrink-0 gap-1 overflow-x-auto rounded-[1.4rem] p-2 lg:w-60 lg:flex-col lg:overflow-visible">
          {GRUPOS.map((g) => (
            <div key={g} className="lg:contents">
              <p className="hidden px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-muted lg:block">{g}</p>
              {TABS.filter((t) => t.grupo === g).map((t) => {
                const on = tab === t.key;
                return (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={cx('flex shrink-0 items-center gap-2.5 rounded-2xl px-3 py-2.5 text-sm transition-all', on ? 'font-bold text-white shadow-brand' : 'font-medium text-fg hover:bg-white/40 dark:hover:bg-white/10')}
                    style={on ? { background: 'linear-gradient(135deg, var(--brand-bright), var(--brand-deep))' } : undefined}
                  >
                    <Icon name={t.icon} size={18} className={on ? 'text-white' : 'text-muted'} /> {t.label}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          <div className="mb-3 flex items-center gap-2 lg:hidden">
            <Icon name={atual.icon} size={16} className="text-brand" />
            <h2 className="font-bold text-fg">{atual.label}</h2>
          </div>
          {tab === 'perfil' && <PerfilTab />}
          {tab === 'personalizacao' && <PersonalizacaoTab />}
          {tab === 'empresa' && <EmpresaTab />}
          {tab === 'equipe' && <EquipeTab />}
          {tab === 'integracoes' && <IntegrationsMarketplace />}
          {tab === 'tags' && <TagsTab />}
          {tab === 'chaves' && <ApiKeysTab />}
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
  const { prefs, logo, update } = usePersonalization();
  const logoRef = useRef<HTMLInputElement>(null);
  const fundoRef = useRef<HTMLInputElement>(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState<'' | 'logo' | 'fundo'>('');
  const bgImage = (prefs.bgImage as string) || '';

  const receber = async (alvo: 'logo' | 'fundo', file?: File) => {
    setErro('');
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp|svg\+xml|gif|avif)$/.test(file.type)) { setErro('Envie uma imagem (PNG, JPG, WEBP, SVG…).'); return; }
    setOcupado(alvo);
    try {
      // Qualquer tamanho entra: a imagem é redimensionada e recomprimida aqui.
      const dataUrl = await otimizarImagem(file, alvo === 'logo' ? 512 : 2560);
      update(alvo === 'logo' ? { logo: dataUrl } : { bgImage: dataUrl });
    } catch {
      setErro('Não consegui processar essa imagem. Tente outra.');
    } finally {
      setOcupado('');
    }
  };

  return (
    <div className="space-y-5">
      {/* Prévia ao vivo: reflete logo + fundo + cor + tema atuais */}
      <Card className="overflow-hidden p-0">
        <div
          className={cx('flex items-center gap-4 px-6 py-8', !bgImage && 'studio-preview')}
          style={bgImage ? { backgroundImage: `linear-gradient(color-mix(in srgb, var(--bg) 18%, transparent), color-mix(in srgb, var(--bg) 34%, transparent)), url("${bgImage}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
        >
          <span className="crystal-logo flex h-16 w-16 shrink-0 items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo || '/logo.png'} alt="Prévia da logo" className="h-16 w-16 object-contain" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-lg font-extrabold text-fg">Sua marca, do seu jeito</p>
            <p className="text-sm text-muted">Prévia ao vivo — muda conforme você escolhe.</p>
          </div>
          <button className="btn btn-primary ml-auto hidden text-sm sm:inline-flex">Ação</button>
        </div>
      </Card>

      {erro && <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">{erro}</p>}

      <div className="grid gap-5 sm:grid-cols-2">
        {/* Logo */}
        <Card className="p-6">
          <h2 className="font-bold text-fg">Logo da marca</h2>
          <p className="text-xs text-muted">Aparece no canto superior esquerdo. PNG ou SVG com fundo transparente fica melhor — qualquer tamanho serve, otimizamos para você.</p>
          <div className="mt-4 flex items-center gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-line bg-surface2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logo || '/logo.png'} alt="" className="h-11 w-11 object-contain" />
            </span>
            <div className="flex flex-wrap gap-2">
              <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={(e) => receber('logo', e.target.files?.[0])} />
              <Button onClick={() => logoRef.current?.click()} disabled={ocupado === 'logo'}>{ocupado === 'logo' ? 'Processando…' : 'Enviar logo'}</Button>
              {logo && <Button variant="ghost" onClick={() => update({ logo: '' })}>Padrão Orvyn</Button>}
            </div>
          </div>
        </Card>

        {/* Plano de fundo */}
        <Card className="p-6">
          <h2 className="font-bold text-fg">Plano de fundo</h2>
          <p className="text-xs text-muted">Use uma imagem sua no lugar do fundo estúdio. Sem imagem, fica o estúdio infinito adaptado à sua cor.</p>
          <div className="mt-4 flex items-center gap-4">
            <span className="h-14 w-20 shrink-0 overflow-hidden rounded-xl border border-line bg-surface2">
              {bgImage
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={bgImage} alt="" className="h-full w-full object-cover" />
                : <span className="studio-preview block h-full w-full" />}
            </span>
            <div className="flex flex-wrap gap-2">
              <input ref={fundoRef} type="file" accept="image/*" className="hidden" onChange={(e) => receber('fundo', e.target.files?.[0])} />
              <Button onClick={() => fundoRef.current?.click()} disabled={ocupado === 'fundo'}>{ocupado === 'fundo' ? 'Processando…' : 'Enviar fundo'}</Button>
              {bgImage && <Button variant="ghost" onClick={() => update({ bgImage: '' })}>Voltar ao estúdio</Button>}
            </div>
          </div>
        </Card>
      </div>

      {/* Cor de destaque */}
      <Card className="p-6">
        <h2 className="font-bold text-fg">Cor de destaque</h2>
        <p className="text-xs text-muted">Tinge o CRM inteiro e o respiro do fundo (aplica na hora).</p>
        <div className="mt-4 flex flex-wrap gap-3">
          {ACCENTS.map((a) => (
            <button key={a.key} onClick={() => update({ accent: a.key })} className={cx('flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors', (prefs.accent ?? 'roxo') === a.key ? 'border-brand ring-2 ring-brand/30' : 'border-line hover:bg-surface2')}>
              <span className="h-5 w-5 rounded-full" style={{ background: a.brand }} /> {a.nome}
            </button>
          ))}
        </div>
      </Card>

      {/* Tema */}
      <Card className="p-6">
        <h2 className="font-bold text-fg">Tema</h2>
        <p className="text-xs text-muted">O fundo se adapta ao claro e ao escuro.</p>
        <div className="mt-4 flex gap-2">
          {(['light', 'dark', 'system'] as const).map((t) => (
            <button key={t} onClick={() => update({ theme: t })} className={cx('rounded-xl border px-4 py-2 text-sm', (prefs.theme ?? 'system') === t ? 'border-brand bg-brand/10 font-bold text-brand' : 'border-line text-fg hover:bg-surface2')}>
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

const CORES_TAG = ['#7B2EFF', '#A855F7', '#C084FC', '#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#EC4899', '#14B8A6', '#64748B'];

function TagsTab() {
  const [tags, setTags] = useState<Tag[] | null>(null);
  const [nome, setNome] = useState('');
  const [cor, setCor] = useState(CORES_TAG[0]);
  const [erro, setErro] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => settingsApi.tags().then(setTags).catch(() => setTags([]));
  useEffect(() => { load(); }, []);

  const criar = async () => {
    if (!nome.trim()) return;
    setErro(''); setBusy(true);
    try {
      await settingsApi.createTag({ name: nome.trim(), color: cor });
      setNome(''); setCor(CORES_TAG[0]); load();
    } catch (e) {
      setErro(e instanceof ApiError ? (e.body?.detail as string) ?? 'Não consegui criar a tag.' : 'Não consegui criar a tag.');
    } finally { setBusy(false); }
  };
  const remover = async (id: string) => { await settingsApi.deleteTag(id).catch(() => undefined); load(); };

  return (
    <div className="space-y-5">
      <Card className="p-6">
        <h2 className="font-bold text-fg">Nova tag</h2>
        <p className="text-xs text-muted">Tags organizam contatos e disparam automações (gatilho “tag adicionada”).</p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1"><Field label="Nome"><Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="cliente-vip" onKeyDown={(e) => { if (e.key === 'Enter') criar(); }} /></Field></div>
          <div>
            <p className="mb-1 text-xs font-semibold text-muted">Cor</p>
            <div className="flex flex-wrap gap-1.5">
              {CORES_TAG.map((c) => (
                <button key={c} onClick={() => setCor(c)} className={cx('h-7 w-7 rounded-full transition-transform', cor === c ? 'ring-2 ring-offset-2 ring-offset-surface' : 'hover:scale-110')} style={{ background: c, boxShadow: cor === c ? `0 0 0 2px ${c}` : undefined }} aria-label={c} />
              ))}
            </div>
          </div>
          <Button onClick={criar} disabled={busy}><Icon name="plus" size={16} /> Criar tag</Button>
        </div>
        {erro && <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">{erro}</p>}
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-line px-5 py-3"><h2 className="font-bold text-fg">Tags do CRM</h2></div>
        <div className="divide-y divide-line">
          {tags?.map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-5 py-3">
              <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-white" style={{ background: t.color }}>
                {t.name}
              </span>
              {t.descricao && <span className="truncate text-xs text-muted">{t.descricao}</span>}
              <span className="ml-auto text-xs text-muted">{t.usos} uso(s)</span>
              <button onClick={() => remover(t.id)} className="rounded-lg p-1.5 text-muted hover:bg-surface2 hover:text-red-500" aria-label="Excluir"><Icon name="close" size={14} /></button>
            </div>
          ))}
          {tags && tags.length === 0 && <p className="px-5 py-8 text-center text-sm text-muted">Nenhuma tag ainda. Crie a primeira acima.</p>}
          {!tags && <p className="px-5 py-8 text-center text-sm text-muted">Carregando…</p>}
        </div>
      </Card>
    </div>
  );
}

function ApiKeysTab() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [nome, setNome] = useState('');
  const [criada, setCriada] = useState<ApiKeyCreated | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = () => settingsApi.apiKeys().then(setKeys).catch(() => setKeys([]));
  useEffect(() => { load(); }, []);

  const criar = async () => {
    if (!nome.trim()) return;
    setBusy(true);
    try { const k = await settingsApi.createApiKey(nome.trim()); setCriada(k); setNome(''); load(); }
    catch { /* noop */ } finally { setBusy(false); }
  };
  const revogar = async (id: string) => { await settingsApi.revokeApiKey(id).catch(() => undefined); load(); };
  const copiar = async () => { if (!criada) return; await navigator.clipboard.writeText(criada.key).catch(() => undefined); setCopiado(true); setTimeout(() => setCopiado(false), 2000); };

  const baseUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/v1` : '/api/v1';

  return (
    <div className="space-y-5">
      <Card className="p-6">
        <h2 className="font-bold text-fg">Private integrations</h2>
        <p className="mt-1 text-sm text-muted">
          Crie uma chave de API para um sistema externo chamar o Orvyn no lugar do seu tenant. A chave carrega as permissões do seu tenant — trate como senha.
        </p>
        <div className="mt-4 rounded-xl border border-line bg-surface2 p-3 text-xs">
          <p className="font-semibold text-fg">Como usar</p>
          <p className="mt-1 text-muted">Envie a chave no header <code className="rounded bg-surface3 px-1 py-0.5 font-mono">X-API-Key</code> (ou <code className="rounded bg-surface3 px-1 py-0.5 font-mono">Authorization: Bearer</code>) em cada request.</p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-fg/90 p-3 font-mono text-[11px] leading-relaxed text-white scrollbar-thin">{`curl ${baseUrl}/contatos \\
  -H "X-API-Key: orv_live_..."`}</pre>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1"><Field label="Nome da integração"><Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Zapier, n8n, meu backend…" onKeyDown={(e) => { if (e.key === 'Enter') criar(); }} /></Field></div>
          <Button onClick={criar} disabled={busy}><Icon name="plus" size={16} /> Gerar chave</Button>
        </div>
      </Card>

      {criada && (
        <Card className="border-2 border-brand p-6">
          <div className="flex items-center gap-2"><Icon name="check" size={18} className="text-emerald-500" /><h2 className="font-bold text-fg">Chave “{criada.name}” criada</h2></div>
          <p className="mt-1 text-xs font-semibold text-amber-600 dark:text-amber-400">Copie agora — ela não será mostrada de novo.</p>
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-line bg-surface2 px-3 py-2">
            <code className="min-w-0 flex-1 truncate font-mono text-sm text-fg">{criada.key}</code>
            <Button variant="ghost" onClick={copiar} className="shrink-0 text-xs">{copiado ? '✓ copiado' : 'Copiar'}</Button>
          </div>
          <button onClick={() => setCriada(null)} className="mt-3 text-xs font-semibold text-muted hover:text-fg">Já copiei, fechar</button>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <div className="border-b border-line px-5 py-3"><h2 className="font-bold text-fg">Chaves</h2></div>
        <div className="divide-y divide-line">
          {keys?.map((k) => (
            <div key={k.id} className={cx('flex items-center gap-3 px-5 py-3', k.revokedAt && 'opacity-50')}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/12 text-brand"><Icon name="settings" size={17} /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-fg">{k.name}</p>
                <p className="truncate font-mono text-[11px] text-muted">{k.keyPrefix} · {k.lastUsedAt ? `usada ${new Date(k.lastUsedAt).toLocaleDateString('pt-BR')}` : 'nunca usada'}</p>
              </div>
              {k.revokedAt
                ? <Badge tone="neutral">revogada</Badge>
                : <button onClick={() => revogar(k.id)} className="text-xs font-semibold text-red-600 hover:underline dark:text-red-400">Revogar</button>}
            </div>
          ))}
          {keys && keys.length === 0 && <p className="px-5 py-8 text-center text-sm text-muted">Nenhuma chave ainda.</p>}
          {!keys && <p className="px-5 py-8 text-center text-sm text-muted">Carregando…</p>}
        </div>
      </Card>
    </div>
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
