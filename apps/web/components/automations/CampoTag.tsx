'use client';

import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { TagsEditor } from '@/components/crm/leads/TagsEditor';
import { settingsApi, type Tag } from '@/lib/settings';
import { ApiError } from '@/lib/api-error';

/**
 * Campo de tag dos nós de automação (ADR-0055). Mostra as tags do catálogo
 * (Configurações › Tags) e, quando a pessoa escolhe uma que não existe, CRIA a
 * tag no sistema na mesma hora: ela passa a aparecer para marcar contatos, em
 * filtros e nas outras automações, sem esperar o fluxo rodar.
 * `multiplo` = várias tags (segmento, atualizar contato); senão, uma só.
 */
export function CampoTag({ value, onChange, multiplo = false, placeholder, ariaLabel = 'Tag' }: {
  value: string | string[] | undefined;
  onChange: (v: string | string[] | undefined) => void;
  multiplo?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [catalogo, setCatalogo] = useState<Tag[]>([]);
  const [aviso, setAviso] = useState<{ tom: 'ok' | 'erro'; texto: string } | null>(null);
  const carregar = useCallback(() => settingsApi.tags().then(setCatalogo).catch(() => setCatalogo([])), []);
  useEffect(() => { void carregar(); }, [carregar]);

  const lista = multiplo ? (Array.isArray(value) ? value : []) : value && typeof value === 'string' ? [value] : [];
  const existe = (t: string) => catalogo.some((c) => c.name.toLowerCase() === t.toLowerCase());

  const mudar = async (nova: string[]) => {
    onChange(multiplo ? nova : nova[0] || undefined);
    const criar = nova.filter((t) => !existe(t) && !lista.some((x) => x.toLowerCase() === t.toLowerCase()));
    if (!criar.length) return;
    try {
      for (const name of criar) {
        await settingsApi.createTag({ name }).catch((e) => {
          // 409 = alguém criou no meio do caminho: a tag existe, é o que importa.
          if (!(e instanceof ApiError && e.status === 409)) throw e;
        });
      }
      await carregar();
      setAviso({ tom: 'ok', texto: criar.length === 1 ? `Tag "${criar[0]}" criada no sistema.` : `${criar.length} tags criadas no sistema.` });
    } catch {
      setAviso({ tom: 'erro', texto: 'Não consegui criar a tag agora. Ela será criada quando o fluxo for publicado.' });
    }
  };

  const contagem = lista.length === 1 ? catalogo.find((c) => c.name.toLowerCase() === lista[0].toLowerCase()) : undefined;

  return (
    <div className="space-y-1.5">
      <TagsEditor
        value={lista}
        onChange={(v) => void mudar(v)}
        catalogo={catalogo}
        unica={!multiplo}
        placeholder={placeholder ?? (multiplo ? 'Escolha ou crie tags' : 'Escolha ou crie uma tag')}
        ariaLabel={ariaLabel}
      />
      {aviso && (
        <p className={aviso.tom === 'ok' ? 'flex items-center gap-1 text-[11px] text-success' : 'text-[11px] text-warning'} role="status">
          {aviso.tom === 'ok' && <Icon name="check" size={12} />} {aviso.texto}
        </p>
      )}
      {!aviso && contagem && typeof contagem.contatos === 'number' && (
        <p className="text-[11px] text-muted">
          {contagem.contatos.toLocaleString('pt-BR')} contato(s) com esta tag
          {contagem.automacoes?.length ? ` · usada em ${contagem.automacoes.length} automação(ões)` : ''}
        </p>
      )}
    </div>
  );
}
