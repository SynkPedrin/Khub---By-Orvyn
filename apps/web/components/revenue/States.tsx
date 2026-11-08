import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icons';
import { cx } from '../ui';

/**
 * Estados de tela: vazio, erro e carregando.
 *
 * Existem para cumprir a regra "nunca deixar a interface quebrada em
 * silêncio": toda lista, painel e widget do produto termina em um destes
 * três, nunca em uma área em branco sem explicação.
 */

export function EmptyState({
  icon = 'info',
  title,
  description,
  action,
  className,
  premium = false,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  /**
   * Assinatura visual da marca por trás do ícone — um gradiente estático nos
   * tokens da ametista, não vídeo. Reservado para os empty states MAIS
   * importantes do produto (ver uso em `DashboardVazio`); usar em toda tela
   * vazia comum contradiz a regra de moderação da marca e arrisca competir
   * com o conteúdo. Estático de propósito: `<video autoplay>` numa tela
   * vazia — que o usuário pode encontrar dezenas de vezes navegando —
   * violaria a mesma regra que impede vídeo em cards/modais/tabelas, e
   * criaria risco real de várias instâncias do mesmo MP4 tocando ao mesmo
   * tempo se o produto tiver mais de um estado vazio na tela.
   */
  premium?: boolean;
}) {
  return (
    <div className={cx('state relative overflow-hidden', className)}>
      {premium && (
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden
          style={{
            background:
              'radial-gradient(60% 55% at 50% 0%, color-mix(in srgb, var(--brand) 7%, transparent), transparent 70%)',
          }}
        />
      )}
      <span className={cx('icon-tile relative h-11 w-11 rounded-lg', premium ? '' : 'icon-tile-neutral')}>
        <Icon name={icon} size={21} />
      </span>
      <p className="relative t-section mt-1">{title}</p>
      {description && <p className="relative max-w-sm text-[13.5px] text-muted">{description}</p>}
      {action && <div className="relative mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = 'Não foi possível carregar',
  description,
  onRetry,
  className,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={cx('state', className)} role="alert">
      <span className="icon-tile icon-tile-danger h-11 w-11 rounded-lg">
        <Icon name="alert" size={21} />
      </span>
      <p className="t-section mt-1">{title}</p>
      {description && <p className="max-w-sm text-[13.5px] text-muted">{description}</p>}
      {onRetry && (
        <button type="button" className="btn btn-sm mt-2" onClick={onRetry}>
          <Icon name="refresh" size={14} />
          Tentar de novo
        </button>
      )}
    </div>
  );
}

/**
 * Estado de credencial ausente.
 *
 * O backend responde `config_required` (501) quando falta uma chave — este
 * é o par visual disso. Diz o que falta e onde resolver, em vez de mostrar
 * um erro genérico ou, pior, um dado inventado.
 */
export function ConfigRequiredState({
  recurso,
  faltando,
  className,
}: {
  recurso: string;
  faltando?: string[];
  className?: string;
}) {
  return (
    <div className={cx('state', className)}>
      <span className="icon-tile icon-tile-warning h-11 w-11 rounded-lg">
        <Icon name="lock" size={21} />
      </span>
      <p className="t-section mt-1">{recurso} ainda não está configurado</p>
      <p className="max-w-md text-[13.5px] text-muted">
        Este módulo precisa de uma credencial para funcionar. Enquanto ela não for configurada, nada é exibido -
        preferimos não mostrar dado nenhum a mostrar dado falso.
      </p>
      {faltando && faltando.length > 0 && (
        <p className="mt-1 flex flex-wrap justify-center gap-1.5">
          {faltando.map((v) => (
            <code key={v} className="rounded-sm bg-surface3 px-1.5 py-0.5 font-mono text-xs text-muted">
              {v}
            </code>
          ))}
        </p>
      )}
      <a href="/configuracoes?aba=integracoes" className="btn btn-sm mt-2">
        Abrir configurações
        <Icon name="arrowRight" size={14} />
      </a>
    </div>
  );
}

/** Linhas de esqueleto para listas e tabelas. */
export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cx('space-y-2.5 p-5', className)} aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando…</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton h-11 w-full rounded-md" />
      ))}
    </div>
  );
}
