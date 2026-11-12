'use client';

import { BrandLogo, type BrandKey } from '@/components/brand/BrandLogo';
import { Icon, type IconName } from '@/components/icons';

/**
 * Identidade visual de cada canal de Conversas: logo oficial
 * (`public/logos/*.webp` via BrandLogo) quando existe, senão ícone com a cor
 * do token `--ch-*`. Um lugar só: lista, thread, coluna e cartões usam isto.
 */
const CANAIS: Record<string, { rotulo: string; brand?: BrandKey; icone: IconName; cor: string }> = {
  WhatsApp: { rotulo: 'WhatsApp', brand: 'whatsapp', icone: 'whatsapp', cor: 'var(--ch-whatsapp)' },
  Instagram: { rotulo: 'Instagram', brand: 'instagram', icone: 'instagram', cor: 'var(--ch-instagram)' },
  // Sem BrandLogo: o SVG do Messenger usa um id de gradiente fixo que some quando a 1ª cópia está oculta.
  Messenger: { rotulo: 'Messenger', icone: 'chat', cor: 'var(--ch-messenger)' },
  Facebook: { rotulo: 'Facebook', brand: 'meta', icone: 'chat', cor: 'var(--ch-facebook)' },
  YouTube: { rotulo: 'YouTube', brand: 'youtube', icone: 'video', cor: 'var(--ch-youtube)' },
  TikTok: { rotulo: 'TikTok', brand: 'tiktok', icone: 'video', cor: 'var(--ch-tiktok)' },
  'E-mail': { rotulo: 'E-mail', icone: 'mail', cor: 'var(--ch-email)' },
  Site: { rotulo: 'Site', icone: 'globe', cor: 'var(--ch-site)' },
};

/** Rede do cartão de conexão → canal (para reaproveitar o mesmo ícone). */
export const CANAL_DA_REDE: Record<string, string> = { whatsapp: 'WhatsApp', instagram: 'Instagram', messenger: 'Messenger', youtube: 'YouTube', tiktok: 'TikTok' };

export function canalInfo(canal: string) {
  return CANAIS[canal] ?? { rotulo: canal, icone: 'chat' as IconName, cor: 'var(--ch-site)' };
}

export function CanalIcone({ canal, size = 16, className }: { canal: string; size?: number; className?: string }) {
  const c = canalInfo(canal);
  if (c.brand) return <BrandLogo brand={c.brand} size={size} className={className} />;
  return <Icon name={c.icone} size={size} className={className} style={{ color: c.cor }} />;
}

/** Selo pequeno do canal sobre o avatar (lista e cabeçalho da thread). */
export function SeloCanal({ canal }: { canal: string }) {
  return (
    <span className="absolute -bottom-0.5 -right-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[var(--base-0)] shadow-sm ring-1 ring-line" title={canalInfo(canal).rotulo}>
      <CanalIcone canal={canal} size={12} />
    </span>
  );
}
