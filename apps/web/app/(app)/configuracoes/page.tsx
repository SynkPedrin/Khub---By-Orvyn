'use client';

import { useEffect, useState } from 'react';
import { Avatar, Badge, Button, Card, Field, Input, cx } from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { settingsApi, type AuditRow, type Business, type Profile, type Tag, type ApiKey, type ApiKeyCreated } from '@/lib/settings';
import { useRef } from 'react';
import { ACCENTS, otimizarImagem } from '@/lib/personalization';
import { usePersonalization } from '@/components/app/PersonalizationProvider';
import { IntegrationsMarketplace } from '@/components/app/IntegrationsMarketplace';
import { ApiError } from '@/lib/api-error';
import { useLocale } from '@/lib/locale';
import { useAuth } from '@/lib/auth';
import { AccountPreferencesForm } from '@/components/app/AccountPreferencesForm';
import { TagsTab } from '@/components/settings/TagsTab';
import { CamposPersonalizadosTab } from '@/components/settings/CamposPersonalizadosTab';
import { AvaliacoesTab } from '@/components/settings/AvaliacoesTab';
import { MotivosPerdaTab } from '@/components/settings/MotivosPerdaTab';
import { SkeletonLines, SkeletonRows } from '@/components/kit';
import { EncerrarSessoes } from '@/components/app/EquipeAcoes';
import { EquipeConvites } from '@/components/app/EquipeConvites';

type Tab = 'perfil' | 'personalizacao' | 'empresa' | 'equipe' | 'integracoes' | 'tags' | 'campos' | 'avaliacoes' | 'motivos' | 'chaves' | 'auditoria';
const TABS: { key: Tab; label: string; icon: IconName; grupo: 'Conta' | 'Avançado' }[] = [
  { key: 'perfil', label: 'Meu perfil', icon: 'user', grupo: 'Conta' },
  { key: 'personalizacao', label: 'Personalização', icon: 'sparkles', grupo: 'Conta' },
  { key: 'empresa', label: 'Empresa', icon: 'finance', grupo: 'Conta' },
  { key: 'equipe', label: 'Equipe & permissões', icon: 'contacts', grupo: 'Conta' },
  { key: 'integracoes', label: 'Integrações', icon: 'marketing', grupo: 'Avançado' },
  { key: 'tags', label: 'Tags', icon: 'sparkles', grupo: 'Avançado' },
  { key: 'campos', label: 'Campos personalizados', icon: 'list', grupo: 'Avançado' },
  { key: 'avaliacoes', label: 'Avaliações', icon: 'star', grupo: 'Avançado' },
  { key: 'motivos', label: 'Motivos de perda', icon: 'target', grupo: 'Avançado' },
  { key: 'chaves', label: 'Chaves de API', icon: 'settings', grupo: 'Avançado' },
  { key: 'auditoria', label: 'Auditoria', icon: 'knowledge', grupo: 'Avançado' },
];
const GRUPOS = ['Conta', 'Avançado'] as const;
const IDIOMAS = ['pt-BR', 'en-US', 'es-ES'];

function Saved({ on }: { on: boolean }) {
  return on ? <span className="ml-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">✓ salvo</span> : null;
}

