import Link from 'next/link';
import { Icon, type IconName } from '../icons';

export function ComingSoon({ icon, title, desc, fase, nyroPergunta }: { icon: IconName; title: string; desc: string; fase: string; nyroPergunta?: string }) {
  const q = nyroPergunta ?? `Me explique como o ${title} vai funcionar no KHUB e o que já dá para preparar na minha empresa.`;
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-20 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-brand/12 text-brand"><Icon name={icon} size={30} /></span>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight text-fg">{title}</h1>
      <p className="mt-2 text-sm text-muted">{desc}</p>
      <span className="mt-4 rounded-full bg-surface3 px-3 py-1 text-xs font-semibold text-muted">Chega na {fase}</span>
      <Link href={`/nyro?q=${encodeURIComponent(q)}`} className="btn btn-primary mt-6"><Icon name="sparkles" size={16} /> Pedir para a NICO montar</Link>
    </div>
  );
}
