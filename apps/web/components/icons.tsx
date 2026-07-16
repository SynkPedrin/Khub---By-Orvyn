import type { SVGProps } from 'react';

type IconName =
  | 'dashboard' | 'pipeline' | 'contacts' | 'inbox' | 'calendar' | 'marketing'
  | 'finance' | 'knowledge' | 'settings' | 'sparkles' | 'search' | 'bell'
  | 'logout' | 'plus' | 'check' | 'chevronDown' | 'chevronRight' | 'dots'
  | 'arrowUp' | 'arrowDown' | 'mail' | 'lock' | 'user' | 'google' | 'github'
  | 'menu' | 'close' | 'phone' | 'trend' | 'filter' | 'sun' | 'moon';

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

const PATHS: Record<IconName, React.ReactNode> = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5" {...P} /><rect x="14" y="3" width="7" height="5" rx="1.5" {...P} /><rect x="14" y="12" width="7" height="9" rx="1.5" {...P} /><rect x="3" y="16" width="7" height="5" rx="1.5" {...P} /></>,
  pipeline: <><rect x="3" y="4" width="5" height="16" rx="1.5" {...P} /><rect x="9.5" y="4" width="5" height="11" rx="1.5" {...P} /><rect x="16" y="4" width="5" height="7" rx="1.5" {...P} /></>,
  contacts: <><circle cx="9" cy="8" r="3.2" {...P} /><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" {...P} /><path d="M16 6.2a3 3 0 0 1 0 5.6M18 19.5a5.3 5.3 0 0 0-2.3-4.3" {...P} /></>,
  inbox: <><path d="M4 5h16v11H8l-4 3z" {...P} /><path d="M8 9h8M8 12.5h5" {...P} /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15" rx="2" {...P} /><path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" {...P} /></>,
  marketing: <><path d="M4 9v4a1 1 0 0 0 1 1h3l6 4V4L8 8H5a1 1 0 0 0-1 1Z" {...P} /><path d="M18 8a4 4 0 0 1 0 6" {...P} /></>,
  finance: <><rect x="3" y="6" width="18" height="12" rx="2" {...P} /><circle cx="12" cy="12" r="2.4" {...P} /><path d="M6.5 9v6M17.5 9v6" {...P} /></>,
  knowledge: <><path d="M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" {...P} /><path d="M17 7h2v13H8" {...P} /><path d="M8 8h6M8 11h6" {...P} /></>,
  settings: <><circle cx="12" cy="12" r="3" {...P} /><path d="M19.4 13a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15Z" {...P} /></>,
  sun: <><circle cx="12" cy="12" r="4" {...P} /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" {...P} /></>,
  moon: <path d="M20.5 14.3A8.2 8.2 0 1 1 9.7 3.5a6.4 6.4 0 0 0 10.8 10.8Z" {...P} />,
  sparkles: <><path d="M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7z" {...P} /><path d="M18 14l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" {...P} /></>,
  search: <><circle cx="11" cy="11" r="6.5" {...P} /><path d="m20 20-3.5-3.5" {...P} /></>,
  bell: <><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" {...P} /><path d="M10 19a2 2 0 0 0 4 0" {...P} /></>,
  logout: <><path d="M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3" {...P} /><path d="M10 12h9M16 8l4 4-4 4" {...P} /></>,
  plus: <path d="M12 5v14M5 12h14" {...P} />,
  check: <path d="m5 12 5 5L20 7" {...P} />,
  chevronDown: <path d="m6 9 6 6 6-6" {...P} />,
  chevronRight: <path d="m9 6 6 6-6 6" {...P} />,
  dots: <><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" /></>,
  arrowUp: <path d="M12 19V5M6 11l6-6 6 6" {...P} />,
  arrowDown: <path d="M12 5v14M6 13l6 6 6-6" {...P} />,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" {...P} /><path d="m4 7 8 6 8-6" {...P} /></>,
  lock: <><rect x="5" y="10" width="14" height="10" rx="2" {...P} /><path d="M8 10V8a4 4 0 0 1 8 0v2" {...P} /></>,
  user: <><circle cx="12" cy="8.5" r="3.5" {...P} /><path d="M5 20a7 7 0 0 1 14 0" {...P} /></>,
  google: <><path d="M21.6 12.2c0-.6-.05-1.2-.15-1.7H12v3.4h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.2Z" fill="#4285F4" /><path d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 .95-3.4.95-2.6 0-4.8-1.75-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z" fill="#34A853" /><path d="M6.4 13.95a6 6 0 0 1 0-3.9V7.45H3.1a10 10 0 0 0 0 9.1z" fill="#FBBC05" /><path d="M12 5.95c1.5 0 2.8.5 3.8 1.5l2.85-2.85A10 10 0 0 0 3.1 7.45L6.4 10c.8-2.35 3-4.05 5.6-4.05Z" fill="#EA4335" /></>,
  github: <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.36 1.09 2.94.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" fill="currentColor" stroke="none" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" {...P} />,
  close: <path d="M6 6l12 12M18 6 6 18" {...P} />,
  phone: <path d="M6 3h3l1.5 5-2 1.5a11 11 0 0 0 5 5l1.5-2 5 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2Z" {...P} />,
  trend: <path d="M3 16l5-5 4 4 8-8M15 7h5v5" {...P} />,
  filter: <path d="M4 5h16l-6 7v6l-4-2v-4Z" {...P} />,
};

export function Icon({ name, size = 20, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...rest}>
      {PATHS[name]}
    </svg>
  );
}

export type { IconName };
