'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api-error';
import { nyro, type Aprovacao, type PassoNyro, type StatusNyro } from '@/lib/nyro';

export interface Bolha {
  papel: 'user' | 'assistant';
  texto: string;
  agente?: string | null;
  fontes?: { chunkId: string; titulo: string }[];
  guardrail?: string | null;
  aprovacoes?: Aprovacao[];
}

/**
 * Lógica do chat da Nyro — compartilhada entre o dock flutuante e a página cheia.
 * Mesma fonte da verdade: gating, passos reais, human-in-the-loop. Zero duplicação.
 */
export function useNyroChat(ativo = true) {
  const [status, setStatus] = useState<StatusNyro | null>(null);
  const [bolhas, setBolhas] = useState<Bolha[]>([]);
  const [passos, setPassos] = useState<PassoNyro[]>([]);
  const [texto, setTexto] = useState('');
  const [pensando, setPensando] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [erro, setErro] = useState('');

  useEffect(() => { if (ativo && !status) nyro.status().then(setStatus).catch(() => undefined); }, [ativo, status]);

  const enviar = useCallback(async (pergunta?: string) => {
    const t = (pergunta ?? texto).trim();
    if (!t || pensando) return;
    setErro('');
    setTexto('');
    setBolhas((b) => [...b, { papel: 'user', texto: t }]);
    setPensando(true);
    setPassos([]);
    try {
      const r = await nyro.chat(t, conversationId);
      setConversationId(r.conversationId);
      setPassos(r.passos.filter((p) => p.tipo !== 'texto'));
      setBolhas((b) => [...b, { papel: 'assistant', texto: r.texto, agente: r.agente, fontes: r.fontes, guardrail: r.guardrail, aprovacoes: r.aprovacoes }]);
    } catch (e) {
      const cr = e instanceof ApiError ? e.configRequired : null;
      if (cr) setStatus((s) => ({ configurada: false, missing: cr.missing, capacidades: s?.capacidades ?? [] }));
      else setErro('Não consegui falar com a NICO agora.');
    } finally {
      setPensando(false);
    }
  }, [texto, pensando, conversationId]);

  const decidir = useCallback(async (a: Aprovacao, aprovar: boolean) => {
    try {
      const r = await nyro.decidir(a.id, aprovar);
      setBolhas((b) => [
        ...b.map((x) => ({ ...x, aprovacoes: x.aprovacoes?.filter((y) => y.id !== a.id) })),
        { papel: 'assistant', texto: aprovar ? (r.ok ? `Feito: ${a.resumo}.` : `Não consegui: ${r.erro ?? 'falhou'}.`) : 'Ok, não fiz isso.' },
      ]);
    } catch {
      setErro('Não consegui registrar sua decisão.');
    }
  }, []);

  return { status, bolhas, passos, texto, setTexto, pensando, erro, enviar, decidir };
}
