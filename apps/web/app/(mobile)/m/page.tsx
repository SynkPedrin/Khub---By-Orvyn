'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { BannerNotificacoes, Esqueleto, ImagemProtegida, fmtDataHora, fmtDia, fmtHora, fmtRelativo, useAtualizarAoVoltar, diaSP } from '@/components/mobile/ui';
import { useAuth } from '@/lib/auth';
import { aprovacoes, ROTULO_TIPO, urlArquivo, type AprovacaoResumo } from '@/lib/aprovacoes';
import { agenda, type Compromisso } from '@/lib/agenda';

function saudacao(): string {
  const h = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' }));
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

export default function InicioMobile() {
  const { user } = useAuth();
  const [pendentes, setPendentes] = useState<AprovacaoResumo[] | null>(null);
  const [compromissos, setCompromissos] = useState<Compromisso[] | null>(null);
  const [erro, setErro] = useState(false);

  const carregar = useCallback(() => {
    aprovacoes.listar({ status: ['pendente'], visao: 'cliente' }).then(setPendentes).catch(() => setErro(true));
    const agora = new Date();
    const ate = new Date(agora.getTime() + 2 * 24 * 3600 * 1000);
    agenda
      .compromissos({ de: new Date(agora.getTime() - 3600 * 1000).toISOString(), ate: ate.toISOString(), status: ['agendado', 'confirmado'] })
      .then((l) => setCompromissos(l.sort((a, b) => a.inicio.localeCompare(b.inicio)).slice(0, 6)))
      .catch(() => setCompromissos([]));
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  useAtualizarAoVoltar(carregar);

  const primeiroNome = (user?.name ?? '').split(' ')[0];
  const hoje = diaSP(new Date());
  const amanha = diaSP(new Date(Date.now() + 24 * 3600 * 1000));
  const rotuloDia = (d: string, iso: string) => (d === hoje ? 'hoje' : d === amanha ? 'amanhã' : fmtDia(iso));

  return (
    <div>
      <header className="mb-5 flex items-center justify-between pt-2">
        <div className="min-w-0">
          <p className="text-sm text-muted">{saudacao()}{primeiroNome ? ',' : ''}</p>
          <h1 className="truncate font-display text-[28px] font-bold leading-tight tracking-tight">{primeiroNome || 'Olá'}</h1>
          {user?.empresa && <p className="truncate text-xs text-faint">{user.empresa}</p>}
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/pwa/icon-192.png" alt="KHUB" className="h-11 w-11 rounded-xl" />
      </header>

      <BannerNotificacoes compacto />

      {/* Pendências */}
      <Link
        href="/m/aprovacoes"
        className="mb-5 flex items-center gap-4 rounded-3xl border border-line bg-surface p-5 active:scale-[0.99]"
      >
        <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-2xl font-bold ${pendentes?.length ? 'bg-brand text-[#0b0b0b]' : 'bg-surface2 text-muted'}`}>
          {pendentes ? pendentes.length : '–'}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-bold">{pendentes?.length === 1 ? 'Peça para aprovar' : 'Peças para aprovar'}</span>
          <span className="block text-sm text-muted">{pendentes?.length ? 'Artes e roteiros esperando sua resposta' : 'Tudo em dia por aqui'}</span>
        </span>
        <Icon name="chevronRight" size={20} className="text-muted" />
      </Link>

      {erro && <p className="mb-4 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">Não foi possível carregar. Puxe para atualizar ou tente mais tarde.</p>}

      {pendentes === null ? (
        <Esqueleto linhas={2} />
      ) : (
        pendentes.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted">Aguardando você</h2>
            <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
              {pendentes.slice(0, 8).map((p) => (
                <Link key={p.id} href={`/m/aprovacoes/${p.id}`} className="w-[78%] shrink-0 snap-start overflow-hidden rounded-3xl border border-line bg-surface active:scale-[0.99]">
                  <div className="relative aspect-[4/3] w-full bg-surface2">
                    {p.capaId && p.capaMime?.startsWith('image/') ? (
                      <ImagemProtegida src={urlArquivo(p.id, p.capaId)} alt={p.titulo} className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full overflow-hidden px-4 pb-4 pt-12 text-[13px] leading-relaxed text-muted">
                        <Icon name={p.tipo === 'roteiro' ? 'note' : p.tipo === 'video' ? 'video' : 'file'} size={22} className="mb-2 hidden text-brand" />
                        <p className="line-clamp-5 whitespace-pre-line">{p.trecho ?? 'Toque para ver os detalhes.'}</p>
                      </div>
                    )}
                    <span className="absolute left-3 top-3 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-bold text-white">{ROTULO_TIPO[p.tipo]}{p.versao > 1 ? ` · v${p.versao}` : ''}</span>
                  </div>
                  <div className="p-4">
                    <p className="line-clamp-1 font-bold">{p.titulo}</p>
                    <p className="mt-0.5 text-xs text-muted">{p.prazoEm ? `Responder até ${fmtDataHora(p.prazoEm)}` : p.enviadaEm ? `Enviado ${fmtRelativo(p.enviadaEm)}` : ''}</p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )
      )}

      {/* Agenda */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted">Próximos na agenda</h2>
          <Link href="/m/agenda" className="text-xs font-bold text-brand">Ver agenda</Link>
        </div>
        {compromissos === null ? (
          <Esqueleto linhas={2} />
        ) : compromissos.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line p-5 text-center text-sm text-muted">Nada marcado para hoje e amanhã.</div>
        ) : (
          <ul className="space-y-2">
            {compromissos.map((c) => {
              const dia = diaSP(new Date(c.inicio));
              return (
                <li key={c.id}>
                  <Link href={`/m/agenda?dia=${dia}&c=${c.id}`} className="flex items-center gap-3 rounded-2xl bg-surface p-3.5 active:scale-[0.99]">
                    <span className="w-14 shrink-0 text-center">
                      <span className="block text-[15px] font-bold">{fmtHora(c.inicio)}</span>
                      <span className="block text-[11px] text-muted">{rotuloDia(dia, c.inicio)}</span>
                    </span>
                    <span className="h-9 w-1 shrink-0 rounded-full" style={{ background: c.status === 'confirmado' ? 'var(--success)' : 'var(--brand)' }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{c.contatoNome || c.titulo}</span>
                      <span className="block truncate text-xs text-muted">{c.servicoNome || c.titulo}{c.status === 'confirmado' ? ' · confirmado' : ''}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
