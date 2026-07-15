import Image from 'next/image';
import Link from 'next/link';

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5 group">
      <Image
        src="/logo.png"
        alt="ORVYN OS"
        width={36}
        height={36}
        priority
        className="rounded-lg transition-transform group-hover:scale-105"
      />
      {!compact && (
        <span className="text-lg font-extrabold tracking-tight" style={{ color: 'var(--text)' }}>
          ORVYN <span className="text-brand">OS</span>
        </span>
      )}
    </Link>
  );
}
