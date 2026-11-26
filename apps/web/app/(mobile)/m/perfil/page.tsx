'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { Avatar } from '@/components/ui';
import { Aviso, BotaoGrande, Cabecalho } from '@/components/mobile/ui';
import { useAuth } from '@/lib/auth';
import { ativarPush, desativarPush, ehAppInstalado, estadoPush, testarPush, type EstadoPush } from '@/lib/push';

const TEXTO_ESTADO: Record<EstadoPush, string> = {
  ativado: 'Ativadas neste celular',
  desativado: 'Desativadas',
  bloqueado: 'Bloqueadas nas configurações do celular',
  'sem-suporte': 'Este navegador não recebe notificações',
  'instalar-primeiro': 'Instale o app para receber avisos',
  'servidor-desligado': 'Indisponíveis no momento',
};

export default function PerfilMobile() {
  const { user, signOut } = useAuth();
  const [estado, setEstado] = useState<EstadoPush | null>(null);
  const [instalado, setInstalado] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ t: string; tom: 'ok' | 'erro' } | null>(null);

  useEffect(() => {
    estadoPush().then(setEstado).catch(() => setEstado('sem-suporte'));
    setInstalado(ehAppInstalado());
  }, []);

  const alternar = async () => {
    setOcupado(true); setMsg(null);
    try {
      if (estado === 'ativado') { await desativarPush(); setEstado('desativado'); }
      else setEstado(await ativarPush());
    } catch {
      setMsg({ t: 'Não foi possível mudar agora. Tente de novo.', tom: 'erro' });
    } finally {
      setOcupado(false);
    }
  };

  const testar = async () => {
    setOcupado(true); setMsg(null);
    try {
      const r = await testarPush();
      setMsg(r.enviados > 0 ? { t: 'Aviso de teste enviado. Ele chega em alguns segundos.', tom: 'ok' } : { t: 'Nenhum aparelho ativo. Ative as notificações primeiro.', tom: 'erro' });
    } catch {
      setMsg({ t: 'Não foi possível enviar o teste.', tom: 'erro' });
    } finally {
      setOcupado(false);
    }
  };

  const sair = async () => {
    await desativarPush().catch(() => undefined);
    await signOut();
    window.location.replace('/login?next=/m');
  };

  return (
    <div>
      <Cabecalho titulo="Perfil" />

      <section className="mb-5 flex items-center gap-4 rounded-3xl bg-surface p-5">
        <Avatar name={user?.name ?? '?'} size={56} />
        <div className="min-w-0">
          <p className="truncate text-lg font-bold">{user?.name ?? '—'}</p>
          <p className="truncate text-sm text-muted">{user?.email}</p>
          {user?.empresa && <p className="truncate text-xs text-faint">{user.empresa}</p>}
        </div>
      </section>

      <section className="mb-5 rounded-3xl bg-surface p-5">
        <div className="mb-3 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-soft text-brand"><Icon name="bell" size={20} /></span>
          <div className="min-w-0 flex-1">
            <p className="font-bold">Notificações</p>
            <p className="text-xs text-muted">{estado ? TEXTO_ESTADO[estado] : 'Verificando…'}</p>
          </div>
          {(estado === 'ativado' || estado === 'desativado') && (
            <button
              type="button"
              role="switch"
              aria-checked={estado === 'ativado'}
              aria-label="Notificações neste celular"
              disabled={ocupado}
              onClick={alternar}
              className={`relative h-8 w-14 shrink-0 rounded-full transition ${estado === 'ativado' ? 'bg-brand' : 'bg-surface3'}`}
            >
              <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${estado === 'ativado' ? 'left-7' : 'left-1'}`} />
            </button>
          )}
        </div>
        <p className="mb-3 text-sm text-muted">Você recebe um aviso no celular sempre que uma arte ou roteiro chegar para aprovar.</p>
        {estado === 'instalar-primeiro' && <Link href="/baixar" className="block"><BotaoGrande>Instalar o app</BotaoGrande></Link>}
        {estado === 'bloqueado' && <p className="text-sm text-warning">Libere em Ajustes → Notificações → KHUB e volte aqui.</p>}
        {estado === 'ativado' && <BotaoGrande tom="neutro" disabled={ocupado} onClick={testar}>Enviar aviso de teste</BotaoGrande>}
        {msg && <div className="mt-3"><Aviso texto={msg.t} tom={msg.tom} /></div>}
      </section>

      <section className="mb-5 divide-y divide-line overflow-hidden rounded-3xl bg-surface">
        {!instalado && (
          <Link href="/baixar" className="flex items-center gap-3 p-4 active:bg-surface2">
            <Icon name="download" size={20} className="text-brand" />
            <span className="flex-1 text-[15px] font-semibold">Instalar o app no celular</span>
            <Icon name="chevronRight" size={18} className="text-faint" />
          </Link>
        )}
        <Link href="/dashboard" className="flex items-center gap-3 p-4 active:bg-surface2">
          <Icon name="grid" size={20} className="text-muted" />
          <span className="flex-1 text-[15px] font-semibold">Abrir o KHUB completo</span>
          <Icon name="chevronRight" size={18} className="text-faint" />
        </Link>
        <button type="button" onClick={sair} className="flex w-full items-center gap-3 p-4 text-left active:bg-surface2">
          <Icon name="logout" size={20} className="text-danger" />
          <span className="flex-1 text-[15px] font-semibold text-danger">Sair</span>
        </button>
      </section>

      <p className="text-center text-[11px] text-faint">KHUB · app do cliente</p>
    </div>
  );
}
