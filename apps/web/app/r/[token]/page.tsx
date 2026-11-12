'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { Button, Textarea } from '@/components/kit';

/**
 * Link curto público do pedido de avaliação (`/r/:token`, Q4.4).
 *
 * Registra o clique (no navegador: robô de pré-visualização do WhatsApp não
 * executa a página, e a API ainda filtra pelo User-Agent) e leva ao link de
 * avaliação. Com o filtro de satisfação, pergunta a nota antes: alta segue
 * para o link público; baixa abre um formulário interno e avisa a equipe.
 */
type Abertura = { empresa: string; filtroSatisfacao: boolean; destino: string | null; jaAvaliou: boolean; notaMinima?: number };
type Fase = 'carregando' | 'redirecionando' | 'nota' | 'feedback' | 'obrigado' | 'invalido' | 'erro';

async function chamar<T>(token: string, acao: 'abrir' | 'nota' | 'feedback', corpo?: unknown): Promise<T> {
  const r = await fetch(`/api/publico/avaliacao/${encodeURIComponent(token)}/${acao}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo ?? {}) });
  if (r.status === 404) throw new Error('invalido');
  if (!r.ok) throw new Error('erro');
  return r.json() as Promise<T>;
}

/** Só segue para https: o destino vem do banco, mas a página não confia nele cegamente. */
function irPara(url: string | null): boolean {
  if (!url || !/^https:\/\//i.test(url)) return false;
  window.location.replace(url);
  return true;
}

const ROTULO_NOTA = ['Muito ruim', 'Ruim', 'Regular', 'Boa', 'Excelente'];

export default function AvaliacaoPublicaPage() {
  const { token } = useParams<{ token: string }>();
  const [fase, setFase] = useState<Fase>('carregando');
  const [empresa, setEmpresa] = useState('');
  const [nota, setNota] = useState<number | null>(null);
  const [comentario, setComentario] = useState('');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    chamar<Abertura>(token, 'abrir')
      .then((a) => {
        setEmpresa(a.empresa);
        if (!a.filtroSatisfacao) setFase(irPara(a.destino) ? 'redirecionando' : 'erro');
        else setFase(a.jaAvaliou ? 'obrigado' : 'nota');
      })
      .catch((e: Error) => setFase(e.message === 'invalido' ? 'invalido' : 'erro'));
  }, [token]);

  const escolher = async (n: number) => {
    setNota(n);
    setOcupado(true);
    try {
      const r = await chamar<{ destino: string | null; proximo: 'publico' | 'feedback' }>(token, 'nota', { nota: n });
      if (r.proximo === 'publico') setFase(irPara(r.destino) ? 'redirecionando' : 'obrigado');
      else setFase('feedback');
    } catch {
      setFase('erro');
    } finally {
      setOcupado(false);
    }
  };

  const enviarFeedback = async () => {
    if (!nota || !comentario.trim()) return;
    setOcupado(true);
    try {
      await chamar(token, 'feedback', { nota, comentario: comentario.trim() });
      setFase('obrigado');
    } catch {
      setFase('erro');
    } finally {
      setOcupado(false);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center bg-bg px-4 py-10">
      <div className="card w-full max-w-md p-6 text-center">
        <span className="icon-tile mx-auto h-12 w-12 rounded-2xl"><Icon name="star" size={22} /></span>

        {fase === 'carregando' && <p className="mt-4 text-sm text-muted" aria-busy="true">Carregando…</p>}

        {fase === 'redirecionando' && (
          <>
            <h1 className="mt-4 text-lg font-semibold text-fg">Obrigado!</h1>
            <p className="mt-1 text-sm text-muted">Estamos abrindo a página de avaliação{empresa ? ` de ${empresa}` : ''}.</p>
          </>
        )}

        {fase === 'nota' && (
          <>
            <h1 className="mt-4 text-lg font-semibold text-fg">Como foi sua experiência{empresa ? ` com ${empresa}` : ''}?</h1>
            <p className="mt-1 text-sm text-muted">Toque em uma nota de 1 a 5.</p>
            <div className="mt-5 flex justify-center gap-2" role="radiogroup" aria-label="Nota de 1 a 5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={nota === n}
                  aria-label={`${n}: ${ROTULO_NOTA[n - 1]}`}
                  disabled={ocupado}
                  onClick={() => void escolher(n)}
                  className={cx('grid h-12 w-12 place-items-center rounded-xl border text-base font-semibold tabular transition-colors', nota !== null && n <= nota ? 'border-brand bg-brand text-white' : 'border-line text-fg hover:border-brand')}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="mt-2 flex justify-between px-1 text-xs text-muted"><span>Muito ruim</span><span>Excelente</span></div>
          </>
        )}

        {fase === 'feedback' && (
          <>
            <h1 className="mt-4 text-lg font-semibold text-fg">Sentimos muito.</h1>
            <p className="mt-1 text-sm text-muted">Conte o que aconteceu. Sua mensagem vai direto para a equipe{empresa ? ` de ${empresa}` : ''}.</p>
            <Textarea className="mt-4 text-left" rows={5} maxLength={2000} showCount value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder="O que poderíamos ter feito melhor?" aria-label="Seu comentário" />
            <Button className="mt-3 w-full" loading={ocupado} disabled={!comentario.trim()} onClick={() => void enviarFeedback()}>Enviar</Button>
          </>
        )}

        {fase === 'obrigado' && (
          <>
            <h1 className="mt-4 text-lg font-semibold text-fg">Obrigado pela avaliação!</h1>
            <p className="mt-1 text-sm text-muted">Sua opinião ajuda{empresa ? ` ${empresa}` : ''} a melhorar.</p>
          </>
        )}

        {fase === 'invalido' && (
          <>
            <h1 className="mt-4 text-lg font-semibold text-fg">Link inválido</h1>
            <p className="mt-1 text-sm text-muted">Este link de avaliação não existe ou foi digitado errado.</p>
          </>
        )}

        {fase === 'erro' && (
          <>
            <h1 className="mt-4 text-lg font-semibold text-fg">Não foi possível abrir agora</h1>
            <p className="mt-1 text-sm text-muted">Tente de novo em instantes.</p>
            <Button className="mt-4" variant="soft" icon="refresh" onClick={() => window.location.reload()}>Tentar de novo</Button>
          </>
        )}
      </div>
    </main>
  );
}
