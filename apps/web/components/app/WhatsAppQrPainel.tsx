'use client';

import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { BrandLogo } from '@/components/brand/BrandLogo';
import { Button, Confirm, useToast } from '@/components/kit';
import { ConfigRequired } from '@/components/app/ConfigRequired';
import { ApiError } from '@/lib/api-error';
import { useRealtime } from '@/lib/realtime';
import { diasRestantes, whatsappQrApi, type LinkConexaoWa, type PainelWhatsAppQr } from '@/lib/whatsapp-qr';

/**
 * WhatsApp por QR Code próprio (open-wa na VPS, ADR-0058), em Integrações.
 * - Conectar aqui: o QR aparece no painel e troca sozinho.
 * - Link para o cliente: página pública de 7 dias (/w/<token>) com o QR.
 * - Histórico: vem sozinho na primeira conexão; dá para pedir mais dias.
 * Estado sempre do gateway; atualiza por tempo real (whatsapp.estado) e,
 * enquanto espera o QR, por consulta a cada 3 s.
 */
const ROTULO: Record<string, { texto: string; tom: string }> = {
  conectado: { texto: 'Conectado', tom: 'bg-success-soft text-success border-success-border' },
  aguardando_qr: { texto: 'Aguardando leitura do QR', tom: 'bg-warning-soft text-warning border-warning-border' },
  iniciando: { texto: 'Iniciando', tom: 'bg-info-soft text-info border-info-border' },
  desconectado: { texto: 'Desconectado', tom: 'bg-danger-soft text-danger border-danger-border' },
  erro: { texto: 'Com erro', tom: 'bg-danger-soft text-danger border-danger-border' },
  nao_conectado: { texto: 'Não conectado', tom: 'bg-surface2 text-muted border-line' },
};
const DIAS = [30, 90, 180, 365];

const msg = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Tente de novo.');

