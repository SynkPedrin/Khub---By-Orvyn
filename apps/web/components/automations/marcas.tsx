import { Icon, type IconName } from '@/components/icons';
import { cx } from '@/components/ui';

/**
 * Logo real de cada nó de automação: o canal ou o sistema que faz o passo.
 * Um lugar só, usado no canvas, na paleta, na lista e no modo simples.
 *
 * - WhatsApp: tudo que fala com o contato ou a equipe pelo WhatsApp.
 * - Instagram / Meta / TikTok / Google: quando a config diz o canal ou a origem.
 * - NICO: o nó de IA.
 * - KHUB: o que acontece dentro do CRM (tag, oportunidade, tarefa, nota…).
 * Sem marca (esperar, condição, agenda): fica o ícone.
 */
export interface Marca {
  src: string;
  nome: string;
  /** A logo é branca (KHUB): precisa de fundo escuro para aparecer no tema claro. */
  escura?: boolean;
}

const WHATSAPP: Marca = { src: '/logos/whatsapp.webp', nome: 'WhatsApp' };
const INSTAGRAM: Marca = { src: '/logos/instagram.webp', nome: 'Instagram' };
const META: Marca = { src: '/logos/meta.webp', nome: 'Meta' };
const TIKTOK: Marca = { src: '/logos/tiktok.webp', nome: 'TikTok' };
const GOOGLE: Marca = { src: '/logos/google-ads.webp', nome: 'Google' };
const NICO: Marca = { src: '/nico-avatar.png', nome: 'NICO' };
const KHUB: Marca = { src: '/khub-mark.png', nome: 'KHUB CRM', escura: true };

const DO_CRM = new Set([
  'gatilho.contato_criado', 'gatilho.tag_adicionada', 'gatilho.negocio_criado', 'gatilho.etapa_mudou', 'gatilho.negocio_status',
  'acao.adicionar_tag', 'acao.remover_tag', 'acao.atualizar_contato', 'acao.atribuir_usuario', 'acao.nao_perturbe',
  'acao.criar_oportunidade', 'acao.mover_etapa', 'acao.atualizar_negocio', 'acao.criar_tarefa', 'acao.criar_nota',
  'acao.chamar_workflow', 'acao.remover_de_fluxo',
]);

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
      return porOrigem(config.origem) ?? KHUB;
    case 'acao.ia':
      return NICO;
    default:
      return DO_CRM.has(tipo) ? KHUB : null;
  }
}

/**
 * Quadradinho do nó: a logo real quando existe, senão o ícone na cor da
 * categoria. `tamanho` em px (o canvas usa 36, a lista 22).
 */
export function SeloNo({ tipo, config, icone, acento, tamanho = 36, className }: {
  tipo: string;
  config?: Record<string, unknown>;
  icone: IconName;
  acento: string;
  tamanho?: number;
  className?: string;
}) {
  const marca = marcaDoNo(tipo, config);
  const raio = Math.round(tamanho * 0.3);
  if (marca) {
    return (
      <span
        className={cx('grid shrink-0 place-items-center overflow-hidden', className)}
        style={{
          width: tamanho, height: tamanho, borderRadius: raio,
          background: marca.escura ? '#0b0b0f' : 'var(--base-0)',
          boxShadow: 'inset 0 0 0 1px var(--border)',
        }}
        title={marca.nome}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={marca.src} alt={marca.nome} className="object-contain" style={{ width: tamanho * 0.66, height: tamanho * 0.66 }} draggable={false} />
      </span>
    );
  }
  return (
    <span
      className={cx('grid shrink-0 place-items-center', className)}
      style={{
        width: tamanho, height: tamanho, borderRadius: raio, color: acento,
        background: `color-mix(in srgb, ${acento} 14%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${acento} 30%, transparent)`,
      }}
    >
      <Icon name={icone} size={Math.round(tamanho * 0.45)} />
    </span>
  );
}
