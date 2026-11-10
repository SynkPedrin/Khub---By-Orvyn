import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-5 py-24 text-center">
      <div className="text-4xl">✦</div>
      <h1 className="mt-3 text-xl font-extrabold">Documento não encontrado no cérebro</h1>
      <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
        Esse trecho do cérebro ainda não existe, ou o link aponta para uma nota que a NICO criará depois.
      </p>
      <Link
        href="/"
        className="mt-5 rounded-xl px-4 py-2 text-sm font-semibold text-white"
        style={{ background: 'var(--brand)' }}
      >
        Voltar ao início
      </Link>
    </div>
  );
}
