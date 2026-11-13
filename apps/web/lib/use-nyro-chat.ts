'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api-error';
import { ANEXO_EXTENSOES, ANEXO_MAX_BYTES, ANEXO_MAX_QTD, nyro, type AnexoEnvio, type Aprovacao, type PassoNyro, type StatusNyro } from '@/lib/nyro';

const PEDIDO_PADRAO_ANEXO = 'Leia o arquivo anexado, me diga o que achou e o que eu faço com isso.';

function lerBase64(f: File): Promise<string> {
  return new Promise((ok, falha) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1] ?? '');
    r.onerror = () => falha(new Error('leitura falhou'));
    r.readAsDataURL(f);
  });
}

export interface Bolha {
  papel: 'user' | 'assistant';
  texto: string;
  agente?: string | null;
  fontes?: { chunkId: string; titulo: string }[];
  guardrail?: string | null;
  aprovacoes?: Aprovacao[];
  /** Nomes dos arquivos que o usuário mandou nesta mensagem. */
  anexos?: string[];
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
  const [anexos, setAnexos] = useState<AnexoEnvio[]>([]);

  useEffect(() => { if (ativo && !status) nyro.status().then(setStatus).catch(() => undefined); }, [ativo, status]);

  const anexar = useCallback(async (arquivos: FileList | File[]) => {
    setErro('');
    const novos: AnexoEnvio[] = [];
    for (const f of Array.from(arquivos)) {
      const ext = (f.name.split('.').pop() ?? '').toLowerCase();
      if (!ANEXO_EXTENSOES.includes(ext)) { setErro(`"${f.name}": formato não suportado. Aceito: ${ANEXO_EXTENSOES.join(', ')}.`); continue; }
      if (f.size > ANEXO_MAX_BYTES) { setErro(`"${f.name}" passa de 10 MB.`); continue; }
      try { novos.push({ nome: f.name, base64: await lerBase64(f) }); } catch { setErro(`Não consegui abrir "${f.name}".`); }
    }
    setAnexos((a) => {
      if (a.length + novos.length > ANEXO_MAX_QTD) setErro(`No máximo ${ANEXO_MAX_QTD} arquivos por mensagem.`);
      return [...a, ...novos].slice(0, ANEXO_MAX_QTD);
    });
  }, []);
  const removerAnexo = useCallback((nome: string) => setAnexos((a) => a.filter((x) => x.nome !== nome)), []);

  const enviar = useCallback(async (pergunta?: string) => {
    const enviados = pergunta ? [] : anexos;
    const t = (pergunta ?? texto).trim() || (enviados.length ? PEDIDO_PADRAO_ANEXO : '');
    if (!t || pensando) return;
    setErro('');
    setTexto('');
    setAnexos([]);
    setBolhas((b) => [...b, { papel: 'user', texto: t, anexos: enviados.map((x) => x.nome) }]);
    setPensando(true);
    setPassos([]);
    try {
      const r = await nyro.chat(t, conversationId, enviados);
      setConversationId(r.conversationId);
      setPassos(r.passos.filter((p) => p.tipo !== 'texto'));
      setBolhas((b) => [...b, { papel: 'assistant', texto: r.texto, agente: r.agente, fontes: r.fontes, guardrail: r.guardrail, aprovacoes: r.aprovacoes }]);
    } catch (e) {
      const cr = e instanceof ApiError ? e.configRequired : null;
      if (cr) setStatus((s) => ({ configurada: false, missing: cr.missing, capacidades: s?.capacidades ?? [] }));
      else setErro(e instanceof ApiError && e.status === 400 ? e.message : 'Não consegui falar com a NICO agora.');
    } finally {
      setPensando(false);
    }
  }, [texto, pensando, conversationId, anexos]);

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

  return { status, bolhas, passos, texto, setTexto, pensando, erro, enviar, decidir, anexos, anexar, removerAnexo };
}
