'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { BrandLogo, type BrandKey } from '@/components/brand/BrandLogo';
import { ConfigRequired } from '@/components/app/ConfigRequired';
import { WhatsAppConnectModal } from '@/components/app/WhatsAppConnectModal';
import { ApiError } from '@/lib/api-error';
import { ads } from '@/lib/ads';
import { settingsApi } from '@/lib/settings';
import { whatsappApi, type ConexaoWhatsApp } from '@/lib/whatsapp';
import { redesApi, type EstadoRede, type RedeSocial } from '@/lib/redes';
import { googleApi } from '@/lib/google';

type Categoria = 'anuncios' | 'mensageria' | 'redes' | 'pagamentos' | 'produtividade' | 'ia';

interface App {
  key: string;
  nome: string;
  brand: BrandKey;
  categoria: Categoria;
  desc: string;
  /** provider usado no fluxo real de conexão (integrations/:provider/auth-url). */
  provider: string;
  /** Só usado com provider==='meta' — ver lib/ads.ts. */
  capability?: 'ads' | 'leads';
  /**
   * oauth: conector real no servidor — "Conectar" abre o fluxo (degrada com
   *   config_required se a credencial não estiver posta).
   * nativa: ligada por credencial no servidor, sem OAuth do usuário.
   * qr: fluxo de QR code (WhatsApp/Evolution) — não é redirect OAuth.
   * planejado: conector ainda em desenvolvimento — sem botão que engane.
   */
  estado: 'oauth' | 'nativa' | 'qr' | 'planejado';
}

const CATS: { key: Categoria; label: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
  { key: 'anuncios', label: 'Anúncios', icon: 'marketing' },
  { key: 'mensageria', label: 'Mensageria', icon: 'inbox' },
  { key: 'pagamentos', label: 'Pagamentos', icon: 'finance' },
  { key: 'produtividade', label: 'Produtividade', icon: 'calendar' },
  { key: 'ia', label: 'Inteligência', icon: 'sparkles' },
  { key: 'redes', label: 'Redes sociais', icon: 'instagram' },
];

// Catálogo real: o que o KHUB integra. Conexão passa pelo fluxo do servidor
// (OAuth Meta hoje; demais degradam com config_required nomeando a variável).
const APPS: App[] = [
  // capability:'ads' — não pede leads_retrieval junto, então Ads conecta
  // mesmo se a conta ainda não tiver Lead Ads/Advanced Access aprovado.
  { key: 'meta_ads', nome: 'Meta Ads', brand: 'meta_ads', categoria: 'anuncios', provider: 'meta', capability: 'ads', estado: 'oauth', desc: 'Campanhas do Facebook e Instagram, gasto, CPL, ROAS e melhor criativo.' },
  { key: 'google_ads', nome: 'Google Ads', brand: 'google_ads', categoria: 'anuncios', provider: 'google', estado: 'oauth', desc: 'Search e Performance Max no mesmo painel das outras contas.' },
  { key: 'tiktok_ads', nome: 'TikTok Ads', brand: 'tiktok', categoria: 'anuncios', provider: 'tiktok', estado: 'oauth', desc: 'Traga as campanhas do TikTok para a análise cross-plataforma.' },
  // TODO(meta-capabilities): usa o pacote 'ads' por ora — instagram_basic/
  // instagram_manage_messages ainda não têm capability própria. Conecta,
  // mas sem os scopes de mensageria do Instagram até isso existir.
  { key: 'instagram', nome: 'Instagram', brand: 'instagram', categoria: 'mensageria', provider: 'meta', estado: 'oauth', desc: 'Direct e comentários viram conversa no Inbox unificado.' },
  // Evolution API própria — CANAL_MVP (CLAUDE.md). Conexão por QR code, não
  // por OAuth: NÃO reaproveitar o fluxo `conectar()` genérico de redirect.
  { key: 'whatsapp', nome: 'WhatsApp Business', brand: 'whatsapp', categoria: 'mensageria', provider: 'evolution', estado: 'qr', desc: 'Atendimento e disparos via Evolution API, conexão por QR code.' },
  // Redes sociais (db/068): OAuth próprio em /v1/integrations/redes; painel em /redes. Mesma conta de Conversas.
  { key: 'redes_instagram', nome: 'Instagram (posts e métricas)', brand: 'instagram', categoria: 'redes', provider: 'redes_instagram', estado: 'oauth', desc: 'Posts, insights, crescimento e publicação da conta profissional.' },
  { key: 'redes_tiktok', nome: 'TikTok', brand: 'tiktok', categoria: 'redes', provider: 'redes_tiktok', estado: 'oauth', desc: 'Vídeos, métricas, seguidores e publicação pelo Login Kit do TikTok.' },
  { key: 'redes_youtube', nome: 'YouTube', brand: 'youtube', categoria: 'redes', provider: 'redes_youtube', estado: 'oauth', desc: 'Vídeos, estatísticas, YouTube Analytics e envio de vídeos.' },
  { key: 'messenger', nome: 'Messenger', brand: 'messenger', categoria: 'mensageria', provider: 'meta', estado: 'oauth', desc: 'Mensagens do Facebook no mesmo Inbox.' },
  { key: 'anthropic', nome: 'Claude (NICO)', brand: 'claude', categoria: 'ia', provider: 'anthropic', estado: 'nativa', desc: 'O motor da NICO. Ligado por credencial no servidor, sem OAuth.' },
  { key: 'webhook', nome: 'Webhook / API', brand: 'webhook', categoria: 'produtividade', provider: 'webhook', estado: 'nativa', desc: 'Dispare fluxos de qualquer sistema com uma URL de entrada.' },
  { key: 'stripe', nome: 'Stripe', brand: 'stripe', categoria: 'pagamentos', provider: 'stripe', estado: 'planejado', desc: 'Cobranças, assinaturas e receita ligadas ao contato do CRM.' },
  // Presença Google (Tag Manager, Search Console, Meu Negócio): OAuth próprio em /v1/google, tela em /marketing/google.
  { key: 'google_presenca', nome: 'Google (Tag Manager, Search Console e Meu Negócio)', brand: 'google', categoria: 'anuncios', provider: 'google_presenca', estado: 'oauth', desc: 'Diagnóstico do Tag Manager, SEO no Search Console e avaliações do Perfil da Empresa.' },
  { key: 'google_calendar', nome: 'Google Calendar', brand: 'google_calendar', categoria: 'produtividade', provider: 'google_calendar', estado: 'planejado', desc: 'Agendamentos da Agenda sincronizados nos dois sentidos.' },
  { key: 'gmail', nome: 'Gmail', brand: 'gmail', categoria: 'produtividade', provider: 'gmail', estado: 'planejado', desc: 'Envie e receba e-mail do contato sem sair do KHUB.' },
];

