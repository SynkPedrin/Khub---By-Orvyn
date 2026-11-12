'use client';

import { useState, type DragEvent } from 'react';
import { Button, Select, Switch, Textarea } from '@/components/kit';
import { Icon } from '@/components/icons';
import { cx, Input } from '@/components/ui';
import { FormularioPublico } from '@/components/publico/FormularioPublico';
import { COMPATIVEIS, NATIVOS_POR_TIPO, ROTULO_NATIVO, campoNovo, type CampoForm, type CampoNativo } from '@/lib/formularios';
import { ROTULO_TIPO, TIPOS_CAMPO, type EstiloForm, type TipoCampoPublico } from '@/lib/publico/tipos';
import type { CampoDef } from '@/lib/custom-fields';

const ICONE_TIPO: Record<TipoCampoPublico, Parameters<typeof Icon>[0]['name']> = {
  text: 'edit', email: 'mail', phone: 'phone', textarea: 'note', select: 'chevronDown', multiselect: 'list',
  checkbox: 'check', date: 'calendar', number: 'chart', consentimento: 'shield',
};

/** Move o item `de` para a posição `para` (sem mutar). */
export function mover<T>(lista: T[], de: number, para: number): T[] {
  if (de === para || de < 0 || para < 0 || de >= lista.length || para >= lista.length) return lista;
  const nova = [...lista];
  const [item] = nova.splice(de, 1);
  nova.splice(para, 0, item);
  return nova;
}

/**
 * Construtor visual: paleta de tipos, lista de campos com arrastar (mouse) e
 * setas (teclado), painel de propriedades do campo escolhido e prévia ao vivo
 * em largura de computador ou celular.
 */
