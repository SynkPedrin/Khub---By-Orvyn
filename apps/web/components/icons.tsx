import type { SVGProps } from 'react';

type IconName =
  | 'dashboard' | 'pipeline' | 'contacts' | 'inbox' | 'calendar' | 'marketing'
  | 'finance' | 'knowledge' | 'settings' | 'sparkles' | 'search' | 'bell'
  | 'logout' | 'plus' | 'check' | 'chevronDown' | 'chevronRight' | 'dots'
  | 'arrowUp' | 'arrowDown' | 'mail' | 'lock' | 'user' | 'google' | 'github'
  | 'menu' | 'close' | 'phone' | 'trend' | 'filter' | 'sun' | 'moon'
  // KHUB
  | 'home' | 'leads' | 'chat' | 'zap' | 'send' | 'chart' | 'ai'
  | 'flame' | 'clock' | 'dollar' | 'target' | 'briefcase' | 'link'
  | 'mapPin' | 'edit' | 'trash' | 'external' | 'download' | 'upload'
  | 'play' | 'pause' | 'arrowRight' | 'arrowLeft' | 'grid' | 'list'
  | 'star' | 'alert' | 'info' | 'paperclip' | 'video' | 'refresh'
  | 'eye' | 'eyeOff' | 'tag' | 'file' | 'note' | 'funnel' | 'users' | 'building'
  | 'globe' | 'linkedin' | 'whatsapp' | 'instagram' | 'check2' | 'minus'
  | 'expand' | 'command' | 'crown' | 'trophy' | 'shield' | 'bolt'
  // Editor de automações (Q3.3)
  | 'undo' | 'redo' | 'copy' | 'layout' | 'history' | 'folder'
  // Seletor de subcontas
  | 'chevronsUpDown' | 'pin';

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
  // ---------------- KHUB ----------------
  home: <><path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z" {...P} /><path d="M9.5 20.5v-6h5v6" {...P} /></>,
  leads: <><circle cx="9" cy="8" r="3.2" {...P} /><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" {...P} /><path d="M16 6.2a3 3 0 0 1 0 5.6M18 19.5a5.3 5.3 0 0 0-2.3-4.3" {...P} /></>,
  chat: <><path d="M20.5 11.6c0 4-3.8 7.2-8.5 7.2a9.7 9.7 0 0 1-2.8-.4L4 20.5l1.4-3.7a6.8 6.8 0 0 1-2-4.7 7.6 7.6 0 0 1 2.4-5.4A9.2 9.2 0 0 1 12 4.4c4.7 0 8.5 3.2 8.5 7.2Z" {...P} /></>,
  zap: <path d="M13.5 3 5 13.5h6L10.5 21 19 10.5h-6z" {...P} />,
  send: <><path d="M21 3 10.5 13.5" {...P} /><path d="M21 3l-6.8 18-3.7-7.5L3 9.8z" {...P} /></>,
  chart: <><path d="M5 20V12M10 20V6M15 20v-5M20 20V9" {...P} /></>,
  ai: <><path d="M12 3.2l1.6 4.1 4.2 1.6-4.2 1.6L12 14.6l-1.6-4.1L6.2 8.9l4.2-1.6z" {...P} /><path d="M18.2 14.6l.75 1.9 1.9.75-1.9.75-.75 1.9-.75-1.9-1.9-.75 1.9-.75z" {...P} /><path d="M5.6 15.2l.55 1.4 1.4.55-1.4.55-.55 1.4-.55-1.4-1.4-.55 1.4-.55z" {...P} /></>,
  flame: <><path d="M12 21a6 6 0 0 0 6-6c0-4-3-5.5-3.5-9-2 1.5-3 3.5-3 5.5-1-.5-1.5-1.5-1.5-2.5C8 11 6 12.5 6 15a6 6 0 0 0 6 6Z" {...P} /></>,
  clock: <><circle cx="12" cy="12" r="8.2" {...P} /><path d="M12 7.3V12l3.2 2" {...P} /></>,
  dollar: <><path d="M12 3.5v17" {...P} /><path d="M16.2 7.3H10a2.85 2.85 0 0 0 0 5.7h4a2.85 2.85 0 0 1 0 5.7H7.4" {...P} /></>,
  target: <><circle cx="12" cy="12" r="8.2" {...P} /><circle cx="12" cy="12" r="4.6" {...P} /><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" /></>,
  briefcase: <><rect x="3" y="7.2" width="18" height="12.5" rx="2" {...P} /><path d="M8.8 7.2V5.6a1.6 1.6 0 0 1 1.6-1.6h3.2a1.6 1.6 0 0 1 1.6 1.6v1.6" {...P} /><path d="M3 12.3h18" {...P} /></>,
  link: <><path d="M10.2 13.8a3.6 3.6 0 0 0 5.4.4l2.7-2.7a3.6 3.6 0 0 0-5.1-5.1l-1.5 1.5" {...P} /><path d="M13.8 10.2a3.6 3.6 0 0 0-5.4-.4l-2.7 2.7a3.6 3.6 0 0 0 5.1 5.1l1.5-1.5" {...P} /></>,
  mapPin: <><path d="M19 10.3c0 5-7 11-7 11s-7-6-7-11a7 7 0 0 1 14 0Z" {...P} /><circle cx="12" cy="10.2" r="2.6" {...P} /></>,
  edit: <><path d="M4 20h4L19.2 8.8a2.4 2.4 0 0 0-3.4-3.4L4.6 16.6z" {...P} /><path d="M14.8 6.6l3.4 3.4" {...P} /></>,
  trash: <><path d="M4.5 6.8h15M9.5 6.8V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v1.8" {...P} /><path d="M6.4 6.8 7.2 19a1.6 1.6 0 0 0 1.6 1.5h6.4a1.6 1.6 0 0 0 1.6-1.5l.8-12.2" {...P} /></>,
  external: <><path d="M14 4.5h5.5V10" {...P} /><path d="M19.5 4.5 11 13" {...P} /><path d="M17.4 13.8v5a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7V8.3a1.7 1.7 0 0 1 1.7-1.7h5" {...P} /></>,
  download: <><path d="M12 3.8v11M7.6 10.4 12 14.8l4.4-4.4" {...P} /><path d="M4.5 17.5v1.2a1.8 1.8 0 0 0 1.8 1.8h11.4a1.8 1.8 0 0 0 1.8-1.8v-1.2" {...P} /></>,
  upload: <><path d="M12 20.2v-11M7.6 13.6 12 9.2l4.4 4.4" {...P} /><path d="M4.5 6.5V5.3a1.8 1.8 0 0 1 1.8-1.8h11.4a1.8 1.8 0 0 1 1.8 1.8v1.2" {...P} /></>,
  play: <path d="M7.5 5.3 18.6 12 7.5 18.7z" {...P} />,
  pause: <><rect x="7" y="5" width="3.6" height="14" rx="1.2" {...P} /><rect x="13.4" y="5" width="3.6" height="14" rx="1.2" {...P} /></>,
  arrowRight: <path d="M4.5 12h15M13.5 6l6 6-6 6" {...P} />,
  arrowLeft: <path d="M19.5 12h-15M10.5 6l-6 6 6 6" {...P} />,
  grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.6" {...P} /><rect x="13.5" y="3.5" width="7" height="7" rx="1.6" {...P} /><rect x="3.5" y="13.5" width="7" height="7" rx="1.6" {...P} /><rect x="13.5" y="13.5" width="7" height="7" rx="1.6" {...P} /></>,
  list: <><path d="M8.5 6.5h12M8.5 12h12M8.5 17.5h12" {...P} /><circle cx="4.5" cy="6.5" r="1.2" fill="currentColor" stroke="none" /><circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="4.5" cy="17.5" r="1.2" fill="currentColor" stroke="none" /></>,
  star: <path d="m12 3.8 2.6 5.3 5.8.85-4.2 4.1 1 5.8-5.2-2.75L6.8 19.85l1-5.8-4.2-4.1 5.8-.85z" {...P} />,
  alert: <><path d="M10.3 4.3 2.6 17.5a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z" {...P} /><path d="M12 9.5v4M12 17.2h.01" {...P} /></>,
  info: <><circle cx="12" cy="12" r="8.2" {...P} /><path d="M12 11v5M12 8h.01" {...P} /></>,
  paperclip: <path d="M20 11.5 12.3 19.2a4.8 4.8 0 0 1-6.8-6.8l7.7-7.7a3.2 3.2 0 0 1 4.5 4.5l-7.7 7.7a1.6 1.6 0 0 1-2.3-2.3l7.1-7.1" {...P} />,
  video: <><rect x="2.8" y="6.2" width="12.8" height="11.6" rx="2.2" {...P} /><path d="m15.6 13 5.6 3.4V7.6L15.6 11z" {...P} /></>,
  refresh: <><path d="M20.5 12a8.5 8.5 0 0 1-14.6 6" {...P} /><path d="M3.5 12a8.5 8.5 0 0 1 14.6-6" {...P} /><path d="M18.1 2.8V6h-3.2M5.9 21.2V18h3.2" {...P} /></>,
  eye: <><path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" {...P} /><circle cx="12" cy="12" r="2.9" {...P} /></>,
  eyeOff: <><path d="M3.5 3.5l17 17" {...P} /><path d="M10.6 6.1A10.4 10.4 0 0 1 12 5.8c6 0 9.5 6.2 9.5 6.2a13.6 13.6 0 0 1-3.1 3.8M6.9 7.9C4.6 9.3 2.5 12 2.5 12s3.5 6.2 9.5 6.2a9.6 9.6 0 0 0 3.6-.7" {...P} /><path d="M9.9 10a2.9 2.9 0 0 0 4.1 4.1" {...P} /></>,
  tag: <><path d="M3.5 11.4V4.8a1.3 1.3 0 0 1 1.3-1.3h6.6a1.3 1.3 0 0 1 .92.38l8 8a1.3 1.3 0 0 1 0 1.84l-6.6 6.6a1.3 1.3 0 0 1-1.84 0l-8-8a1.3 1.3 0 0 1-.38-.92Z" {...P} /><circle cx="7.6" cy="7.6" r="1.3" fill="currentColor" stroke="none" /></>,
  file: <><path d="M13.5 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9z" {...P} /><path d="M13.5 3.5V9H19" {...P} /></>,
  note: <><rect x="4" y="3.5" width="16" height="17" rx="2" {...P} /><path d="M8 8.5h8M8 12h8M8 15.5h5" {...P} /></>,
  funnel: <path d="M3.5 5h17l-6.5 7.6v6.3l-4 2v-8.3z" {...P} />,
  users: <><circle cx="9" cy="8" r="3.2" {...P} /><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" {...P} /><path d="M16 6.2a3 3 0 0 1 0 5.6M18 19.5a5.3 5.3 0 0 0-2.3-4.3" {...P} /></>,
  building: <><rect x="4.5" y="3.5" width="15" height="17" rx="1.8" {...P} /><path d="M9 8h2M13 8h2M9 12h2M13 12h2M10.5 20.5v-4h3v4" {...P} /></>,
  globe: <><circle cx="12" cy="12" r="8.4" {...P} /><path d="M3.6 12h16.8" {...P} /><path d="M12 3.6a13 13 0 0 1 0 16.8 13 13 0 0 1 0-16.8Z" {...P} /></>,
  linkedin: <path d="M4.5 3.5h15a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1Zm2.6 6.4v7.7h2.4V9.9zm1.2-1.2a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8Zm3.1 1.2v7.7h2.4v-4.3c0-1.1.7-1.5 1.3-1.5s1.2.5 1.2 1.5v4.3h2.4v-4.7c0-2.2-1.2-3.2-2.8-3.2-1.1 0-1.8.5-2.1 1.1V9.9z" fill="currentColor" stroke="none" />,
  whatsapp: <><path d="M3.6 20.4 5 16.5a7.8 7.8 0 1 1 3 3z" {...P} /><path d="M9.2 9c.5 1.4 1.3 2.4 2.4 3.3.5.4 1 .7 1.6.9l.9-1.1 2 .8v1.5c0 .5-.4.9-.9.9a8 8 0 0 1-7.5-7.5c0-.5.4-.9.9-.9h1.5z" {...P} /></>,
  instagram: <><rect x="3.5" y="3.5" width="17" height="17" rx="4.6" {...P} /><circle cx="12" cy="12" r="3.9" {...P} /><circle cx="16.8" cy="7.2" r="1.05" fill="currentColor" stroke="none" /></>,
  check2: <><circle cx="12" cy="12" r="8.4" {...P} /><path d="m8.4 12.2 2.6 2.6 4.6-5" {...P} /></>,
  minus: <path d="M5 12h14" {...P} />,
  expand: <path d="M8.5 3.5h-5v5M15.5 3.5h5v5M15.5 20.5h5v-5M8.5 20.5h-5v-5" {...P} />,
  command: <path d="M7.5 3.5a3 3 0 1 0 3 3v11a3 3 0 1 0 3-3h-11a3 3 0 1 0 3 3v-11a3 3 0 1 0-3 3h11" {...P} />,
  crown: <><path d="M3.5 7.8 7 12l5-7 5 7 3.5-4.2v9.4a1.6 1.6 0 0 1-1.6 1.6H5.1a1.6 1.6 0 0 1-1.6-1.6z" {...P} /></>,
  trophy: <><path d="M8 4h8v5.5a4 4 0 0 1-8 0z" {...P} /><path d="M8 5.5H5.2v1.8A3 3 0 0 0 8 10.2M16 5.5h2.8v1.8a3 3 0 0 1-2.8 2.9" {...P} /><path d="M12 13.5v3.2M8.8 20.3h6.4" {...P} /><path d="M9.6 16.7h4.8l.8 3.6H8.8z" {...P} /></>,
  shield: <><path d="M12 3.2 5 6v5.6c0 4.2 2.9 7.8 7 9.2 4.1-1.4 7-5 7-9.2V6z" {...P} /><path d="m9.2 12 2 2 3.6-3.8" {...P} /></>,
  bolt: <path d="M13.5 3 5 13.5h6L10.5 21 19 10.5h-6z" {...P} />,
  undo: <><path d="M8.5 5 4 9.5 8.5 14" {...P} /><path d="M4 9.5h10a6 6 0 0 1 0 12h-3" {...P} /></>,
  redo: <><path d="M15.5 5 20 9.5 15.5 14" {...P} /><path d="M20 9.5H10a6 6 0 0 0 0 12h3" {...P} /></>,
  copy: <><rect x="8.5" y="8.5" width="12" height="12" rx="2" {...P} /><path d="M15.5 8.5V5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3" {...P} /></>,
  layout: <><rect x="8.5" y="3" width="7" height="5" rx="1.4" {...P} /><rect x="3" y="16" width="7" height="5" rx="1.4" {...P} /><rect x="14" y="16" width="7" height="5" rx="1.4" {...P} /><path d="M12 8v4M6.5 16v-2a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v2" {...P} /></>,
  history: <><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" {...P} /><path d="M3.5 4v4h4" {...P} /><path d="M12 7.5V12l3 2" {...P} /></>,
  folder: <path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" {...P} />,
  // Seletor de subcontas (estilo GHL): abre/fecha e fixar.
  chevronsUpDown: <path d="m7.5 9.5 4.5-4.5 4.5 4.5M7.5 14.5l4.5 4.5 4.5-4.5" {...P} />,
  pin: <><path d="M9 3.8h6M10 3.8v5.4L7 13v1.6h10V13l-3-3.8V3.8" {...P} /><path d="M12 14.6V20.5" {...P} /></>,
};

export function Icon({ name, size = 20, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden {...rest}>
      {PATHS[name]}
    </svg>
  );
}

export type { IconName };
