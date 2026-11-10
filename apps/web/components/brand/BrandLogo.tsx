/**
 * Logos dos aplicativos que o KHUB integra. Meta, Instagram, WhatsApp,
 * Google Ads, TikTok e YouTube usam os ARQUIVO OFICIAIS da marca
 * (`public/logos/*.webp`); os demais seguem em SVG inline (sem URL externa:
 * a CSP bloquearia e cairia em fallback silencioso). Marcas reproduzidas
 * apenas para identificar a integração ao operador.
 */
import Image from 'next/image';

export type BrandKey =
  | 'meta' | 'meta_ads' | 'instagram' | 'whatsapp' | 'messenger'
  | 'google' | 'google_ads' | 'google_calendar' | 'gmail'
  | 'tiktok' | 'youtube' | 'stripe' | 'claude' | 'slack' | 'webhook';

/** Marcas com arquivo oficial em public/logos. */
const LOGO_FILE: Partial<Record<BrandKey, string>> = {
  meta: '/logos/meta.webp',
  meta_ads: '/logos/meta.webp',
  instagram: '/logos/instagram.webp',
  whatsapp: '/logos/whatsapp.webp',
  google_ads: '/logos/google-ads.webp',
  tiktok: '/logos/tiktok.webp',
  youtube: '/logos/youtube.webp',
};

function G() {
  return (
    <>
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.4a5.5 5.5 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.6-5.2 3.6-8.8z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-3l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 12 0 12 12 0 0 0 1.3 6.6l4 3.1C6.2 6.9 8.9 4.8 12 4.8z" />
    </>
  );
}

export function BrandLogo({ brand, size = 26, className }: { brand: BrandKey; size?: number; className?: string }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', className, 'aria-hidden': true, role: 'img' as const };

  // Arquivos oficiais da marca (meta, instagram, whatsapp, google_ads, tiktok, youtube).
  const file = LOGO_FILE[brand];
  if (file) {
    return (
      <Image
        src={file}
        alt=""
        width={size}
        height={size}
        unoptimized
        aria-hidden
        className={className}
        style={{ width: size, height: size, objectFit: 'contain', borderRadius: size * 0.24 }}
      />
    );
  }

  switch (brand) {
    case 'messenger':
      return (
        <svg {...p}>
          <defs>
            <linearGradient id="ms" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#00B2FF" />
              <stop offset="1" stopColor="#006AFF" />
            </linearGradient>
          </defs>
          <path fill="url(#ms)" d="M12 1.5C6.2 1.5 1.8 5.8 1.8 11.4c0 2.9 1.2 5.4 3.2 7.2v3.9l3-1.6c.9.25 1.9.4 3 .4 5.8 0 10.2-4.3 10.2-9.9S17.8 1.5 12 1.5z" />
          <path fill="#fff" d="m5.9 14.3 3-3.2 1.6 1.7 3-1.7-3 3.2-1.6-1.7z" />
        </svg>
      );
    case 'google':
      return <svg {...p}><G /></svg>;
    case 'gmail':
      return (
        <svg {...p}>
          <path fill="#fff" d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
          <path fill="#EA4335" d="M3 5h1.5L12 11l7.5-6H21a1 1 0 0 1 1 1v.4L12 13.5 2 6.4V6a1 1 0 0 1 1-1z" />
          <path fill="#34A853" d="M2 6.4 12 13.5V19H3a1 1 0 0 1-1-1z" />
          <path fill="#FBBC05" d="M22 6.4V18a1 1 0 0 1-1 1h-9v-5.5z" />
        </svg>
      );
    case 'google_calendar':
      return (
        <svg {...p}>
          <rect x="4" y="4" width="16" height="16" rx="2" fill="#fff" stroke="#DADCE0" strokeWidth="1" />
          <path fill="#4285F4" d="M4 6a2 2 0 0 1 2-2h1v4H4z" />
          <path fill="#EA4335" d="M17 4h1a2 2 0 0 1 2 2v1h-4z" />
          <path fill="#34A853" d="M20 17v1a2 2 0 0 1-2 2h-1v-4h3z" />
          <path fill="#FBBC05" d="M7 20H6a2 2 0 0 1-2-2v-1h3z" />
          <text x="12" y="16" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="#4285F4" fontFamily="Arial, sans-serif">31</text>
        </svg>
      );
    case 'stripe':
      return (
        <svg {...p}>
          <rect x="1.5" y="1.5" width="21" height="21" rx="5" fill="#635BFF" />
          <path fill="#fff" d="M11.7 9.6c0-.6.5-.83 1.3-.83 1.15 0 2.6.35 3.75.97V6.15A9.9 9.9 0 0 0 13 5.6c-2.45 0-4.08 1.28-4.08 3.42 0 3.34 4.6 2.8 4.6 4.24 0 .7-.6.93-1.45.93-1.25 0-2.86-.52-4.13-1.2v3.62c1.4.6 2.82.86 4.13.86 2.5 0 4.23-1.24 4.23-3.4-.02-3.6-4.6-2.96-4.6-4.32z" />
        </svg>
      );
    case 'claude':
      return (
        <svg {...p}>
          <rect x="1.5" y="1.5" width="21" height="21" rx="5" fill="#D97757" />
          <g fill="#fff">
            <rect x="11.2" y="4.5" width="1.6" height="15" rx="0.8" />
            <rect x="11.2" y="4.5" width="1.6" height="15" rx="0.8" transform="rotate(60 12 12)" />
            <rect x="11.2" y="4.5" width="1.6" height="15" rx="0.8" transform="rotate(120 12 12)" />
          </g>
        </svg>
      );
    case 'slack':
      return (
        <svg {...p}>
          <path fill="#36C5F0" d="M9 3.5A1.75 1.75 0 1 0 9 7h1.75V5.25C10.75 4.28 9.97 3.5 9 3.5z" />
          <path fill="#2EB67D" d="M20.5 9a1.75 1.75 0 1 0-3.5 0v1.75h1.75C19.72 10.75 20.5 9.97 20.5 9z" />
          <path fill="#ECB22E" d="M15 20.5a1.75 1.75 0 1 0 0-3.5h-1.75v1.75c0 .97.78 1.75 1.75 1.75z" />
          <path fill="#E01E5A" d="M3.5 15a1.75 1.75 0 1 0 3.5 0v-1.75H5.25C4.28 13.25 3.5 14.03 3.5 15z" />
          <path fill="#36C5F0" d="M13.25 9A1.75 1.75 0 0 0 11.5 7.25h-.25V9c0 .97.78 1.75 1.75 1.75S14.75 9.97 14.75 9z" opacity="0" />
          <rect x="8" y="8" width="8" height="8" rx="1.75" fill="#611f69" opacity="0.15" />
        </svg>
      );
    case 'webhook':
    default:
      return (
        <svg {...p} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 1 1 8 12.7" />
          <path d="M12 6a4 4 0 1 1 5.66 5.66l-2.83 2.83" />
          <path d="M6.05 9.95 9 12.9" />
        </svg>
      );
  }
}