export default function ConfiguracoesPage() {
  const { t: tr } = useLocale();
  const { user } = useAuth();
  const admin = ['owner','admin'].includes(user?.role ?? '');
  const [tab, setTab] = useState<Tab>('perfil');
  useEffect(() => {
    // Aceita `?tab=` e o legado `?aba=` (links antigos do app usam `aba`), com apelidos.
    const sp = new URLSearchParams(window.location.search);
    const bruto = sp.get('tab') ?? sp.get('aba');
    const APELIDOS: Record<string, string> = { ia: 'integracoes', 'campos-personalizados': 'campos', 'motivos-perda': 'motivos' };
    const q = (bruto ? APELIDOS[bruto] ?? bruto : null) as Tab | null;
    if (q && TABS.some((t) => t.key === q)) setTab(q);
  }, []);

  const atual = TABS.find((t) => t.key === tab)!;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-8 lg:py-8">
      {/* Cabeçalho no padrão do produto (ADR-0036): claro, título + contexto. */}
      <header className="flex items-center gap-4">
        <span className="icon-tile h-12 w-12 rounded-2xl">
          <Icon name="settings" size={22} />
        </span>
        <div className="min-w-0">
          <h1 className="t-display">{tr('Configurações')}</h1>
          <p className="mt-1.5 text-[15px] text-muted">{user?.empresa ?? 'Sua operação'} · Preferências, acessos e integrações.</p>
        </div>
      </header>

      <div className="mt-6 flex flex-col gap-6 lg:flex-row">
        <nav className="glass crystal-edge flex shrink-0 gap-1 overflow-x-auto rounded-[1.4rem] p-2 lg:w-60 lg:flex-col lg:overflow-visible">
          {GRUPOS.map((g) => (
            <div key={g} className="lg:contents">
              <p className="hidden px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted lg:block">{g}</p>
              {TABS.filter((item) => item.grupo === g && (admin || ['perfil','personalizacao'].includes(item.key))).map((t) => {
                const on = tab === t.key;
                return (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    // Mesmo estado ativo da sidebar (ADR-0036): roxo muito suave, não degradê forte.
                    aria-current={on ? 'page' : undefined}
                    className={cx('nav-item shrink-0 text-sm', on ? 'font-semibold' : 'font-medium text-fg')}
                  >
                    <Icon name={t.icon} size={18} className={on ? 'text-brand' : 'text-muted'} /> {tr(t.label)}
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
          {tab === 'perfil' && <div className="space-y-5"><PerfilTab /><EncerrarSessoes /></div>}
          {tab === 'personalizacao' && <PersonalizacaoTab />}
          {tab === 'empresa' && <EmpresaTab />}
          {tab === 'equipe' && <EquipeConvites />}
          {tab === 'integracoes' && <IntegrationsMarketplace />}
          {tab === 'tags' && <TagsTab />}
          {tab === 'campos' && <CamposPersonalizadosTab />}
          {tab === 'avaliacoes' && <AvaliacoesTab />}
          {tab === 'motivos' && <MotivosPerdaTab />}
          {tab === 'chaves' && <ApiKeysTab />}
          {tab === 'auditoria' && <AuditoriaTab />}
        </div>
      </div>
    </div>
  );
}

function PerfilTab() {
  const {t,reload}=useLocale();
  const {refreshMe}=useAuth();
  const [erro,setErro]=useState('');
  const [busy,setBusy]=useState(false);
  const [p, setP] = useState<Profile | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { settingsApi.profile().then(setP).catch(() => undefined); }, []);
  const save = async () => { if (!p) return; setBusy(true);setErro('');try{await settingsApi.updateProfile({ nome: p.nome, idioma: p.idioma }); reload();await refreshMe();setSaved(true);}catch(e){setErro(e instanceof Error?e.message:'Não foi possível salvar.');}finally{setBusy(false);} };
  if (!p) return <Card className="p-6"><SkeletonLines lines={4} label="Carregando perfil" /></Card>;
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
      <div className="mt-5 flex items-center"><Button onClick={save} disabled={busy}>{t(busy?'Salvando…':'Salvar perfil')}</Button>{erro&&<p role="alert" className="ml-3 text-sm text-red-600">{erro}</p>}<Saved on={saved} /></div>
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
            <p className="truncate text-lg font-semibold text-fg">Sua marca, do seu jeito</p>
            <p className="text-sm text-muted">Prévia ao vivo, muda conforme você escolhe.</p>
          </div>
          <span aria-hidden className="btn btn-primary pointer-events-none ml-auto hidden text-sm sm:inline-flex">Botão de exemplo</span>
        </div>
      </Card>

      {erro && <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">{erro}</p>}

      <div className="grid gap-5 sm:grid-cols-2">
        {/* Logo */}
        <Card className="p-6">
          <h2 className="font-bold text-fg">Logo da marca</h2>
          <p className="text-xs text-muted">Aparece no canto superior esquerdo. PNG ou SVG com fundo transparente fica melhor, qualquer tamanho serve, otimizamos para você.</p>
          <div className="mt-4 flex items-center gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-line bg-surface2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logo || '/logo.png'} alt="" className="h-11 w-11 object-contain" />
            </span>
            <div className="flex flex-wrap gap-2">
              <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={(e) => receber('logo', e.target.files?.[0])} />
              <Button onClick={() => logoRef.current?.click()} disabled={ocupado === 'logo'}>{ocupado === 'logo' ? 'Processando…' : 'Enviar logo'}</Button>
              {logo && <Button variant="ghost" onClick={() => update({ logo: '' })}>Padrão KHUB</Button>}
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
        <p className="text-xs text-muted">Escuro é o padrão. No claro, o sistema fica branco e a iluminação vira roxa.</p>
        <div className="mt-4 flex gap-2">
          {(['dark', 'light', 'system'] as const).map((t) => (
            <button key={t} onClick={() => update({ theme: t })} aria-pressed={(prefs.theme ?? 'dark') === t} className={cx('rounded-xl border px-4 py-2 text-sm', (prefs.theme ?? 'dark') === t ? 'border-brand bg-brand/10 font-bold text-brand' : 'border-line text-fg hover:bg-surface2')}>
              {t === 'light' ? 'Claro' : t === 'dark' ? 'Escuro' : 'Sistema'}
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}

function EmpresaTab() {
 const [b,setB]=useState<Business|null>(null);const [error,setError]=useState('');const {refreshMe}=useAuth();
 useEffect(()=>{settingsApi.business().then(setB).catch(e=>setError(e.message));},[]);
 if(error)return <p role="alert" className="text-danger">{error}</p>;
 if(!b)return <Card className="p-6"><SkeletonLines lines={5} label="Carregando dados da empresa" /></Card>;
 return <AccountPreferencesForm name={b.nome} preferences={{...b.settings,phone:b.telefone??'',website:b.website??'',address:b.endereco??'',locale:b.idioma}} onSave={async(nome,p)=>{await settingsApi.updateBusiness({nome,telefone:p.phone??'',website:p.website??'',endereco:p.address??'',idioma:p.locale??'pt-BR',settings:p});await refreshMe();}}/>;
}


function ApiKeysTab() {
  const [erro,setErro]=useState('');
  const [scopes,setScopes]=useState<string[]>(['contacts.read']);
  const allowedScopes = [['contacts.read','Ler contatos'],['contacts.write','Criar e editar contatos'],['pipeline.read','Ler pipeline'],['pipeline.write','Gerenciar oportunidades'],['conversations.read','Ler conversas'],['conversations.reply','Responder conversas'],['automations.read','Ler automações'],['automations.write','Gerenciar automações'],['integrations.manage','Gerenciar integrações']];
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [nome, setNome] = useState('');
  const [criada, setCriada] = useState<ApiKeyCreated | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = () => settingsApi.apiKeys().then(setKeys).catch(e=>setErro(e.message));
  useEffect(() => { load(); }, []);

  const criar = async () => {
    if (!nome.trim()) return;
    setBusy(true);
    try { const k = await settingsApi.createApiKey(nome.trim(),scopes); setCriada(k); setNome(''); load(); }
    catch(e) { setErro(e instanceof Error?e.message:'Não foi possível gerar a chave.'); } finally { setBusy(false); }
  };
  const revogar = async (id: string) => { try{await settingsApi.revokeApiKey(id);if(criada?.id===id)setCriada(null);load();}catch(e){setErro(e instanceof Error?e.message:'Não foi possível revogar.');} };
  const copiar = async () => { if (!criada) return; try{await navigator.clipboard.writeText(criada.key);setCopiado(true);}catch{setErro('Selecione e copie a chave manualmente.');} setTimeout(() => setCopiado(false), 2000); };

  const baseUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/v1` : '/api/v1';

  return (
    <div className="space-y-5">
      <Card className="p-6">
        <h2 className="font-bold text-fg">Chaves de API</h2>
        <p className="mt-1 text-sm text-muted">
          Crie uma chave de API para um sistema externo chamar o KHUB no lugar do seu tenant. Cada chave acessa apenas esta empresa e as permissões selecionadas abaixo.
        </p>
        <div className="mt-4 rounded-xl border border-line bg-surface2 p-3 text-xs">
          <p className="font-semibold text-fg">Como usar</p>
          <p className="mt-1 text-muted">Envie a chave no header <code className="rounded bg-surface3 px-1 py-0.5 font-mono">X-API-Key</code> (ou <code className="rounded bg-surface3 px-1 py-0.5 font-mono">Authorization: Bearer</code>) em cada request.</p>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-fg/90 p-3 font-mono text-[11px] leading-relaxed text-white scrollbar-thin">{`curl ${baseUrl}/crm/contacts \\
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
          <p className="mt-1 text-xs font-semibold text-amber-600 dark:text-amber-400">Copie agora, ela não será mostrada de novo.</p>
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-line bg-surface2 px-3 py-2">
            <code className="min-w-0 flex-1 select-all break-all font-mono text-sm text-fg">{criada.key}</code>
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
          {!keys && <SkeletonRows rows={2} label="Carregando chaves" />}
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
            {!rows && <tr><td className="p-0"><SkeletonRows rows={4} label="Carregando auditoria" /></td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
