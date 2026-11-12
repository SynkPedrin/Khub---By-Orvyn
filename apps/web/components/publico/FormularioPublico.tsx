'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { chamarPublico, contextoDaPagina, corSegura, textoSobre, type CampoView, type ErroChamada, type EstiloForm, type RespostaEnvio } from '@/lib/publico/tipos';
import { CampoPublico, errosLocais, type ValorCampo } from './CampoPublico';

/** Cor da marca do tenant aplicada como token (`--brand`) só dentro da página. */
export function estiloDaMarca(cor?: string): CSSProperties | undefined {
  const c = corSegura(cor);
  return c ? ({ '--brand': c, '--brand-on': textoSobre(c) } as CSSProperties) : undefined;
}

/** Assinatura discreta das páginas públicas. */
export function FeitoComKhub() {
  return (
    <p className="mt-6 text-center text-2xs text-faint">
      Feito com{' '}
      <a href="/" target="_blank" rel="noopener noreferrer" className="font-semibold text-muted hover:text-fg">
        KHUB
      </a>
    </p>
  );
}

/** Cabeçalho com a marca do tenant (logo opcional + nome). */
export function CabecalhoMarca({ marca, logoUrl, children }: { marca: string; logoUrl?: string; children?: ReactNode }) {
  return (
    <header className="mb-6">
      <div className="mb-4 flex items-center gap-3">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={marca} className="h-9 max-w-[160px] object-contain" referrerPolicy="no-referrer" />
        ) : (
          <span className="eyebrow">{marca}</span>
        )}
      </div>
      {children}
    </header>
  );
}

export interface FormularioPublicoProps {
  slug: string;
  nome: string;
  campos: CampoView[];
  estilo: EstiloForm;
  marca: string;
  carimbo: string;
  /** `pagina` = /f/slug · `embed` = iframe no site do cliente · `previa` = construtor (não envia). */
  modo: 'pagina' | 'embed' | 'previa';
}

/**
 * Formulário público do KHUB. Envia para o proxy público (`/api/public`),
 * que repassa o IP real à API para o rate limit. O campo `website` é a isca
 * (honeypot): invisível para pessoas, preenchido por robôs.
 */
export function FormularioPublico({ slug, nome, campos, estilo, marca, carimbo, modo }: FormularioPublicoProps) {
  const idBase = useId();
  const [valores, setValores] = useState<Record<string, ValorCampo>>({});
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const isca = useRef<HTMLInputElement>(null);
  const raiz = useRef<HTMLDivElement>(null);

  // Embed: avisa o site pai da altura para o iframe não ter barra de rolagem.
  useEffect(() => {
    if (modo !== 'embed' || !raiz.current || typeof ResizeObserver === 'undefined') return;
    const enviar = () => window.parent?.postMessage({ tipo: 'khub-form:altura', slug, altura: Math.ceil(document.documentElement.scrollHeight) }, '*');
    const ro = new ResizeObserver(enviar);
    ro.observe(raiz.current);
    enviar();
    return () => ro.disconnect();
  }, [modo, slug]);

  const focarPrimeiroErro = (lista: Record<string, string>) => {
    const primeiro = campos.find((c) => lista[c.id]);
    if (primeiro) document.getElementById(`${idBase}-${primeiro.id}`)?.focus();
  };

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (modo === 'previa') return;
    setErroGeral(null);
    const locais = errosLocais(campos, valores);
    setErros(locais);
    if (Object.keys(locais).length) {
      focarPrimeiroErro(locais);
      return;
    }
    setEnviando(true);
    try {
      const r = await chamarPublico<RespostaEnvio>(`forms/${slug}/submit`, {
        method: 'POST',
        body: { respostas: valores, carimbo, website: isca.current?.value ?? '', ...contextoDaPagina() },
      });
      if (r.redirecionarUrl) {
        if (modo === 'embed') window.parent?.postMessage({ tipo: 'khub-form:redirecionar', slug, url: r.redirecionarUrl }, '*');
        else window.location.assign(r.redirecionarUrl);
      }
      setSucesso(r.mensagem);
    } catch (x) {
      const err = x as ErroChamada;
      const porCampo: Record<string, string> = {};
      for (const c of err.corpo?.campos ?? []) porCampo[c.campo] = c.erro.charAt(0).toUpperCase() + c.erro.slice(1);
      setErros(porCampo);
      if (Object.keys(porCampo).length) focarPrimeiroErro(porCampo);
      setErroGeral(err.status === 429 ? 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.' : err.message);
    } finally {
      setEnviando(false);
    }
  }

  const corpo = sucesso ? (
    <div className="flex flex-col items-center py-10 text-center" role="status" aria-live="polite">
      <span className="icon-tile mb-4 h-12 w-12 rounded-full">
        <Icon name="check" size={22} />
      </span>
      <p className="t-section">Tudo certo</p>
      <p className="mt-2 max-w-sm text-sm text-muted">{sucesso}</p>
    </div>
  ) : (
    <form onSubmit={enviar} noValidate aria-describedby={erroGeral ? `${idBase}-geral` : undefined}>
      <div className="grid grid-cols-2 gap-4">
        {campos.map((c) => (
          <CampoPublico
            key={c.id}
            campo={c}
            idBase={idBase}
            valor={valores[c.id]}
            erro={erros[c.id]}
            desabilitado={enviando}
            onChange={(v) => {
              setValores((s) => ({ ...s, [c.id]: v }));
              if (erros[c.id]) setErros((s) => ({ ...s, [c.id]: '' }));
            }}
          />
        ))}
      </div>
      {/* Isca para robôs: fora da tela, fora do Tab, ignorada por leitor de tela. */}
      <div aria-hidden className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
        <label htmlFor={`${idBase}-website`}>Site</label>
        <input ref={isca} id={`${idBase}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
      {erroGeral && (
        <p id={`${idBase}-geral`} role="alert" className="mt-4 rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger">
          {erroGeral}
        </p>
      )}
      <button
        type="submit"
        className="btn btn-primary mt-6 h-11 w-full text-base"
        style={estilo.cor ? { color: 'var(--brand-on)' } : undefined}
        disabled={enviando}
        aria-busy={enviando || undefined}
      >
        {enviando ? 'Enviando' : estilo.textoBotao || 'Enviar'}
      </button>
      {modo === 'previa' && <p className="mt-2 text-center text-xs text-faint">Pré-visualização: o envio fica desativado aqui.</p>}
    </form>
  );

  return (
    <div ref={raiz} style={estiloDaMarca(estilo.cor)} className={cx('relative', modo === 'embed' ? 'p-1' : '')}>
      <CabecalhoMarca marca={marca} logoUrl={estilo.logoUrl}>
        <h1 className="t-display text-2xl sm:text-3xl">{estilo.titulo || nome}</h1>
        {estilo.descricao && <p className="mt-2 whitespace-pre-line text-md text-muted">{estilo.descricao}</p>}
      </CabecalhoMarca>
      {corpo}
      {modo !== 'previa' && <FeitoComKhub />}
    </div>
  );
}
