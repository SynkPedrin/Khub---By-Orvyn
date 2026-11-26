'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { BannerNotificacoes, Cabecalho, Esqueleto, ImagemProtegida, StatusPill, Vazio, fmtDataHora, fmtRelativo, useAtualizarAoVoltar } from '@/components/mobile/ui';
import { aprovacoes, ROTULO_TIPO, urlArquivo, type AprovacaoResumo, type StatusAprovacao } from '@/lib/aprovacoes';

type Filtro = 'pendente' | 'ajustes' | 'aprovado' | 'todas';
const FILTROS: { id: Filtro; label: string }[] = [
  { id: 'pendente', label: 'Para aprovar' },
  { id: 'ajustes', label: 'Em ajuste' },
  { id: 'aprovado', label: 'Aprovadas' },
  { id: 'todas', label: 'Todas' },
];
const STATUS_DO_FILTRO: Record<Filtro, StatusAprovacao[] | undefined> = {
  pendente: ['pendente'],
  ajustes: ['ajustes'],
  aprovado: ['aprovado'],
  todas: undefined,
};

export default function AprovacoesMobile() {
  const [filtro, setFiltro] = useState<Filtro>('pendente');
  const [lista, setLista] = useState<AprovacaoResumo[] | null>(null);
  const [erro, setErro] = useState(false);

  const carregar = useCallback(() => {
    setErro(false);
    aprovacoes.listar({ status: STATUS_DO_FILTRO[filtro], visao: 'cliente' }).then(setLista).catch(() => setErro(true));
  }, [filtro]);
  useEffect(() => { setLista(null); carregar(); }, [carregar]);
  useAtualizarAoVoltar(carregar);

  return (
    <div>
      <Cabecalho titulo="Aprovações" sub="Artes e roteiros da sua equipe de marketing" />
      <BannerNotificacoes compacto />

      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]" role="tablist">
        {FILTROS.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={filtro === f.id}
            type="button"
            onClick={() => setFiltro(f.id)}
            className={cx('h-9 shrink-0 rounded-full px-4 text-sm font-semibold transition', filtro === f.id ? 'bg-fg text-bg' : 'bg-surface2 text-muted')}
          >
            {f.label}
          </button>
        ))}
      </div>

      {erro && <p className="mb-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">Não foi possível carregar as aprovações.</p>}

      {lista === null ? (
        <Esqueleto linhas={4} />
      ) : lista.length === 0 ? (
        <Vazio
          icone="check2"
          titulo={filtro === 'pendente' ? 'Nada para aprovar' : 'Nada por aqui'}
          texto={filtro === 'pendente' ? 'Quando a equipe enviar uma arte ou roteiro, você recebe um aviso e a peça aparece aqui.' : 'As peças deste filtro aparecem aqui.'}
        />
      ) : (
        <ul className="space-y-3">
          {lista.map((p) => (
            <li key={p.id}>
              <Link href={`/m/aprovacoes/${p.id}`} className="flex gap-3 rounded-2xl border border-line bg-surface p-3 active:scale-[0.99]">
                <span className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-surface2">
                  {p.capaId && p.capaMime?.startsWith('image/') ? (
                    <ImagemProtegida src={urlArquivo(p.id, p.capaId)} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="grid h-full w-full place-items-center text-brand">
                      <Icon name={p.tipo === 'roteiro' ? 'note' : p.tipo === 'video' ? 'video' : p.capaMime === 'application/pdf' ? 'file' : 'paperclip'} size={26} />
                    </span>
                  )}
                  {p.qtdArquivos > 1 && <span className="absolute bottom-1 right-1 rounded-md bg-black/70 px-1.5 text-[10px] font-bold text-white">+{p.qtdArquivos - 1}</span>}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="mb-1 flex items-center gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-faint">{ROTULO_TIPO[p.tipo]}{p.canal ? ` · ${p.canal}` : ''}</span>
                  </span>
                  <span className="line-clamp-2 text-[15px] font-semibold leading-snug">{p.titulo}</span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-2">
                    <StatusPill status={p.status} />
                    <span className="text-[11px] text-muted">
                      {p.status === 'pendente' && p.prazoEm ? `até ${fmtDataHora(p.prazoEm)}` : fmtRelativo(p.respondidoEm ?? p.enviadaEm ?? p.createdAt)}
                    </span>
                    {p.versao > 1 && <span className="text-[11px] text-muted">v{p.versao}</span>}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
