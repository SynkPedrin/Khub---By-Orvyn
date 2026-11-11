'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { cx } from '@/components/ui';
import { Button, Select, SkeletonLines, Switch, Textarea, useToast } from '@/components/kit';
import { Icon } from '@/components/icons';
import { useAuth } from '@/lib/auth';
import {
  agrupar, checarValor, customFields, errosDosCampos, formatarValor, mensagemErro, paraApi, paraFormulario, vazio,
  type CampoDef, type EntidadeCampo,
} from '@/lib/custom-fields';

type ValorForm = string | boolean | string[];

const ROTULO_ENTIDADE: Record<EntidadeCampo, string> = { contact: 'contatos', deal: 'negócios', company: 'empresas' };

/** Definições ativas da entidade, na ordem de Configurações. */
export function useCamposDefs(entidade: EntidadeCampo) {
  const [defs, setDefs] = useState<CampoDef[] | null>(null);
  const [erro, setErro] = useState(false);
  const carregar = useCallback(() => {
    setErro(false);
    customFields.list(entidade).then((l) => setDefs(l.filter((d) => !d.arquivado))).catch(() => { setDefs([]); setErro(true); });
  }, [entidade]);
  useEffect(() => { carregar(); }, [carregar]);
  return { defs, erro, recarregar: carregar };
}

