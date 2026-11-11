'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { Avatar, cx } from '@/components/ui';
import { Button, Confirm, SkeletonRows, useToast } from '@/components/kit';
import { PageShell, PageHeader } from '@/components/revenue/Page';
import { EmptyState, ErrorState } from '@/components/revenue/States';
import { ApiError } from '@/lib/api-error';
import { numero } from '@/lib/format';
import { contatos, type GrupoDuplicado } from '@/lib/contatos';

const MOTIVO: Record<'email' | 'telefone', string> = { email: 'mesmo e-mail', telefone: 'mesmo telefone' };

/**
 * Duplicados (Q2.2): grupos de contatos com o mesmo e-mail ou telefone
 * normalizado. Mesclar move negócios, conversas, notas, tarefas, compromissos,
 * tags e campos para o principal e apaga os demais.
 */
export default function DuplicadosPage() {
  const toast = useToast();
  const [dados, setDados] = useState<{ grupos: GrupoDuplicado[]; total: number } | null>(null);
  const [erro, setErro] = useState(false);
  const [principal, setPrincipal] = useState<Record<number, string>>({});
  const [confirmar, setConfirmar] = useState<number | null>(null);
  const [mesclando, setMesclando] = useState(false);

  const carregar = useCallback(() => {
    setErro(false);
    setDados(null);
    contatos.duplicados()
      .then((d) => {
        setDados(d);
        setPrincipal(Object.fromEntries(d.grupos.map((g, i) => [i, g.sugeridoPrincipalId])));
      })
      .catch(() => setErro(true));
  }, []);
  useEffect(carregar, [carregar]);

  const grupo = confirmar !== null ? dados?.grupos[confirmar] : undefined;
  const principalId = confirmar !== null ? principal[confirmar] : undefined;
  const principalNome = grupo?.contatos.find((c) => c.id === principalId)?.nome ?? '';

  const mesclar = async () => {
    if (!grupo || !principalId) return;
    setMesclando(true);
    try {
      const r = await contatos.mesclar(principalId, grupo.contatos.filter((c) => c.id !== principalId).map((c) => c.id));
      toast.success(`${numero(r.mesclados)} contato(s) mesclado(s) em ${principalNome}.`);
      setConfirmar(null);
      carregar();
    } catch (e) {
      toast.error(e instanceof ApiError && e.message ? e.message : 'Não foi possível mesclar os contatos.');
    } finally {
      setMesclando(false);
    }
  };

  return (
    <PageShell>
      <PageHeader
        title="Duplicados"
        subtitle="Contatos com o mesmo e-mail ou telefone. Escolha o principal e mescle."
        actions={
          <Link href="/leads" className="btn">
            <Icon name="arrowLeft" size={15} />
            Voltar para Leads
          </Link>
        }
      />

      {erro ? (
        <div className="card"><ErrorState onRetry={carregar} /></div>
      ) : !dados ? (
        <div className="card"><SkeletonRows rows={6} label="Procurando duplicados" /></div>
      ) : dados.grupos.length === 0 ? (
        <div className="card">
          <EmptyState icon="check" title="Nenhum duplicado" description="Nenhum par de contatos tem o mesmo e-mail ou telefone." />
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            {numero(dados.total)} grupo(s) encontrado(s){dados.total > dados.grupos.length ? `; mostrando os ${numero(dados.grupos.length)} primeiros` : ''}.
          </p>
          {dados.grupos.map((g, i) => (
            <section key={g.contatos.map((c) => c.id).join('-')} className="card">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  {g.motivos.map((m) => <span key={m} className="pill pill-warning">{MOTIVO[m]}</span>)}
                  <span className="text-sm text-muted">{g.contatos.length} contatos</span>
                </div>
                <Button size="sm" variant="primary" icon="users" onClick={() => setConfirmar(i)}>Mesclar</Button>
              </div>
              <fieldset className="divide-y divide-line">
                <legend className="sr-only">Escolha o contato principal</legend>
                {g.contatos.map((c) => {
                  const ehPrincipal = principal[i] === c.id;
                  return (
                    <label key={c.id} className={cx('flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3 hover:bg-surface2', ehPrincipal && 'bg-brand/5')}>
                      <input type="radio" className="checkbox rounded-full" name={`principal-${i}`} checked={ehPrincipal} onChange={() => setPrincipal((p) => ({ ...p, [i]: c.id }))} aria-label={`Manter ${c.nome} como principal`} />
                      <Avatar name={c.nome} size={30} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <Link href={`/contatos/${c.id}`} className="truncate text-sm font-semibold text-fg hover:text-brand">{c.nome}</Link>
                          {ehPrincipal && <span className="pill pill-brand">Principal</span>}
                        </span>
                        <span className="block truncate text-xs text-muted">{[c.email, c.telefone, c.empresa].filter(Boolean).join(' · ') || 'sem dados de contato'}</span>
                      </span>
                      <span className="text-xs text-muted">
                        {numero(c.negocios)} negócio(s) · {numero(c.conversas)} conversa(s) · criado em {new Date(c.createdAt).toLocaleDateString('pt-BR')}
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            </section>
          ))}
        </div>
      )}

      <Confirm
        open={confirmar !== null}
        onClose={() => setConfirmar(null)}
        onConfirm={mesclar}
        loading={mesclando}
        tone="primary"
        title={`Mesclar em ${principalNome}?`}
        description={`Negócios, conversas, notas, tarefas, compromissos, tags e campos dos outros ${grupo ? grupo.contatos.length - 1 : 0} contato(s) passam para ${principalNome}, e eles são apagados. Dados que o principal já tem são mantidos. Não dá para desfazer.`}
        confirmLabel="Mesclar"
      />
    </PageShell>
  );
}
