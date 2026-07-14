import { Icon, type IconName } from '../icons';

export function ComingSoon({ icon, title, desc, fase }: { icon: IconName; title: string; desc: string; fase: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-20 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-brand/12 text-brand"><Icon name={icon} size={30} /></span>
      <h1 className="mt-5 text-2xl font-extrabold tracking-tight text-fg">{title}</h1>
      <p className="mt-2 text-sm text-muted">{desc}</p>
      <span className="mt-4 rounded-full bg-surface3 px-3 py-1 text-xs font-semibold text-muted">Chega na {fase}</span>
      <button className="btn btn-primary mt-6"><Icon name="sparkles" size={16} /> Pedir para a Nyro montar</button>
    </div>
  );
}
