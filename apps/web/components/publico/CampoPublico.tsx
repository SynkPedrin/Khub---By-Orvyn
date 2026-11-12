'use client';

import { cx } from '@/components/ui';
import type { CampoView } from '@/lib/publico/tipos';

export type ValorCampo = string | boolean | string[];

/**
 * Um campo de página pública (formulário /f e perguntas do agendamento /b).
 * Acessível: rótulo ligado ao controle, obrigatório anunciado, erro em
 * `aria-describedby` + `aria-invalid`, grupo de opções em fieldset/legend.
 */
export function CampoPublico({
  campo,
  valor,
  erro,
  onChange,
  idBase,
  desabilitado,
}: {
  campo: CampoView;
  valor: ValorCampo | undefined;
  erro?: string;
  onChange: (v: ValorCampo) => void;
  idBase: string;
  desabilitado?: boolean;
}) {
  const id = `${idBase}-${campo.id}`;
  const idErro = `${id}-erro`;
  const idAjuda = `${id}-ajuda`;
  const descritores = [campo.ajuda ? idAjuda : null, erro ? idErro : null].filter(Boolean).join(' ') || undefined;
  const comum = {
    id,
    name: campo.id,
    'aria-invalid': erro ? true : undefined,
    'aria-describedby': descritores,
    'aria-required': campo.obrigatorio || undefined,
    disabled: desabilitado,
  } as const;
  const marcaObrigatorio = campo.obrigatorio ? (
    <span className="ml-0.5 text-brand" aria-hidden>
      *
    </span>
  ) : null;
  const rodape = (
    <>
      {campo.ajuda && (
        <p id={idAjuda} className="mt-1 text-xs text-muted">
          {campo.ajuda}
        </p>
      )}
      {erro && (
        <p id={idErro} className="mt-1 text-xs font-medium text-danger" role="alert">
          {erro}
        </p>
      )}
    </>
  );
  const largura = campo.largura === 'metade' ? 'sm:col-span-1' : 'sm:col-span-2';

  if (campo.tipo === 'checkbox' || campo.tipo === 'consentimento') {
    return (
      <div className={cx('col-span-2', largura)}>
        <label htmlFor={id} className={cx('flex cursor-pointer items-start gap-3 rounded-md border border-line bg-surface2 p-3 text-sm text-fg', erro && 'border-danger')}>
          <input
            type="checkbox"
            {...comum}
            checked={valor === true}
            onChange={(e) => onChange(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand)]"
          />
          <span className={campo.tipo === 'consentimento' ? 'text-sm leading-relaxed text-muted' : ''}>
            {campo.rotulo}
            {marcaObrigatorio}
          </span>
        </label>
        {rodape}
      </div>
    );
  }

  if (campo.tipo === 'multiselect') {
    const lista = Array.isArray(valor) ? valor : [];
    return (
      <fieldset className={cx('col-span-2', largura)} aria-describedby={descritores} aria-invalid={erro ? true : undefined}>
        <legend className="mb-1.5 text-sm font-medium text-fg">
          {campo.rotulo}
          {marcaObrigatorio}
        </legend>
        <div className="flex flex-wrap gap-2">
          {(campo.opcoes ?? []).map((o, i) => {
            const marcado = lista.includes(o);
            return (
              <label
                key={o}
                htmlFor={`${id}-${i}`}
                className={cx('inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors', marcado ? 'border-brand bg-brand-soft text-fg' : 'border-line text-muted hover:text-fg')}
              >
                <input
                  id={`${id}-${i}`}
                  type="checkbox"
                  className="sr-only"
                  checked={marcado}
                  disabled={desabilitado}
                  onChange={(e) => onChange(e.target.checked ? [...lista, o] : lista.filter((x) => x !== o))}
                />
                {o}
              </label>
            );
          })}
        </div>
        {rodape}
      </fieldset>
    );
  }

  const texto = typeof valor === 'string' ? valor : '';
  return (
    <div className={cx('col-span-2', largura)}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-fg">
        {campo.rotulo}
        {marcaObrigatorio}
      </label>
      {campo.tipo === 'textarea' ? (
        <textarea {...comum} className="textarea min-h-[96px] py-2" rows={4} maxLength={5000} placeholder={campo.placeholder} value={texto} onChange={(e) => onChange(e.target.value)} />
      ) : campo.tipo === 'select' ? (
        <select {...comum} className="select" value={texto} onChange={(e) => onChange(e.target.value)}>
          <option value="">{campo.placeholder || 'Selecione'}</option>
          {(campo.opcoes ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input
          {...comum}
          className="input"
          type={campo.tipo === 'email' ? 'email' : campo.tipo === 'phone' ? 'tel' : campo.tipo === 'date' ? 'date' : campo.tipo === 'number' ? 'text' : 'text'}
          inputMode={campo.tipo === 'number' ? 'decimal' : campo.tipo === 'phone' ? 'tel' : undefined}
          autoComplete={campo.tipo === 'email' ? 'email' : campo.tipo === 'phone' ? 'tel' : campo.id === 'nome' ? 'name' : undefined}
          maxLength={campo.tipo === 'text' ? 500 : 254}
          placeholder={campo.placeholder ?? (campo.tipo === 'phone' ? '(11) 98765-4321' : undefined)}
          value={texto}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {rodape}
    </div>
  );
}

/** Validação local (espelho leve da API): só para dar retorno antes de enviar. */
export function errosLocais(campos: CampoView[], valores: Record<string, ValorCampo>): Record<string, string> {
  const erros: Record<string, string> = {};
  for (const c of campos) {
    const v = valores[c.id];
    const vazio = v === undefined || v === '' || v === false || (Array.isArray(v) && v.length === 0) || (typeof v === 'string' && !v.trim());
    if (vazio) {
      if (c.obrigatorio) erros[c.id] = c.tipo === 'consentimento' ? 'É preciso aceitar para continuar' : 'Campo obrigatório';
      continue;
    }
    if (c.tipo === 'email' && typeof v === 'string' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim())) erros[c.id] = 'Informe um e-mail válido';
    if (c.tipo === 'phone' && typeof v === 'string' && v.replace(/\D/g, '').length < 10) erros[c.id] = 'Informe o telefone com DDD';
  }
  return erros;
}
