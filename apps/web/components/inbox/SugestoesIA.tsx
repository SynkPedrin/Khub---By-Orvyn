'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { Skeleton } from '@/components/kit';
import { ConfigRequired } from '@/components/app/ConfigRequired';
import { ApiError } from '@/lib/api-error';
import { inbox, type SugestaoIA } from '@/lib/inbox';

/**
 * "Sugestões da IA" (mockup da LP), ligadas ao provedor de IA real: o
 * atendente pede, a IA lê a conversa e propõe 3 respostas; clicar põe o texto
 * no campo para revisar. Nada é enviado sozinho. Sem credencial de IA, mostra
 * o que configurar (config_required), nunca texto fixo. Pedido sob demanda:
 * abrir conversa não gasta IA.
 */
export function SugestoesIA({ conversationId, onEscolher }: { conversationId: string; onEscolher: (texto: string) => void }) {
  const [estado, setEstado] = useState<'parado' | 'carregando' | 'ok' | 'erro'>('parado');
  const [sugestoes, setSugestoes] = useState<SugestaoIA[]>([]);
  const [gate, setGate] = useState<{ provider: string; missing: string[] } | null>(null);
  const [erro, setErro] = useState('');
  const [aberto, setAberto] = useState(true);

  useEffect(() => {
    setEstado('parado');
    setSugestoes([]);
    setGate(null);
    setErro('');
  }, [conversationId]);

  const pedir = async () => {
    setEstado('carregando');
    setGate(null);
    setErro('');
    try {
      const r = await inbox.sugestoes(conversationId);
      setSugestoes(r.sugestoes);
      setEstado('ok');
    } catch (e) {
      const cr = e instanceof ApiError ? e.configRequired : null;
      if (cr) setGate(cr);
      else setErro(e instanceof ApiError && e.message ? e.message : 'Não consegui gerar sugestões agora.');
      setEstado('erro');
    }
  };

  return (
    <section className="border-t border-line px-4 py-2.5 lg:px-5" aria-label="Sugestões da IA">
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="flex items-center gap-1.5 text-[12.5px] font-semibold text-fg" aria-expanded={aberto} onClick={() => setAberto((v) => !v)}>
          <Icon name="sparkles" size={14} className="text-[var(--violet)]" />
          Sugestões da IA
          <Icon name="chevronDown" size={13} className={aberto ? 'rotate-180 transition-transform' : 'transition-transform'} />
        </button>
        {aberto && (
          <button type="button" className="flex items-center gap-1 text-[12px] font-medium text-[var(--violet)] hover:underline disabled:opacity-50" onClick={() => void pedir()} disabled={estado === 'carregando'}>
            <Icon name={estado === 'ok' ? 'refresh' : 'ai'} size={12} /> {estado === 'ok' ? 'Gerar outras' : 'Sugerir respostas'}
          </button>
        )}
      </div>
      {aberto && (
        <div className="mt-2">
          {estado === 'carregando' && (
            <div className="grid gap-2 sm:grid-cols-3" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          )}
          {estado === 'ok' && (
            <ul className="grid gap-2 sm:grid-cols-3">
              {sugestoes.map((s, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => onEscolher(s.texto)}
                    className="h-full w-full rounded-xl border border-[var(--violet-border)] bg-[var(--violet-soft)] p-2.5 text-left transition-colors hover:border-[var(--violet)]"
                    title="Usar como rascunho (você revisa antes de enviar)"
                  >
                    <span className="block text-[12.5px] font-semibold text-fg">{s.titulo}</span>
                    <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-muted">{s.texto}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {gate && <ConfigRequired provider={gate.provider} missing={gate.missing} compact />}
          {erro && <p className="text-[12.5px] text-warning">{erro}</p>}
          {estado === 'parado' && <p className="text-[12px] text-muted">A IA lê a conversa e propõe respostas. Você escolhe, revisa e envia.</p>}
        </div>
      )}
    </section>
  );
}