export function IntegrationsMarketplace() {
  const [rows, setRows] = useState<{ provider: string; status: string; health: string; lastSyncAt: string | null }[] | null>(null);
  const [cat, setCat] = useState<Categoria | 'todas'>('todas');
  const [gated, setGated] = useState<{ provider: string; missing: string[] } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [whatsappAberto, setWhatsappAberto] = useState(false);
  const [erroCarregar, setErroCarregar] = useState(false);
  const [waStatus, setWaStatus] = useState<ConexaoWhatsApp | null>(null);
  const [redes, setRedes] = useState<EstadoRede[]>([]);

  const recarregar = () => {
    setErroCarregar(false);
    settingsApi.integrations().then(setRows).catch(() => { setRows([]); setErroCarregar(true); });
    // `/integrations` só cacheia o status do WhatsApp — ele é sincronizado
    // apenas quando algo chama GET /integrations/whatsapp/status (ver
    // whatsapp-connection.service.ts: "fonte da verdade é sempre a
    // Evolution"). Sem perguntar aqui também, um número já conectado fora
    // desta tela aparece como desconectado até alguém abrir o modal.
    whatsappApi.status().then(setWaStatus).catch(() => setWaStatus(null));
    redesApi.estado().then(setRedes).catch(() => setRedes([]));
  };
  useEffect(() => { recarregar(); }, []);

  const conectado = (provider: string) => {
    if (provider.startsWith('redes_')) {
      const r = redes.find((x) => `redes_${x.rede}` === provider);
      return r?.conectado ? { provider, status: 'connected', health: r.contas.some((c) => c.erro) ? 'degraded' : 'ok', lastSyncAt: null } : null;
    }
    return rows?.find((r) => r.provider === provider) ?? null;
  };

  const conectar = async (app: App) => {
    setGated(null); setMsg(null); setBusy(app.key);
    try {
      const { url } = app.provider === 'google_presenca' ? await googleApi.urlConexao('leitura')
        : app.provider.startsWith('redes_') ? await redesApi.urlConexao(app.provider.slice(6) as RedeSocial)
        : await ads.authUrl(app.provider, app.capability);
      window.location.href = url;
    } catch (e) {
      const cr = e instanceof ApiError ? e.configRequired : null;
      if (cr) setGated(cr);
      else setMsg(`Não consegui iniciar a conexão com ${app.nome}. Tente novamente.`);
    } finally {
      setBusy(null);
    }
  };

  const lista = useMemo(() => (cat === 'todas' ? APPS : APPS.filter((a) => a.categoria === cat)), [cat]);
  const conectados = rows?.filter((r) => r.status === 'connected').length ?? 0;

  return (
    <div className="space-y-5">
      {/* Resumo + filtro por categoria */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setCat('todas')} className={cx('rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors', cat === 'todas' ? 'bg-brand text-white shadow-brand' : 'border border-line text-fg hover:bg-surface2')}>
          Todas
        </button>
        {CATS.map((c) => (
          <button key={c.key} onClick={() => setCat(c.key)} className={cx('flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors', cat === c.key ? 'bg-brand text-white shadow-brand' : 'border border-line text-fg hover:bg-surface2')}>
            <Icon name={c.icon} size={13} /> {c.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted">{conectados} conectado(s)</span>
      </div>

      {gated && <ConfigRequired provider={gated.provider} missing={gated.missing} />}
      {msg && <p className="rounded-xl bg-amber-500/10 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-400">{msg}</p>}
      {erroCarregar && (
        <p className="flex items-center gap-2 rounded-xl bg-danger/5 px-4 py-2.5 text-sm text-danger">
          <Icon name="alert" size={15} /> Não consegui confirmar quais integrações estão conectadas para esta conta.
          <button onClick={recarregar} className="ml-auto font-semibold underline">Tentar de novo</button>
        </p>
      )}

      {/* Grade de apps */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {lista.map((app) => {
          const conn = conectado(app.provider);
          // WhatsApp tem DOIS provedores possíveis por tenant — Evolution
          // (QR, self-hosted) e Stevo API de gestão (vínculo de instância já
          // pareada, ver stevo-api-vinculo.service.ts). Qual dos dois está
          // ativo varia por cliente, então o card considera conectado se
          // QUALQUER um dos dois estiver — nunca só o da Evolution.
          const stevoConn = app.estado === 'qr' ? conectado('stevo_api') : null;
          const on = app.estado === 'qr'
            ? stevoConn?.status === 'connected' || waStatus?.estado === 'conectado'
            : conn?.status === 'connected';
          return (
            <div key={app.key} className="card flex flex-col p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-line bg-white shadow-sm dark:bg-white/90">
                  <BrandLogo brand={app.brand} size={28} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-bold text-fg">{app.nome}</p>
                    {on && app.estado === 'qr' && <Badge tone="green">● ok</Badge>}
                    {on && app.estado !== 'qr' && conn && <Badge tone={conn.health === 'ok' ? 'green' : 'amber'}>● {conn.health}</Badge>}
                    {!on && app.estado === 'nativa' && <Badge tone="brand">nativa</Badge>}
                    {!on && app.estado === 'planejado' && <Badge tone="neutral">em breve</Badge>}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted">{app.desc}</p>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2">
                {on && app.estado === 'qr' ? (
                  <>
                    <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400"><Icon name="check" size={14} /> Conectado</span>
                    {waStatus?.estado === 'conectado' && waStatus.numero ? (
                      <span className="text-[11px] text-muted">· {waStatus.numero}</span>
                    ) : stevoConn?.lastSyncAt ? (
                      <span className="text-[11px] text-muted">· sync {new Date(stevoConn.lastSyncAt).toLocaleDateString('pt-BR')}</span>
                    ) : null}
                    <button onClick={() => setWhatsappAberto(true)} className="ml-auto text-xs font-semibold text-muted hover:text-brand">Reconectar</button>
                  </>
                ) : on ? (
                  <>
                    <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400"><Icon name="check" size={14} /> Conectado</span>
                    {conn!.lastSyncAt && <span className="text-[11px] text-muted">· sync {new Date(conn!.lastSyncAt).toLocaleDateString('pt-BR')}</span>}
                    <button onClick={() => conectar(app)} className="ml-auto text-xs font-semibold text-muted hover:text-brand">Reconfigurar</button>
                  </>
                ) : app.estado === 'nativa' ? (
                  <span className="text-xs text-muted">Ligada por credencial no servidor.</span>
                ) : app.estado === 'planejado' ? (
                  <span className="text-xs text-muted">Conector em desenvolvimento.</span>
                ) : app.estado === 'qr' ? (
                  <Button onClick={() => setWhatsappAberto(true)} className="!py-1.5 !text-xs">
                    <Icon name="plus" size={13} /> Conectar
                  </Button>
                ) : (
                  <Button onClick={() => conectar(app)} disabled={busy === app.key} className="!py-1.5 !text-xs">
                    {busy === app.key ? 'Abrindo…' : <><Icon name="plus" size={13} /> Conectar</>}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-center text-xs text-muted">
        Conexões passam pelo servidor. Onde a credencial ainda não está configurada, o app mostra exatamente qual variável falta, nada é simulado.
      </p>

      {whatsappAberto && (
        <WhatsAppConnectModal
          onClose={() => setWhatsappAberto(false)}
          onConnected={() => {
            setWhatsappAberto(false);
            recarregar();
          }}
        />
      )}
    </div>
  );
}
