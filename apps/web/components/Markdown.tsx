import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Converte wikilinks do Obsidian [[Alvo]] / [[Alvo|rótulo]] em links do app. */
function transformWikilinks(md: string): string {
  return md.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, label?: string) => {
    const clean = target.trim();
    const text = (label ?? clean).trim();
    const href = '/conhecimento/' + clean.split('/').map(encodeURIComponent).join('/');
    return `[${text}](${href})`;
  });
}

export function Markdown({ children }: { children: string }) {
  const src = transformWikilinks(children);
  return (
    <div className="prose-khub">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{src}</ReactMarkdown>
    </div>
  );
}
