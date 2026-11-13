'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { useToast } from '@/components/kit';
import type { Atendente } from '@/lib/crm';
import {
  filtrarRespostas,
  inbox,
  LIMITE_ARQUIVO,
  resolverVariaveis,
  tamanhoLegivel,
  tipoDoArquivo,
  tokenNoCursor,
  type DadosVariaveis,
  type RespostaRapida,
} from '@/lib/inbox';
import { RespostasRapidasModal } from './RespostasRapidasModal';

type Modo = 'responder' | 'nota';
type Sugestao =
  | { tipo: '/'; inicio: number; itens: RespostaRapida[] }
  | { tipo: '@'; inicio: number; itens: Atendente[] };

const ACEITOS = 'image/jpeg,image/png,image/webp,audio/ogg,audio/mpeg,audio/mp4,audio/aac,audio/amr,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip';

export interface ComposerProps {
  iaRespondendo: boolean;
  atendentes: Atendente[];
  meuId?: string;
  dados: DadosVariaveis;
  ocupado: boolean;
  /** Avisos acima do campo (gated, erro de envio). */
  topo?: ReactNode;
  onTexto: (texto: string) => Promise<void> | void;
  onMidia: (arquivo: File, legenda: string) => Promise<void> | void;
  onNota: (corpo: string, mencoes: string[]) => Promise<void> | void;
  /** Rascunho vindo de fora (Sugestões da IA): cada `n` novo substitui o texto, para o humano revisar. */
  rascunho?: { texto: string; n: number } | null;
}

/**
 * Composer do Inbox (Q2.5):
 *  - "Responder" vai ao cliente; "Nota interna" fica só com a equipe (tom
 *    amarelado, nunca sai pelo WhatsApp) e aceita @menção a um membro;
 *  - "/" abre as respostas rápidas (setas, Enter ou Tab insere, Esc fecha),
 *    com as variáveis já resolvidas para esta conversa;
 *  - clipe anexa imagem, documento ou áudio (o texto vira legenda).
 */
