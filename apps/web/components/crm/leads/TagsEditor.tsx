'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { settingsApi, type Tag } from '@/lib/settings';

/** Catálogo de tags de Configurações › Tags (autocomplete). Falha = sem sugestões. */
export function useCatalogoTags(): Tag[] {
  const [tags, setTags] = useState<Tag[]>([]);
  useEffect(() => {
    let vivo = true;
    settingsApi.tags().then((t) => vivo && setTags(t)).catch(() => vivo && setTags([]));
    return () => { vivo = false; };
  }, []);
  return tags;
}

const normal = (t: string) => t.replace(/\s+/g, ' ').trim().slice(0, 40);
const tem = (lista: string[], t: string) => lista.some((x) => x.toLowerCase() === t.toLowerCase());

/**
 * Editor de tags em chips com autocomplete do catálogo. Enter ou vírgula
 * adiciona; Backspace no campo vazio remove a última. Tag fora do catálogo é
 * aceita (o backend a inclui no catálogo).
 */
export function TagsEditor({
  value, onChange, catalogo, placeholder = 'Adicionar tag', disabled, max = 50, unica = false, ariaLabel = 'Tags',
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  catalogo: Tag[];
  placeholder?: string;
  disabled?: boolean;
  max?: number;
  /** Escolha de UMA tag (ações em massa): substitui em vez de somar. */
  unica?: boolean;
  ariaLabel?: string;
}) {
  const [texto, setTexto] = useState('');
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listaId = useId();

  const sugestoes = useMemo(() => {
    const t = texto.trim().toLowerCase();
    return catalogo.filter((c) => !tem(value, c.name) && (!t || c.name.toLowerCase().includes(t))).slice(0, 8);
  }, [catalogo, texto, value]);
  const cor = (nome: string) => catalogo.find((c) => c.name.toLowerCase() === nome.toLowerCase())?.color;

  const adicionar = (bruta: string) => {
    const t = normal(bruta);
    setTexto('');
    setAtivo(0);
    if (!t || tem(value, t)) return;
    if (unica) onChange([t]);
    else if (value.length < max) onChange([...value, t]);
  };
  const remover = (t: string) => onChange(value.filter((x) => x !== t));

  const teclas = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      // sugestão destacada ganha; sem sugestão, vale o que foi digitado
      adicionar(aberto && sugestoes[ativo] ? sugestoes[ativo].name : texto);
    } else if (e.key === 'Backspace' && !texto && value.length) {
      remover(value[value.length - 1]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAberto(true);
      setAtivo((i) => Math.min(i + 1, Math.max(sugestoes.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAtivo((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Escape') {
      setAberto(false);
    }
  };

  return (
    <div className="relative">
      <div
        className={cx('input flex min-h-10 flex-wrap items-center gap-1.5 py-1.5', disabled && 'opacity-60')}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((t) => (
          <span key={t} className="pill gap-1 pr-1">
            {cor(t) && <span className="h-2 w-2 rounded-full" style={{ background: cor(t) }} aria-hidden />}
            {t}
            {!disabled && (
              <button type="button" className="grid h-4 w-4 place-items-center rounded-full text-muted hover:bg-surface2 hover:text-fg" onClick={(e) => { e.stopPropagation(); remover(t); }} aria-label={`Remover tag ${t}`}>
                <Icon name="close" size={11} />
              </button>
            )}
          </span>
        ))}
        <input
          ref={inputRef}
          value={texto}
          disabled={disabled}
          onChange={(e) => { setTexto(e.target.value); setAberto(true); setAtivo(0); }}
          onFocus={() => setAberto(true)}
          onBlur={() => window.setTimeout(() => setAberto(false), 120)}
          onKeyDown={teclas}
          placeholder={value.length && unica ? '' : placeholder}
          className="min-w-[120px] flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-faint"
          role="combobox"
          aria-expanded={aberto && sugestoes.length > 0}
          aria-controls={listaId}
          aria-autocomplete="list"
          aria-label={ariaLabel}
        />
      </div>
      {aberto && !disabled && (sugestoes.length > 0 || normal(texto)) && (
        <ul id={listaId} role="listbox" className="absolute left-0 right-0 z-30 mt-1 max-h-60 overflow-auto rounded-xl border border-line bg-surface p-1 shadow-lg">
          {sugestoes.map((s, i) => (
            <li key={s.id} role="option" aria-selected={i === ativo}>
              <button
                type="button"
                className={cx('flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-fg', i === ativo ? 'bg-surface2' : 'hover:bg-surface2')}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => adicionar(s.name)}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} aria-hidden />
                {s.name}
              </button>
            </li>
          ))}
          {normal(texto) && !tem(catalogo.map((c) => c.name), normal(texto)) && !tem(value, normal(texto)) && (
            <li role="option" aria-selected={false}>
              <button type="button" className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-muted hover:bg-surface2" onMouseDown={(e) => e.preventDefault()} onClick={() => adicionar(texto)}>
                <Icon name="plus" size={13} /> Criar tag &quot;{normal(texto)}&quot;
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
