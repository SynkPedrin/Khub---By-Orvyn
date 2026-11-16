'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { agentesApi, type Agente } from '@/lib/agents';
import { mensagemDeErro } from '../kit';

type Bolha = { de: 'contato' | 'ia' | 'aviso'; texto: string };

/** Decisões do motor que não viram bolha de resposta (valores do simulador). */
const ROTULO_DECISAO: Record<string, string> = {
  transferir: 'Aqui a IA passaria a conversa para a equipe',
  silenciar: 'A IA decidiu não responder esta mensagem',
  recusa: 'O modelo recusou responder',
  sem_resposta: 'A IA não gerou resposta',
};

/**
 * "Testar" ao lado do prompt (estilo GHL): você escreve como cliente e vê a
 * resposta da IA, usando o MESMO motor do atendimento (simulador). Usa o
 * rascunho, então dá para testar antes de publicar. Nada vai para o WhatsApp.
 */
export function PainelTeste({ agente, className }: { agente: Agente; className?: string }) {
  const [sid, setSid] = useState<string | null>(null);
  const [bolhas, setBolhas] = useState<Bolha[]>([]);
  const [texto, setTexto] = useState('');
  const [pensando, setPensando] = useState(false);
  const fim = useRef<HTMLDivElement>(null);

  // Chaves: no Chrome novo `scrollIntoView` devolve uma Promise, e efeito que
  // retorna algo que não é função derruba a tela ("destroy is not a function").
  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [bolhas, pensando]);

  const recomecar = async () => {
    const atual = sid;
    setSid(null);
    setBolhas([]);
    if (atual) await agentesApi.removerSimulacao(atual).catch(() => undefined);
  };

  const enviar = async () => {
    const t = texto.trim();
    if (!t || pensando) return;
    setTexto('');
    setBolhas((b) => [...b, { de: 'contato', texto: t }]);
    setPensando(true);
    try {
      let id = sid;
      if (!id) {
        const s = await agentesApi.criarSimulacao(agente.id, { usarRascunho: true });
        id = s.id;
        setSid(s.id);
      }
      const r = await agentesApi.turno(id, [t]);
      const novas: Bolha[] = r.resposta.map((m) => ({ de: 'ia', texto: m.texto }));
      if (!r.iaConfigurada) novas.push({ de: 'aviso', texto: 'A IA não está conectada neste ambiente: no atendimento real a conversa iria para a equipe.' });
      else if (r.decisao !== 'responder' && ROTULO_DECISAO[r.decisao]) novas.push({ de: 'aviso', texto: ROTULO_DECISAO[r.decisao] });
      setBolhas((b) => [...b, ...novas]);
    } catch (e) {
      setBolhas((b) => [...b, { de: 'aviso', texto: mensagemDeErro(e) }]);
    } finally {
      setPensando(false);
    }
  };

  return (
    <section className={cx('card flex min-h-[520px] flex-col overflow-hidden p-0', className)} aria-label="Testar o agente">
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-fg">Testar</p>
          <p className="truncate text-xs text-muted">Escreva como cliente. Usa o rascunho; nada vai para o WhatsApp.</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void recomecar()} disabled={pensando || (!sid && !bolhas.length)}>
          <Icon name="refresh" size={14} /> Recomeçar
        </button>
      </header>

      <div className="chat-fundo scrollbar-thin min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {bolhas.length === 0 && (
          <p className="mx-auto mt-10 max-w-[240px] text-center text-xs text-muted">
            Mande uma mensagem como se fosse um cliente chegando no WhatsApp, por exemplo: &ldquo;Oi, quanto custa?&rdquo;
          </p>
        )}
        {bolhas.map((b, i) =>
          b.de === 'aviso' ? (
            <p key={i} className="mx-auto max-w-[90%] rounded-xl bg-warning-soft px-3 py-1.5 text-center text-xs text-warning">{b.texto}</p>
          ) : (
            <div key={i} className={cx('flex', b.de === 'contato' ? 'justify-end' : 'justify-start')}>
              <p className={cx('max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm', b.de === 'contato' ? 'rounded-br-md bg-brand text-white' : 'rounded-bl-md border border-line bg-surface text-fg')}>
                {b.texto}
              </p>
            </div>
          ),
        )}
        {pensando && (
          <p className="flex items-center gap-1.5 text-xs text-muted" role="status">
            <Icon name="sparkles" size={12} /> {agente.nome} está escrevendo…
          </p>
        )}
        <div ref={fim} />
      </div>

      <form
        className="flex items-end gap-2 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void enviar();
        }}
      >
        <textarea
          className="input min-h-[42px] flex-1 resize-none"
          rows={1}
          maxLength={2000}
          value={texto}
          placeholder="Mensagem do cliente"
          aria-label="Mensagem do cliente para testar"
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void enviar();
            }
          }}
        />
        <button type="submit" className="btn btn-primary btn-icon" disabled={!texto.trim() || pensando} aria-label="Enviar">
          <Icon name="send" size={16} />
        </button>
      </form>
      <Link href={`/agentes/${agente.id}?aba=simulador`} className="border-t border-line px-4 py-2 text-center text-xs font-medium text-brand hover:bg-brand-softer">
        Simulador completo (personas, cenários e diagnóstico)
      </Link>
    </section>
  );
}