/** Um controle de formulário por tipo de campo. */
export function CampoInput({ def, valor, onChange, erro }: { def: CampoDef; valor: ValorForm; onChange: (v: ValorForm) => void; erro?: string }) {
  const id = `cf-${def.entidade}-${def.chave}`;
  const comum = { id, 'aria-invalid': !!erro || undefined, 'aria-describedby': erro ? `${id}-erro` : undefined };
  const texto = typeof valor === 'string' ? valor : '';

  let controle: React.ReactNode;
  switch (def.tipo) {
    case 'textarea':
      controle = <Textarea {...comum} value={texto} onChange={(e) => onChange(e.target.value)} rows={3} maxLength={5000} />;
      break;
    case 'boolean':
      controle = <Switch checked={valor === true} onChange={(v) => onChange(v)} label={valor === true ? 'Sim' : 'Não'} />;
      break;
    case 'select':
      controle = (
        <Select {...comum} value={texto} onChange={(v) => onChange(v)} placeholder="Selecione" options={def.opcoes.map((o) => ({ value: o, label: o }))} />
      );
      break;
    case 'multiselect': {
      const marcadas = Array.isArray(valor) ? valor : [];
      controle = (
        <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby={`${id}-rotulo`}>
          {def.opcoes.map((o) => {
            const on = marcadas.includes(o);
            return (
              <button
                key={o}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(on ? marcadas.filter((x) => x !== o) : [...marcadas, o])}
                className={cx('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors', on ? 'border-brand-border bg-brand-soft text-brand' : 'border-line text-muted hover:text-fg')}
              >
                {on && <Icon name="check" size={12} />} {o}
              </button>
            );
          })}
        </div>
      );
      break;
    }
    default: {
      const tipoHtml = def.tipo === 'date' ? 'date' : def.tipo === 'email' ? 'email' : def.tipo === 'url' ? 'url' : def.tipo === 'phone' ? 'tel' : 'text';
      const numerico = def.tipo === 'number' || def.tipo === 'money';
      controle = (
        <div className="relative">
          {def.tipo === 'money' && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">R$</span>}
          <input
            {...comum}
            className={cx('input', numerico && 'tabular', def.tipo === 'money' && 'pl-9')}
            type={tipoHtml}
            inputMode={numerico ? 'decimal' : undefined}
            value={texto}
            onChange={(e) => onChange(e.target.value)}
            maxLength={def.tipo === 'text' ? 500 : undefined}
            placeholder={def.tipo === 'url' ? 'https://' : undefined}
          />
        </div>
      );
    }
  }

  return (
    <div className={cx(def.tipo === 'textarea' || def.tipo === 'multiselect' ? 'sm:col-span-2' : '')}>
      <label id={`${id}-rotulo`} htmlFor={def.tipo === 'multiselect' || def.tipo === 'boolean' ? undefined : id} className="mb-1 block text-xs font-semibold text-muted">
        {def.rotulo}
        {def.obrigatorio && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
        {def.obrigatorio && <span className="sr-only"> (obrigatório)</span>}
      </label>
      {controle}
      {erro && <p id={`${id}-erro`} className="mt-1 text-xs text-danger">{erro}</p>}
    </div>
  );
}

/**
 * Campos personalizados de um registro: exibição e edição por tipo (Q2.3).
 * `onSalvar` recebe só o que mudou (`null` = limpar) e chama o PATCH da
 * entidade com `{ camposCustom }`; a API valida e mescla. Erros por campo
 * voltam da API (extensão `campos`) e aparecem embaixo de cada controle.
 */
export function CamposPersonalizados({
  entidade, valores, onSalvar, compacto = false, className,
}: {
  entidade: EntidadeCampo;
  valores: Record<string, unknown> | null | undefined;
  onSalvar: (patch: Record<string, unknown>) => Promise<void>;
  /** Layout de uma coluna (drawer). */
  compacto?: boolean;
  className?: string;
}) {
  const { defs, erro: erroDefs, recarregar } = useCamposDefs(entidade);
  const { user } = useAuth();
  const admin = ['owner', 'admin'].includes(user?.role ?? '');
  const toast = useToast();
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState<Record<string, ValorForm>>({});
  const [erros, setErros] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const atuais = useMemo(() => valores ?? {}, [valores]);

  const abrir = () => {
    if (!defs) return;
    setForm(Object.fromEntries(defs.map((d) => [d.chave, paraFormulario(d, atuais[d.chave])])));
    setErros({});
    setEditando(true);
  };

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!defs) return;
    const locais: Record<string, string> = {};
    const patch: Record<string, unknown> = {};
    for (const d of defs) {
      const v = form[d.chave] ?? paraFormulario(d, undefined);
      const msg = checarValor(d, v);
      if (msg) locais[d.chave] = msg;
      const novo = paraApi(d, v);
      const antigo = atuais[d.chave];
      const igual = (vazio(novo) && vazio(antigo)) || JSON.stringify(novo) === JSON.stringify(antigo);
      if (!igual) patch[d.chave] = novo;
    }
    setErros(locais);
    if (Object.keys(locais).length) return;
    if (!Object.keys(patch).length) { setEditando(false); return; }
    setSalvando(true);
    try {
      await onSalvar(patch);
      toast.success('Campos personalizados salvos');
      setEditando(false);
    } catch (err) {
      const porCampo = errosDosCampos(err);
      setErros(porCampo);
      toast.error(mensagemErro(err, 'Não consegui salvar os campos'));
    } finally {
      setSalvando(false);
    }
  };

  const cabecalho = (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className={cx('font-bold text-fg', compacto && 'text-sm')}>Campos personalizados</h2>
      {defs && defs.length > 0 && !editando && (
        <Button variant="ghost" size="sm" icon="edit" onClick={abrir}>Editar</Button>
      )}
    </div>
  );

  if (!defs) {
    return <div className={className}>{cabecalho}<SkeletonLines lines={3} /></div>;
  }

  if (erroDefs) {
    return (
      <div className={className}>
        {cabecalho}
        <p className="text-sm text-muted">
          Não consegui carregar os campos. <button type="button" className="font-semibold text-brand hover:underline" onClick={recarregar}>Tentar de novo</button>
        </p>
      </div>
    );
  }

  if (defs.length === 0) {
    return (
      <div className={className}>
        {cabecalho}
        <p className="text-sm text-muted">
          Nenhum campo personalizado para {ROTULO_ENTIDADE[entidade]}.
          {admin && (
            <> <Link href="/configuracoes?tab=campos" className="font-semibold text-brand hover:underline">Criar em Configurações</Link></>
          )}
        </p>
      </div>
    );
  }

  const grupos = agrupar(defs);

  if (editando) {
    return (
      <form onSubmit={salvar} className={className} noValidate>
        {cabecalho}
        <div className="space-y-4">
          {grupos.map((g) => (
            <fieldset key={g.grupo ?? '_'} className="space-y-3">
              {g.grupo && <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-faint">{g.grupo}</legend>}
              <div className={cx('grid gap-3', !compacto && 'sm:grid-cols-2')}>
                {g.campos.map((d) => (
                  <CampoInput key={d.id} def={d} valor={form[d.chave] ?? paraFormulario(d, undefined)} onChange={(v) => setForm((f) => ({ ...f, [d.chave]: v }))} erro={erros[d.chave]} />
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setEditando(false)} disabled={salvando}>Cancelar</Button>
          <Button type="submit" variant="primary" loading={salvando}>Salvar campos</Button>
        </div>
      </form>
    );
  }

  return (
    <div className={className}>
      {cabecalho}
      <div className="space-y-4">
        {grupos.map((g) => (
          <div key={g.grupo ?? '_'}>
            {g.grupo && <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">{g.grupo}</p>}
            <dl className={cx('grid gap-3', !compacto && 'sm:grid-cols-2')}>
              {g.campos.map((d) => {
                const txt = formatarValor(d, atuais[d.chave]);
                return (
                  <div key={d.id} className="min-w-0">
                    <dt className="text-xs text-muted">{d.rotulo}</dt>
                    <dd className={cx('mt-0.5 break-words text-sm', txt ? 'text-fg' : 'text-faint', (d.tipo === 'money' || d.tipo === 'number') && 'tabular')}>
                      {!txt ? 'Não informado' : d.tipo === 'url' ? (
                        <a href={txt} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">{txt}</a>
                      ) : d.tipo === 'email' ? (
                        <a href={`mailto:${txt}`} className="text-brand hover:underline">{txt}</a>
                      ) : txt}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}
