'use client';

import { useEffect, useState } from 'react';
import { Button, Card, Field, Input, cx } from '@/components/ui';
import { Icon } from '@/components/icons';
import { settingsApi, type Tag } from '@/lib/settings';
import { ApiError } from '@/lib/api-error';

const CORES_TAG = ['#7B2EFF', '#A855F7', '#C084FC', '#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#EC4899', '#14B8A6', '#64748B'];

export function TagsTab() {
  const [tags, setTags] = useState<Tag[] | null>(null);
  const [nome, setNome] = useState('');
  const [cor, setCor] = useState(CORES_TAG[0]);
  const [erro, setErro] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => settingsApi.tags().then(setTags).catch(() => setTags([]));
  useEffect(() => { load(); }, []);

  const criar = async () => {
    if (!nome.trim()) return;
    setErro(''); setBusy(true);
    try {
      await settingsApi.createTag({ name: nome.trim(), color: cor });
      setNome(''); setCor(CORES_TAG[0]); load();
    } catch (e) {
      setErro(e instanceof ApiError ? (e.body?.detail as string) ?? 'Não consegui criar a tag.' : 'Não consegui criar a tag.');
    } finally { setBusy(false); }
  };
  const remover = async (id: string) => { await settingsApi.deleteTag(id).catch(() => undefined); load(); };

  return (
    <div className="space-y-5">
      <Card className="p-6">
        <h2 className="font-bold text-fg">Nova tag</h2>
        <p className="text-xs text-muted">Tags organizam contatos e disparam automações (gatilho “tag adicionada”).</p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1"><Field label="Nome"><Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="cliente-vip" onKeyDown={(e) => { if (e.key === 'Enter') criar(); }} /></Field></div>
          <div>
            <p className="mb-1 text-xs font-semibold text-muted">Cor</p>
            <div className="flex flex-wrap gap-1.5">
              {CORES_TAG.map((c) => (
                <button key={c} onClick={() => setCor(c)} className={cx('h-7 w-7 rounded-full transition-transform', cor === c ? 'ring-2 ring-offset-2 ring-offset-surface' : 'hover:scale-110')} style={{ background: c, boxShadow: cor === c ? `0 0 0 2px ${c}` : undefined }} aria-label={c} />
              ))}
            </div>
          </div>
          <Button onClick={criar} disabled={busy || !nome.trim()}><Icon name="plus" size={16} /> Criar tag</Button>
        </div>
        {erro && <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">{erro}</p>}
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-line px-5 py-3"><h2 className="font-bold text-fg">Tags do CRM</h2></div>
        <div className="divide-y divide-line">
          {tags?.map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-5 py-3">
              <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-white" style={{ background: t.color }}>
                {t.name}
              </span>
              {t.descricao && <span className="truncate text-xs text-muted">{t.descricao}</span>}
              <span className="ml-auto text-xs text-muted">{t.usos} uso(s)</span>
              <button onClick={() => remover(t.id)} className="rounded-lg p-1.5 text-muted hover:bg-surface2 hover:text-red-500" aria-label="Excluir"><Icon name="close" size={14} /></button>
            </div>
          ))}
          {tags && tags.length === 0 && <p className="px-5 py-8 text-center text-sm text-muted">Nenhuma tag ainda. Crie a primeira acima.</p>}
          {!tags && <p className="px-5 py-8 text-center text-sm text-muted">Carregando…</p>}
        </div>
      </Card>
    </div>
  );
}