export function Composer({ iaRespondendo, atendentes, meuId, dados, ocupado, topo, onTexto, onMidia, onNota, rascunho }: ComposerProps) {
  const toast = useToast();
  const [modo, setModo] = useState<Modo>('responder');
  const [texto, setTexto] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [respostas, setRespostas] = useState<RespostaRapida[]>([]);
  const [gerenciar, setGerenciar] = useState(false);
  const [sugestao, setSugestao] = useState<Sugestao | null>(null);
  const [ativo, setAtivo] = useState(0);
  const mencionados = useRef<Map<string, string>>(new Map());
  const campo = useRef<HTMLTextAreaElement>(null);
  const seletor = useRef<HTMLInputElement>(null);
  const listaId = useId();

  const carregarRespostas = useCallback(() => {
    inbox.respostas().then(setRespostas).catch(() => setRespostas([]));
  }, []);
  useEffect(() => carregarRespostas(), [carregarRespostas]);

  const equipe = useMemo(() => atendentes.filter((a) => a.identityId !== meuId), [atendentes, meuId]);

  // Sugestão da IA escolhida: vira rascunho de RESPOSTA (nunca enviada sozinha).
  useEffect(() => {
    if (!rascunho) return;
    setModo('responder');
    setTexto(rascunho.texto);
    setSugestao(null);
    requestAnimationFrame(() => campo.current?.focus());
  }, [rascunho]);

  /** Recalcula o menu de sugestão a partir do cursor. */
  const avaliar = (valor: string, cursor: number) => {
    const barra = tokenNoCursor(valor, cursor, '/');
    if (barra && !arquivo) {
      const itens = filtrarRespostas(respostas, barra.busca).slice(0, 8);
      setSugestao({ tipo: '/', inicio: barra.inicio, itens });
      setAtivo(0);
      return;
    }
    const arroba = modo === 'nota' ? tokenNoCursor(valor, cursor, '@') : null;
    if (arroba) {
      const q = arroba.busca.toLowerCase();
      const itens = equipe.filter((a) => a.nome.toLowerCase().includes(q)).slice(0, 8);
      setSugestao(itens.length ? { tipo: '@', inicio: arroba.inicio, itens } : null);
      setAtivo(0);
      return;
    }
    setSugestao(null);
  };

  const substituir = (inicio: number, inserir: string) => {
    const el = campo.current;
    const cursor = el?.selectionStart ?? texto.length;
    const novo = texto.slice(0, inicio) + inserir + texto.slice(cursor);
    setTexto(novo);
    setSugestao(null);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = inicio + inserir.length;
      el?.setSelectionRange(pos, pos);
    });
  };

  const escolher = (i: number) => {
    if (!sugestao) return;
    if (sugestao.tipo === '/') {
      const r = sugestao.itens[i];
      if (r) substituir(sugestao.inicio, resolverVariaveis(r.corpo, dados));
    } else {
      const a = sugestao.itens[i];
      if (a) {
        mencionados.current.set(a.identityId, a.nome);
        substituir(sugestao.inicio, `@${a.nome} `);
      }
    }
  };

  const escolherArquivo = (f: File | undefined) => {
    if (!f) return;
    const tipo = tipoDoArquivo(f.type);
    if (f.size > LIMITE_ARQUIVO[tipo]) {
      toast.error('Arquivo grande demais', { description: `O limite para ${tipo === 'imagem' ? 'imagens' : tipo === 'audio' ? 'áudios' : 'documentos'} é ${tamanhoLegivel(LIMITE_ARQUIVO[tipo])}.` });
      return;
    }
    setModo('responder');
    setArquivo(f);
    setSugestao(null);
    campo.current?.focus();
  };

  const enviar = async () => {
    if (ocupado) return;
    const t = texto.trim();
    if (modo === 'nota') {
      if (!t) return;
      const mencoes = [...mencionados.current.entries()].filter(([, nome]) => t.includes(`@${nome}`)).map(([id]) => id);
      setTexto('');
      mencionados.current.clear();
      await onNota(t, mencoes);
      return;
    }
    if (arquivo) {
      const f = arquivo;
      setArquivo(null);
      setTexto('');
      await onMidia(f, t);
      return;
    }
    if (!t) return;
    setTexto('');
    await onTexto(t);
  };

  const teclas = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (sugestao && sugestao.itens.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setAtivo((i) => (i + 1) % sugestao.itens.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setAtivo((i) => (i - 1 + sugestao.itens.length) % sugestao.itens.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); escolher(ativo); return; }
    }
    if (sugestao && e.key === 'Escape') { e.preventDefault(); setSugestao(null); return; }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void enviar();
    }
  };

  const nota = modo === 'nota';
  const podeEnviar = !ocupado && (nota ? !!texto.trim() : !!arquivo || !!texto.trim());
  const placeholder = nota
    ? 'Nota só para a equipe. Use @ para mencionar alguém.'
    : arquivo
      ? 'Legenda (opcional)'
      : iaRespondendo
        ? 'A IA está respondendo. Escrever aqui assume a conversa.'
        : 'Escreva uma mensagem ou / para respostas rápidas';

  return (
    <>
    <form
      className={cx('border-t p-3 lg:p-4', nota ? 'border-warning-border bg-warning-soft' : 'border-line')}
      onSubmit={(e) => {
        e.preventDefault();
        void enviar();
      }}
    >
      {topo}
      <div className="mb-2 flex items-center gap-2">
        <div className="segbar" role="tablist" aria-label="Tipo de mensagem">
          <button type="button" role="tab" aria-selected={!nota} className="seg px-3" onClick={() => { setModo('responder'); setSugestao(null); }}>
            Responder
          </button>
          <button type="button" role="tab" aria-selected={nota} className="seg px-3" onClick={() => { setModo('nota'); setArquivo(null); setSugestao(null); }}>
            <Icon name="lock" size={12} /> Nota interna
          </button>
        </div>
        <button type="button" className="ml-auto text-xs font-medium text-muted hover:text-fg" onClick={() => setGerenciar(true)}>
          Respostas rápidas
        </button>
      </div>

      {arquivo && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2">
          <Icon name={arquivo.type.startsWith('image/') ? 'eye' : arquivo.type.startsWith('audio/') ? 'play' : 'file'} size={16} className="shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate text-sm text-fg">{arquivo.name}</span>
          <span className="shrink-0 text-xs text-muted tabular">{tamanhoLegivel(arquivo.size)}</span>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Remover anexo" onClick={() => setArquivo(null)}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      <div className="relative flex items-end gap-2">
        {sugestao && (
          <div className="lg-popover absolute bottom-[calc(100%+6px)] left-0 z-dropdown w-full max-w-md overflow-hidden p-1" role="listbox" id={listaId} aria-label={sugestao.tipo === '/' ? 'Respostas rápidas' : 'Mencionar membro'}>
            {sugestao.itens.length === 0 ? (
              <div className="px-3 py-2.5 text-sm text-muted">
                {respostas.length === 0 ? 'Nenhuma resposta rápida cadastrada.' : 'Nada encontrado.'}{' '}
                <button type="button" className="font-medium text-brand hover:underline" onClick={() => setGerenciar(true)}>
                  {respostas.length === 0 ? 'Criar a primeira' : 'Gerenciar'}
                </button>
              </div>
            ) : sugestao.tipo === '/' ? (
              sugestao.itens.map((r, i) => (
                <button
                  key={r.id}
                  type="button"
                  role="option"
                  aria-selected={i === ativo}
                  onMouseEnter={() => setAtivo(i)}
                  onMouseDown={(e) => { e.preventDefault(); escolher(i); }}
                  className={cx('block w-full rounded-lg px-3 py-2 text-left', i === ativo && 'bg-[var(--fill-4)]')}
                >
                  <span className="flex items-baseline gap-2">
                    <span className="font-mono text-xs font-semibold text-brand">/{r.atalho}</span>
                    <span className="truncate text-sm font-medium text-fg">{r.titulo}</span>
                  </span>
                  <span className="block truncate text-xs text-muted">{resolverVariaveis(r.corpo, dados)}</span>
                </button>
              ))
            ) : (
              sugestao.itens.map((a, i) => (
                <button
                  key={a.identityId}
                  type="button"
                  role="option"
                  aria-selected={i === ativo}
                  onMouseEnter={() => setAtivo(i)}
                  onMouseDown={(e) => { e.preventDefault(); escolher(i); }}
                  className={cx('flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm', i === ativo && 'bg-[var(--fill-4)]')}
                >
                  <Icon name="user" size={14} className="text-muted" />
                  <span className="truncate text-fg">{a.nome}</span>
                  <span className="ml-auto truncate text-xs text-muted">{a.email}</span>
                </button>
              ))
            )}
          </div>
        )}

        {!nota && (
          <>
            <input ref={seletor} type="file" className="hidden" accept={ACEITOS} onChange={(e) => { escolherArquivo(e.target.files?.[0]); e.target.value = ''; }} />
            <button type="button" className="btn btn-ghost btn-icon h-11 w-11 shrink-0" aria-label="Anexar arquivo" disabled={ocupado} onClick={() => seletor.current?.click()}>
              <Icon name="paperclip" size={18} />
            </button>
          </>
        )}
        <textarea
          ref={campo}
          className={cx('textarea max-h-40 min-h-[44px] flex-1 resize-none', nota && 'border-warning-border')}
          rows={1}
          placeholder={placeholder}
          value={texto}
          maxLength={nota ? 4000 : arquivo ? 1000 : 4000}
          onChange={(e) => {
            setTexto(e.target.value);
            avaliar(e.target.value, e.target.selectionStart ?? e.target.value.length);
          }}
          onKeyDown={teclas}
          onBlur={() => setTimeout(() => setSugestao(null), 120)}
          aria-label={nota ? 'Nota interna' : arquivo ? 'Legenda do anexo' : 'Mensagem'}
          aria-autocomplete="list"
          aria-controls={sugestao ? listaId : undefined}
          aria-expanded={!!sugestao}
        />
        <button type="submit" className={cx('btn h-11 px-4', nota ? 'btn-soft' : 'btn-primary')} disabled={!podeEnviar} aria-label={nota ? 'Salvar nota interna' : 'Enviar mensagem'}>
          <Icon name={nota ? 'note' : 'send'} size={17} />
          <span className="hidden sm:inline">{nota ? 'Salvar nota' : 'Enviar'}</span>
        </button>
      </div>
      <p className={cx('mt-1.5 text-xs', nota ? 'text-warning' : 'text-muted')}>
        {nota ? 'Visível só para a equipe. Nunca é enviada ao cliente.' : 'Enter envia, Shift + Enter quebra a linha, / abre as respostas rápidas'}
      </p>
    </form>
    <RespostasRapidasModal open={gerenciar} onClose={() => setGerenciar(false)} respostas={respostas} onMudou={carregarRespostas} />
    </>
  );
}
