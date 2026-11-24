import type { IconName } from '@/components/icons';
import { cx } from '@/components/ui';
import { COR_FAMILIA, SimboloNo, familiaDoTipo } from './IconeNo';

/**
 * Selo de cada nó de automação: a logo PRÓPRIA do passo (símbolo desenhado
 * sobre o bloco da cor da família, ver IconeNo.tsx) e, quando o passo usa um
 * canal ou sistema externo, o selinho da marca no canto (WhatsApp, Instagram,
 * Meta, TikTok, Google, NICO). Um lugar só: canvas, paleta, lista, modo simples.
 */
export interface Marca {
  src: string;
  nome: string;
}

const WHATSAPP: Marca = { src: '/logos/whatsapp.webp', nome: 'WhatsApp' };
const INSTAGRAM: Marca = { src: '/logos/instagram.webp', nome: 'Instagram' };
const META: Marca = { src: '/logos/meta.webp', nome: 'Meta' };
const TIKTOK: Marca = { src: '/logos/tiktok.webp', nome: 'TikTok' };
const GOOGLE: Marca = { src: '/logos/google-ads.webp', nome: 'Google' };
const NICO: Marca = { src: '/nico-avatar.png', nome: 'NICO' };

function porOrigem(origem: unknown): Marca | null {
  const o = String(origem ?? '').toLowerCase();
  if (!o) return null;
  if (o.includes('insta')) return INSTAGRAM;
  if (o.includes('meta') || o.includes('facebook')) return META;
  if (o.includes('tiktok')) return TIKTOK;
  if (o.includes('google')) return GOOGLE;
  if (o.includes('whats')) return WHATSAPP;
  return null;
}

/** Canal/sistema externo do passo (vira o selinho no canto da logo). */
export function marcaDoNo(tipo: string, config: Record<string, unknown> = {}): Marca | null {
  switch (tipo) {
    case 'acao.enviar_sms':
    case 'acao.notificar_equipe':
    case 'controle.esperar_resposta':
      return WHATSAPP;
    case 'acao.pedir_avaliacao':
      return config.canal === 'email' ? null : WHATSAPP;
    case 'gatilho.mensagem_recebida':
      return porOrigem(config.canal) ?? WHATSAPP;
    case 'gatilho.contato_criado':
      return porOrigem(config.origem);
    case 'acao.ia':
      return NICO;
    default:
      return null;
  }
}

/** Cor de acento do nó (faixa do topo, ponto da categoria, alças): a da família. */
export function acentoDoNo(tipo: string): string {
  return COR_FAMILIA[familiaDoTipo(tipo)].base;
}

/**
 * Quadradinho do nó. `tamanho` em px (canvas 40, paleta 30, lista 22–26).
 * `icone`/`acento` ficam aceitos por compatibilidade com quem já chama.
 */
export function SeloNo({ tipo, config, tamanho = 36, className }: {
  tipo: string;
  config?: Record<string, unknown>;
  icone?: IconName;
  acento?: string;
  tamanho?: number;
  className?: string;
}) {
  const fam = COR_FAMILIA[familiaDoTipo(tipo)];
  const marca = marcaDoNo(tipo, config);
  const raio = Math.round(tamanho * 0.3);
  const selo = Math.max(12, Math.round(tamanho * 0.42));
  return (
    <span className={cx('selo-no relative inline-grid shrink-0', className)} style={{ width: tamanho, height: tamanho }} title={marca ? `${fam.nome} · ${marca.nome}` : fam.nome}>
      <span
        className="grid h-full w-full place-items-center"
        style={{
          borderRadius: raio,
          background: `linear-gradient(145deg, ${fam.claro} -20%, ${fam.base} 62%)`,
          boxShadow: `inset 0 1px 0 rgba(255,255,255,.28), inset 0 0 0 1px color-mix(in srgb, ${fam.base} 70%, #000), 0 2px 6px -2px color-mix(in srgb, ${fam.base} 60%, transparent)`,
        }}
      >
        <SimboloNo tipo={tipo} tamanho={Math.round(tamanho * 0.56)} cor="#ffffff" />
      </span>
      {marca && (
        <span
          className="absolute grid place-items-center overflow-hidden rounded-full bg-white"
          style={{ width: selo, height: selo, right: -selo * 0.28, bottom: -selo * 0.28, boxShadow: '0 0 0 2px var(--surface, #fff), 0 1px 3px rgba(0,0,0,.25)' }}
          aria-hidden
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={marca.src} alt="" className="object-contain" style={{ width: selo * 0.78, height: selo * 0.78 }} draggable={false} />
        </span>
      )}
    </span>
  );
}
