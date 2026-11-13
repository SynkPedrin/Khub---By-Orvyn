import fs from 'node:fs';
import path from 'node:path';

/**
 * Backend do KHUB (MVP): o cérebro Obsidian (vault de markdown) é a fonte de
 * dados. Este módulo lê o vault do filesystem. É consumido tanto pelas Route
 * Handlers (/api/cerebro/*) — a "API do backend" — quanto pelos Server
 * Components da UI. Ver ADR-0005 em Nyro IA/cerebro/Arquitetura.md.
 */

export interface DocMeta {
  slug: string; // caminho relativo sem .md, ex.: "PRD" ou "RAG/RAG"
  segments: string[];
  title: string;
  category: string; // primeira pasta ("Raiz" quando na raiz do cérebro)
  excerpt: string;
  words: number;
  updatedAt: string; // ISO
}

export interface Doc extends DocMeta {
  markdown: string;
}

/** Resolve o diretório do cérebro tentando alguns caminhos candidatos. */
export function resolveCerebroDir(): string {
  const candidates = [
    process.env.CEREBRO_DIR,
    path.resolve(process.cwd(), '../../Nyro IA/cerebro'),
    path.resolve(process.cwd(), 'Nyro IA/cerebro'),
    path.resolve(process.cwd(), '../Nyro IA/cerebro'),
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return c;
    } catch {
      /* tenta o próximo */
    }
  }
  // Último recurso: retorna o candidato padrão (erros de leitura viram 404/500 controlados).
  return candidates[1] ?? path.resolve(process.cwd(), 'cerebro');
}

const CEREBRO_DIR = resolveCerebroDir();

/**
 * Escopo de visibilidade (BUG-030). O vault tem duas naturezas:
 *  - `RAG/conhecimento/**` é a base de conhecimento de produto (Biblioteca,
 *    frameworks de marketing e operação) e pode ser lida por qualquer usuário
 *    logado de qualquer cliente;
 *  - todo o resto (PRD, Bugs, Arquitetura, revisões de segurança, Sprint) é
 *    documentação INTERNA de engenharia e nunca pode chegar a um cliente.
 * O interno só aparece em desenvolvimento local ou com `KHUB_VAULT_INTERNO=1`.
 */
export const PREFIXO_PUBLICO = 'RAG/conhecimento/';

export function vaultInternoLiberado(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.KHUB_VAULT_INTERNO === '1') return true;
  if (env.KHUB_VAULT_INTERNO === '0') return false;
  return env.NODE_ENV === 'development';
}

export function slugVisivel(slug: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return slug.startsWith(PREFIXO_PUBLICO) || vaultInternoLiberado(env);
}

function stripFrontmatter(raw: string): string {
  if (raw.startsWith('---')) {
    const end = raw.indexOf('\n---', 3);
    if (end !== -1) {
      const after = raw.indexOf('\n', end + 1);
      return after !== -1 ? raw.slice(after + 1) : '';
    }
  }
  return raw;
}

function deriveTitle(markdown: string, fallback: string): string {
  for (const line of markdown.split('\n')) {
    const m = line.match(/^#\s+(.+?)\s*$/);
    if (m) return m[1].replace(/[*_`]/g, '').trim();
  }
  return fallback;
}

function deriveExcerpt(markdown: string): string {
  const lines = markdown.split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('#') || t.startsWith('>') || t.startsWith('|') || t.startsWith('```')) continue;
    const clean = t.replace(/[[\]*_`>#-]/g, '').trim();
    if (clean.length > 24) return clean.length > 180 ? clean.slice(0, 177) + '…' : clean;
  }
  return 'Documento do cérebro.';
}

/** Impede path traversal: valida segmentos e confina o caminho ao cérebro. */
export function safeJoin(segments: string[]): string | null {
  if (!segments.length) return null;
  if (segments.some((s) => !s || s === '.' || s === '..' || s.includes('/') || s.includes('\\') || s.includes('\0'))) {
    return null;
  }
  const target = path.resolve(CEREBRO_DIR, segments.join(path.sep) + '.md');
  const root = path.resolve(CEREBRO_DIR);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

function walk(dir: string, base: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(full, base, out);
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
      out.push(path.relative(base, full));
    }
  }
}

function toMeta(relPath: string): DocMeta {
  const full = path.join(CEREBRO_DIR, relPath);
  const raw = fs.readFileSync(full, 'utf8');
  const markdown = stripFrontmatter(raw);
  const segments = relPath.replace(/\.md$/i, '').split(path.sep);
  const slug = segments.join('/');
  const fallback = segments[segments.length - 1];
  const category = segments.length > 1 ? segments[0] : 'Raiz';
  let updatedAt = new Date(0).toISOString();
  try {
    updatedAt = fs.statSync(full).mtime.toISOString();
  } catch {
    /* mantém epoch */
  }
  return {
    slug,
    segments,
    title: deriveTitle(markdown, fallback),
    category,
    excerpt: deriveExcerpt(markdown),
    words: markdown.split(/\s+/).filter(Boolean).length,
    updatedAt,
  };
}

/** Lista todos os documentos do cérebro (metadados). É o "índice" do backend. */
export function listDocs(): DocMeta[] {
  const rels: string[] = [];
  walk(CEREBRO_DIR, CEREBRO_DIR, rels);
  return rels
    .filter((rel) => slugVisivel(rel.replace(/\.md$/i, '').split(path.sep).join('/')))
    .map(toMeta)
    .sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
}

/** Lê um documento pelo slug (segmentos). Retorna null se não existir / inválido. */
export function getDoc(segments: string[]): Doc | null {
  const target = safeJoin(segments);
  if (!target || !fs.existsSync(target)) return null;
  if (!slugVisivel(segments.join('/'))) return null;
  const relPath = path.relative(CEREBRO_DIR, target);
  const raw = fs.readFileSync(target, 'utf8');
  return { ...toMeta(relPath), markdown: stripFrontmatter(raw) };
}

export function cerebroInfo() {
  return { dir: CEREBRO_DIR, exists: fs.existsSync(CEREBRO_DIR) };
}
