import Image from 'next/image';
import Link from 'next/link';

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5 group">
      <Image
        src="/khub-mark.png"
        alt="KHUB"
        width={72}
        height={72}
        unoptimized
        priority
        className="object-contain transition-transform group-hover:scale-105"
      />
      {!compact && (
        <span className="text-lg font-extrabold tracking-tight" style={{ color: 'var(--text)' }}>
          KHUB
        </span>
      )}
    </Link>
  );
}
