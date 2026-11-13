import type { ReactNode } from 'react';
import { BrandLogo, type BrandKey } from '../brand/BrandLogo';
import { Icon, type IconName } from '../icons';
import { cx } from '../ui';
import type { Canal, FaixaScore, StatusLead } from '@/lib/revenue/types';

/**
 * Vocabulário visual compartilhado de Leads.
 *
 * Canal, status e score aparecem na listagem, no perfil, no pipeline e nas
 * conversas. Centralizar as traduções aqui garante que "Qualificado" tenha a
 * mesma cor nos quatro lugares — e que mudar isso seja uma edição só.
 */

/* ---------------------------- Canal ---------------------------- */

const CANAL: Record<Canal, { rotulo: string; icone: IconName; cor: string; brand?: BrandKey }> = {
  whatsapp: { rotulo: 'WhatsApp', icone: 'whatsapp', cor: 'var(--ch-whatsapp)', brand: 'whatsapp' },
  instagram: { rotulo: 'Instagram', icone: 'instagram', cor: 'var(--ch-instagram)', brand: 'instagram' },
  email: { rotulo: 'E-mail', icone: 'mail', cor: 'var(--ch-email)' },
  linkedin: { rotulo: 'LinkedIn', icone: 'linkedin', cor: 'var(--ch-linkedin)' },
  site: { rotulo: 'Site', icone: 'globe', cor: 'var(--ch-site)' },
  google: { rotulo: 'Google Ads', icone: 'search', cor: '#ea4335', brand: 'google_ads' },
  indicacao: { rotulo: 'Indicação', icone: 'users', cor: '#f59e0b' },
  forms: { rotulo: 'Formulário', icone: 'file', cor: '#0284c7' },
  parceria: { rotulo: 'Parceria', icone: 'link', cor: '#7c3aed' },
};

export function CanalBadge({ canal, comRotulo = true }: { canal: Canal; comRotulo?: boolean }) {
  const c = CANAL[canal] ?? CANAL.site;
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-fg">
      {c.brand ? (
        <BrandLogo brand={c.brand} size={16} className="shrink-0" />
      ) : (
        <Icon name={c.icone} size={15} style={{ color: c.cor }} className="shrink-0" />
      )}
      {comRotulo && <span className="truncate">{c.rotulo}</span>}
    </span>
  );
}

export function canalRotulo(canal: Canal): string {
  return (CANAL[canal] ?? CANAL.site).rotulo;
}

/* ---------------------------- Status --------------------------- */

const STATUS: Record<StatusLead, { rotulo: string; classe: string; icone?: IconName }> = {
  novo: { rotulo: 'Novo', classe: 'pill-info' },
  em_analise: { rotulo: 'Em análise', classe: 'pill-warning' },
  qualificado: { rotulo: 'Qualificado', classe: 'pill-brand' },
  quente: { rotulo: 'Quente', classe: 'pill-danger', icone: 'flame' },
  sem_resposta: { rotulo: 'Sem resposta', classe: '' },
  cliente: { rotulo: 'Cliente', classe: 'pill-success' },
  perdido: { rotulo: 'Perdido', classe: '' },
};

export function StatusBadge({ status }: { status: StatusLead }) {
  const s = STATUS[status] ?? STATUS.novo;
  return (
    <span className={cx('pill', s.classe)}>
      {s.icone && <Icon name={s.icone} size={12} />}
      {s.rotulo}
    </span>
  );
}

export function statusRotulo(status: StatusLead): string {
  return (STATUS[status] ?? STATUS.novo).rotulo;
}

/* ---------------------------- Score ---------------------------- */

/**
 * Score NICO.
 *
 * A faixa (quente/morno/frio) vem do backend junto do número. `sem_sinal`
 * mostra um travessão, não zero: lead recém-criado não tem score baixo, tem
 * ausência de score — e 0 comunicaria a coisa errada ao vendedor.
 */
export function ScoreBadge({ score, faixa }: { score: number | null; faixa?: FaixaScore }) {
  if (score == null || faixa === 'sem_sinal') {
    return <span className="text-[13px] text-faint" title="Ainda sem sinais suficientes para pontuar">-</span>;
  }

  const f: FaixaScore = faixa ?? (score >= 75 ? 'quente' : score >= 45 ? 'morno' : 'frio');
  const cor = { quente: 'text-danger', morno: 'text-warning', frio: 'text-muted', sem_sinal: 'text-faint' }[f];
  const icone: IconName = f === 'quente' ? 'flame' : f === 'morno' ? 'flame' : 'minus';

  return (
    <span className={cx('inline-flex items-center gap-1 text-[13px] font-semibold tabular', cor)}>
      <Icon name={icone} size={14} className="shrink-0" />
      {score}
    </span>
  );
}

/* ------------------------- Blocos comuns ----------------------- */

/** Linha rótulo→valor, usada nos painéis de detalhe. */
export function LinhaInfo({
  rotulo,
  children,
  icone,
}: {
  rotulo?: string;
  children: ReactNode;
  icone?: IconName;
}) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      {icone && <Icon name={icone} size={15} className="mt-0.5 shrink-0 text-faint" />}
      {rotulo && <span className="w-32 shrink-0 text-[13px] text-muted">{rotulo}</span>}
      <span className="min-w-0 flex-1 text-[13px] text-fg">{children}</span>
    </div>
  );
}

/** Lista de tags com botão de adicionar. */
export function Tags({ tags, onAdd }: { tags: string[]; onAdd?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <span key={t} className="tag">
          {t}
        </span>
      ))}
      {onAdd && (
        <button type="button" onClick={onAdd} className="btn btn-ghost btn-sm h-[26px] w-[26px] p-0" aria-label="Adicionar tag">
          <Icon name="plus" size={14} />
        </button>
      )}
    </div>
  );
}