export function Construtor({
  nome,
  campos,
  estilo,
  marca,
  defsCustom,
  onChange,
}: {
  nome: string;
  campos: CampoForm[];
  estilo: EstiloForm;
  marca: string;
  defsCustom: CampoDef[];
  onChange: (campos: CampoForm[]) => void;
}) {
  const [selecionado, setSelecionado] = useState<string | null>(campos[0]?.id ?? null);
  const [arrastando, setArrastando] = useState<number | null>(null);
  const [alvo, setAlvo] = useState<number | null>(null);
  const [tela, setTela] = useState<'desktop' | 'mobile'>('desktop');
  const atual = campos.find((c) => c.id === selecionado) ?? null;

  const adicionar = (tipo: TipoCampoPublico) => {
    const c = campoNovo(tipo, campos);
    onChange([...campos, c]);
    setSelecionado(c.id);
  };
  const alterar = (id: string, patch: Partial<CampoForm>) => onChange(campos.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const remover = (id: string) => {
    const i = campos.findIndex((c) => c.id === id);
    const nova = campos.filter((c) => c.id !== id);
    onChange(nova);
    setSelecionado(nova[Math.min(i, nova.length - 1)]?.id ?? null);
  };

  const soltar = (e: DragEvent, para: number) => {
    e.preventDefault();
    if (arrastando !== null) onChange(mover(campos, arrastando, para));
    setArrastando(null);
    setAlvo(null);
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)_320px]">
      {/* Paleta + lista */}
      <div className="space-y-5">
        <section className="card p-4" aria-labelledby="paleta-titulo">
          <h2 id="paleta-titulo" className="mb-3 text-xs font-semibold uppercase tracking-wide text-faint">Adicionar campo</h2>
          <div className="grid grid-cols-2 gap-2">
            {TIPOS_CAMPO.map((t) => (
              <button key={t} type="button" onClick={() => adicionar(t)} className="flex items-center gap-2 rounded-md border border-line px-2.5 py-2 text-left text-xs font-medium text-fg transition-colors hover:border-brand hover:bg-brand-softer">
                <Icon name={ICONE_TIPO[t]} size={14} />
                {ROTULO_TIPO[t]}
              </button>
            ))}
          </div>
        </section>

        <section className="card p-4" aria-labelledby="campos-titulo">
          <h2 id="campos-titulo" className="mb-1 text-xs font-semibold uppercase tracking-wide text-faint">Campos ({campos.length})</h2>
          <p className="mb-3 text-xs text-muted">Arraste para reordenar ou use as setas.</p>
          {campos.length === 0 ? (
            <p className="rounded-md border border-dashed border-line p-4 text-center text-sm text-muted">Adicione o primeiro campo pela paleta.</p>
          ) : (
            <ol className="space-y-1.5">
              {campos.map((c, i) => (
                <li
                  key={c.id}
                  draggable
                  onDragStart={(e) => { setArrastando(i); e.dataTransfer.effectAllowed = 'move'; }}
                  onDragOver={(e) => { e.preventDefault(); setAlvo(i); }}
                  onDragLeave={() => setAlvo((a) => (a === i ? null : a))}
                  onDrop={(e) => soltar(e, i)}
                  onDragEnd={() => { setArrastando(null); setAlvo(null); }}
                  className={cx(
                    'group flex items-center gap-2 rounded-md border px-2 py-2 transition-colors',
                    selecionado === c.id ? 'border-brand bg-brand-softer' : 'border-line hover:bg-surface2',
                    alvo === i && arrastando !== null && arrastando !== i && 'ring-2 ring-[var(--brand)]',
                    arrastando === i && 'opacity-50',
                  )}
                >
                  <span className="cursor-grab text-faint" aria-hidden><Icon name="menu" size={14} /></span>
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelecionado(c.id)} aria-current={selecionado === c.id || undefined}>
                    <span className="block truncate text-sm font-medium text-fg">{c.rotulo}{c.obrigatorio ? ' *' : ''}</span>
                    <span className="block truncate text-2xs text-faint">
                      {ROTULO_TIPO[c.tipo]}
                      {c.mapear ? ` · ${c.mapear.tipo === 'nativo' ? ROTULO_NATIVO[c.mapear.campo] : defsCustom.find((d) => d.chave === (c.mapear as { chave: string }).chave)?.rotulo ?? 'campo personalizado'}` : ''}
                    </span>
                  </button>
                  <span className="flex shrink-0 gap-0.5">
                    <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={`Subir "${c.rotulo}"`} disabled={i === 0} onClick={() => onChange(mover(campos, i, i - 1))}>
                      <Icon name="arrowUp" size={13} />
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={`Descer "${c.rotulo}"`} disabled={i === campos.length - 1} onClick={() => onChange(mover(campos, i, i + 1))}>
                      <Icon name="arrowDown" size={13} />
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {/* Prévia */}
      <section className="card min-w-0 p-4" aria-labelledby="previa-titulo">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id="previa-titulo" className="text-xs font-semibold uppercase tracking-wide text-faint">Pré-visualização</h2>
          <div className="segbar" role="tablist" aria-label="Tamanho da tela">
            {(['desktop', 'mobile'] as const).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tela === t} className="seg" onClick={() => setTela(t)}>
                {t === 'desktop' ? 'Computador' : 'Celular'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex justify-center rounded-lg bg-bg p-4 sm:p-6">
          <div className={cx('w-full rounded-lg border border-line bg-surface p-5 transition-all', tela === 'mobile' ? 'max-w-[390px]' : 'max-w-xl')}>
            <FormularioPublico slug="previa" nome={nome} campos={campos} estilo={estilo} marca={marca} carimbo="" modo="previa" />
          </div>
        </div>
      </section>

      {/* Propriedades */}
      <section className="card p-4" aria-labelledby="props-titulo">
        <h2 id="props-titulo" className="mb-3 text-xs font-semibold uppercase tracking-wide text-faint">Propriedades</h2>
        {!atual ? (
          <p className="text-sm text-muted">Escolha um campo na lista para editar.</p>
        ) : (
          <PropriedadesCampo key={atual.id} campo={atual} campos={campos} defsCustom={defsCustom} onChange={(p) => alterar(atual.id, p)} onRemover={() => remover(atual.id)} />
        )}
      </section>
    </div>
  );
}

function PropriedadesCampo({
  campo,
  campos,
  defsCustom,
  onChange,
  onRemover,
}: {
  campo: CampoForm;
  campos: CampoForm[];
  defsCustom: CampoDef[];
  onChange: (p: Partial<CampoForm>) => void;
  onRemover: () => void;
}) {
  const temOpcoes = campo.tipo === 'select' || campo.tipo === 'multiselect';
  const ocupado = (n: CampoNativo) => campos.some((c) => c.id !== campo.id && c.mapear?.tipo === 'nativo' && c.mapear.campo === n);
  const nativos = NATIVOS_POR_TIPO[campo.tipo] ?? [];
  const customs = defsCustom.filter((d) => !d.arquivado && COMPATIVEIS[campo.tipo].includes(d.tipo));
  const valorDestino = campo.mapear ? (campo.mapear.tipo === 'nativo' ? `n:${campo.mapear.campo}` : `c:${campo.mapear.chave}`) : '';
  const opcoesDestino = [
    ...nativos.map((n) => ({ value: `n:${n}`, label: `Contato: ${ROTULO_NATIVO[n]}`, disabled: ocupado(n) })),
    ...customs.map((d) => ({ value: `c:${d.chave}`, label: `Campo personalizado: ${d.rotulo}` })),
  ];

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="prop-rotulo" className="mb-1.5 block text-sm font-medium text-fg">{campo.tipo === 'consentimento' ? 'Texto do consentimento' : 'Pergunta'}</label>
        {campo.tipo === 'consentimento' ? (
          <Textarea id="prop-rotulo" rows={4} maxLength={300} showCount value={campo.rotulo} onChange={(e) => onChange({ rotulo: e.target.value })} />
        ) : (
          <Input id="prop-rotulo" maxLength={300} value={campo.rotulo} onChange={(e) => onChange({ rotulo: e.target.value })} />
        )}
      </div>
      {!['checkbox', 'consentimento', 'multiselect'].includes(campo.tipo) && (
        <div>
          <label htmlFor="prop-ph" className="mb-1.5 block text-sm font-medium text-fg">Texto de exemplo</label>
          <Input id="prop-ph" maxLength={120} value={campo.placeholder ?? ''} onChange={(e) => onChange({ placeholder: e.target.value || undefined })} />
        </div>
      )}
      <div>
        <label htmlFor="prop-ajuda" className="mb-1.5 block text-sm font-medium text-fg">Texto de ajuda</label>
        <Input id="prop-ajuda" maxLength={300} value={campo.ajuda ?? ''} onChange={(e) => onChange({ ajuda: e.target.value || undefined })} />
      </div>
      {temOpcoes && (
        <div>
          <label htmlFor="prop-opcoes" className="mb-1.5 block text-sm font-medium text-fg">Opções (uma por linha)</label>
          <Textarea
            id="prop-opcoes"
            rows={5}
            value={(campo.opcoes ?? []).join('\n')}
            onChange={(e) => onChange({ opcoes: e.target.value.split('\n').map((o) => o.slice(0, 80)).filter((o, i, l) => o.trim() !== '' || i === l.length - 1) })}
            onBlur={() => onChange({ opcoes: (campo.opcoes ?? []).map((o) => o.trim()).filter(Boolean) })}
          />
        </div>
      )}
      <Switch label="Obrigatório" checked={campo.obrigatorio} onChange={(v) => onChange({ obrigatorio: v })} layout="row" />
      <div>
        <span className="mb-1.5 block text-sm font-medium text-fg">Largura</span>
        <div className="segbar" role="radiogroup" aria-label="Largura do campo">
          {(['inteira', 'metade'] as const).map((l) => (
            <button key={l} type="button" role="radio" aria-checked={campo.largura === l} className={cx('seg', campo.largura === l && 'bg-[var(--seg-thumb)] text-fg shadow-sm')} onClick={() => onChange({ largura: l })}>
              {l === 'inteira' ? 'Linha inteira' : 'Meia linha'}
            </button>
          ))}
        </div>
      </div>
      {campo.tipo !== 'consentimento' && (
        <div>
          <label htmlFor="prop-destino" className="mb-1.5 block text-sm font-medium text-fg">Salvar no contato</label>
          <Select
            id="prop-destino"
            value={valorDestino}
            placeholder="Só na resposta"
            options={opcoesDestino}
            onChange={(v) => {
              if (!v) onChange({ mapear: null });
              else if (v.startsWith('n:')) onChange({ mapear: { tipo: 'nativo', campo: v.slice(2) as CampoNativo } });
              else onChange({ mapear: { tipo: 'custom', chave: v.slice(2) } });
            }}
          />
          <p className="mt-1 text-xs text-muted">E-mail e telefone ligados ao contato evitam cadastro duplicado.</p>
        </div>
      )}
      {campo.tipo === 'consentimento' && <p className="rounded-md bg-surface2 p-3 text-xs text-muted">Quando marcado, o aceite fica registrado no contato com data e este texto (LGPD).</p>}
      <Button variant="danger" size="sm" icon="trash" onClick={onRemover} className="w-full">Remover campo</Button>
    </div>
  );
}