export function WhatsAppQrPainel() {
  const toast = useToast();
  const [p, setP] = useState<PainelWhatsAppQr | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [linkNovo, setLinkNovo] = useState<{ url: string; expiraEm: string } | null>(null);
  const [dias, setDias] = useState(90);
  const [sair, setSair] = useState(false);
  const [historicoAndando, setHistoricoAndando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setP(await whatsappQrApi.painel());
      setErro(null);
    } catch (e) {
      setErro(msg(e));
    }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  useRealtime({
    'whatsapp.estado': (d) => {
      if (d.historico) setHistoricoAndando(!d.historico.concluido);
      void carregar();
    },
  });

  const esperando = p?.estado === 'aguardando_qr' || p?.estado === 'iniciando';
  useEffect(() => {
    if (!esperando) return;
    const t = window.setInterval(() => void carregar(), 3000);
    return () => window.clearInterval(t);
  }, [esperando, carregar]);

  const agir = async (chave: string, fn: () => Promise<unknown>, ok?: string) => {
    setOcupado(chave);
    try {
      await fn();
      if (ok) toast.success(ok);
      await carregar();
    } catch (e) {
      toast.error('Não deu certo', { description: msg(e) });
    } finally {
      setOcupado(null);
    }
  };

  const criarLink = () => agir('link', async () => {
    const r = await whatsappQrApi.criarLink();
    setLinkNovo(r);
    await copiar(r.url, false);
  });

  const copiar = async (url: string, avisar = true) => {
    try {
      await navigator.clipboard.writeText(url);
      if (avisar) toast.success('Link copiado');
    } catch {
      /* sem permissão de área de transferência: o link continua visível para copiar à mão */
    }
  };

  if (!p) {
    return (
      <section className="card p-5" aria-busy={!erro}>
        {erro ? <p className="text-sm text-danger">Não consegui carregar o WhatsApp por QR Code: {erro}</p> : <div className="skeleton h-24 w-full rounded-xl" />}
      </section>
    );
  }

  const r = ROTULO[p.estado] ?? ROTULO.nao_conectado;
  const ativos = p.links.filter((l) => l.situacao === 'ativo');

  return (
    <section className="card overflow-hidden p-0" aria-labelledby="wa-qr-titulo">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-line bg-white shadow-sm"><BrandLogo brand="whatsapp" size={28} /></span>
        <div className="min-w-0 flex-1">
          <h2 id="wa-qr-titulo" className="font-bold text-fg">WhatsApp por QR Code <span className="text-xs font-semibold text-muted">· open-wa</span></h2>
          <p className="text-xs text-muted">O número do cliente conectado direto no KHUB, sem API paga: histórico, foto de perfil e mensagens em tempo real.</p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${r.tom}`}>● {r.texto}</span>
      </header>

      {!p.configurado ? (
        <div className="p-5"><ConfigRequired provider="openwa" missing={p.faltando} /></div>
      ) : (
        <div className="grid gap-6 p-5 lg:grid-cols-[1fr_300px]">
          <div className="space-y-5">
            {!p.gatewayOk && (
              <p className="flex items-center gap-2 rounded-xl border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger"><Icon name="alert" size={15} /> O servidor de WhatsApp (VPS) não respondeu. Confira se ele está ligado.</p>
            )}

            {p.estado === 'conectado' ? (
              <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface2 p-4">
                {p.fotoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.fotoUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
                ) : (
                  <span className="grid h-12 w-12 place-items-center rounded-full bg-[#25D366] text-white"><Icon name="whatsapp" size={22} /></span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-fg">{p.nome || 'WhatsApp conectado'}</p>
                  <p className="text-sm text-muted">{p.numero ? `+${p.numero}` : ''}{p.conectadoDesde ? ` · desde ${new Date(p.conectadoDesde).toLocaleDateString('pt-BR')}` : ''}</p>
                </div>
                <Button variant="danger" size="sm" icon="close" onClick={() => setSair(true)} loading={ocupado === 'sair'}>Desconectar</Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" icon="whatsapp" onClick={() => agir('conectar', whatsappQrApi.conectar)} loading={ocupado === 'conectar'}>
                  {p.estado === 'desconectado' || p.estado === 'erro' ? 'Reconectar aqui' : 'Conectar aqui'}
                </Button>
                <Button icon="link" onClick={() => void criarLink()} loading={ocupado === 'link'}>Gerar link para o cliente (7 dias)</Button>
              </div>
            )}

            {linkNovo && (
              <div className="rounded-2xl border-2 border-success-border bg-success-soft p-4">
                <p className="text-sm font-semibold text-fg">Link criado e copiado. Mande para o cliente:</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-fg">{linkNovo.url}</code>
                  <Button size="sm" icon="copy" onClick={() => void copiar(linkNovo.url)}>Copiar</Button>
                  <a className="btn btn-sm" href={`https://wa.me/?text=${encodeURIComponent(`Para conectar seu WhatsApp ao KHUB, abra este link no computador e leia o QR Code com o celular: ${linkNovo.url}`)}`} target="_blank" rel="noreferrer">
                    <Icon name="whatsapp" size={14} /> Enviar por WhatsApp
                  </a>
                </div>
                <p className="mt-2 text-xs text-muted">Vale até {new Date(linkNovo.expiraEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}. Não aparece de novo: guarde ou gere outro.</p>
              </div>
            )}

            {/* Histórico */}
            <div className="rounded-2xl border border-line p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Icon name="history" size={16} className="text-muted" />
                <p className="flex-1 text-sm font-semibold text-fg">Histórico de conversas</p>
                {historicoAndando && <span className="text-xs font-semibold text-info">Importando…</span>}
              </div>
              <p className="mt-1 text-sm text-muted">
                {p.historico.mensagens
                  ? `${p.historico.mensagens.toLocaleString('pt-BR')} mensagens de ${p.historico.conversas.toLocaleString('pt-BR')} conversas já no KHUB${p.historico.sincronizadoEm ? ` · última importação ${new Date(p.historico.sincronizadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : ''}.`
                  : 'Na primeira conexão, os últimos 90 dias chegam sozinhos. Mensagem antiga não aciona a IA nem as automações.'}
              </p>
              {p.estado === 'conectado' && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <label className="text-sm text-fg" htmlFor="wa-dias">Trazer os últimos</label>
                  <select id="wa-dias" className="select h-9 w-auto" value={dias} onChange={(e) => setDias(Number(e.target.value))}>
                    {DIAS.map((d) => <option key={d} value={d}>{d} dias</option>)}
                  </select>
                  <Button size="sm" icon="refresh" loading={ocupado === 'hist'} onClick={() => agir('hist', async () => { await whatsappQrApi.historico(dias); setHistoricoAndando(true); }, 'Importação do histórico iniciada')}>Importar histórico</Button>
                </div>
              )}
            </div>

            {/* Links */}
            <div>
              <div className="flex items-center gap-2">
                <p className="flex-1 text-sm font-semibold text-fg">Links de conexão</p>
                {p.estado === 'conectado' && <Button size="sm" variant="ghost" icon="link" onClick={() => void criarLink()} loading={ocupado === 'link'}>Novo link</Button>}
              </div>
              {p.links.length === 0 ? (
                <p className="mt-1 text-sm text-muted">Nenhum link ainda. Gere um para o cliente conectar o WhatsApp dele sem precisar entrar no KHUB.</p>
              ) : (
                <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
                  {p.links.map((l) => <LinhaLink key={l.id} l={l} ocupado={ocupado === l.id} onRevogar={() => agir(l.id, () => whatsappQrApi.revogarLink(l.id), 'Link cancelado')} />)}
                </ul>
              )}
              {ativos.length > 0 && <p className="mt-1.5 text-xs text-muted">Quem tiver um link ativo consegue conectar um WhatsApp nesta conta. Cancele os que não usar.</p>}
            </div>
          </div>

          {/* QR ao vivo */}
          <div className="flex flex-col items-center gap-2">
            <div className="grid h-[260px] w-[260px] place-items-center rounded-2xl border-2 border-line-strong bg-white p-3">
              {p.estado === 'conectado' ? (
                <div className="flex flex-col items-center gap-2 text-center text-sm text-neutral-700"><span className="grid h-14 w-14 place-items-center rounded-full bg-[#25D366] text-white"><Icon name="check" size={28} /></span>Conectado</div>
              ) : p.qr ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.qr} alt="QR Code para conectar o WhatsApp" className="h-full w-full object-contain" />
              ) : esperando ? (
                <div className="flex flex-col items-center gap-2 text-sm text-neutral-600"><span className="h-8 w-8 animate-spin rounded-full border-[3px] border-neutral-300 border-t-neutral-700" aria-hidden />Gerando QR Code…</div>
              ) : (
                <p className="px-4 text-center text-sm text-neutral-600">Clique em <strong>Conectar aqui</strong> para ver o QR Code, ou gere um link para o cliente.</p>
              )}
            </div>
            {p.qr && <p className="max-w-[260px] text-center text-xs text-muted">No celular: WhatsApp › Aparelhos conectados › Conectar um aparelho.</p>}
          </div>
        </div>
      )}

      <Confirm
        open={sair}
        onClose={() => setSair(false)}
        onConfirm={() => { setSair(false); void agir('sair', whatsappQrApi.desconectar, 'WhatsApp desconectado'); }}
        title="Desconectar o WhatsApp?"
        description="O número deixa de receber e enviar pelo KHUB e os links ativos são cancelados. As conversas e o histórico que já estão aqui continuam."
        confirmLabel="Desconectar"
      />
    </section>
  );
}

function LinhaLink({ l, ocupado, onRevogar }: { l: LinkConexaoWa; ocupado: boolean; onRevogar: () => void }) {
  const tom = l.situacao === 'ativo' ? 'text-success' : 'text-muted';
  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm">
      <Icon name="link" size={14} className="text-muted" />
      <span className="min-w-0 flex-1 text-fg">
        Criado em {new Date(l.criadoEm).toLocaleDateString('pt-BR')}
        <span className={`ml-2 text-xs font-semibold ${tom}`}>
          {l.situacao === 'ativo' ? `ativo · expira em ${diasRestantes(l.expiraEm)} dia(s)` : l.situacao}
        </span>
        {l.conectadoEm && <span className="ml-2 text-xs text-muted">· conectou {l.numero ? `+${l.numero}` : ''} em {new Date(l.conectadoEm).toLocaleDateString('pt-BR')}</span>}
        {!l.conectadoEm && l.acessos > 0 && <span className="ml-2 text-xs text-muted">· aberto pelo cliente</span>}
      </span>
      {l.situacao === 'ativo' && <Button size="sm" variant="ghost" onClick={onRevogar} loading={ocupado}>Cancelar link</Button>}
    </li>
  );
}
