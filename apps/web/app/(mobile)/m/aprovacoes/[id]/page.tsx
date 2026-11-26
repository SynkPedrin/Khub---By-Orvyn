'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { Aviso, BotaoGrande, Cabecalho, Esqueleto, Folha, ImagemProtegida, StatusPill, Vazio, fmtDataHora, fmtRelativo, useVibrar } from '@/components/mobile/ui';
import { aprovacoes, ROTULO_TIPO, urlArquivo, type AprovacaoDetalhe, type Resposta } from '@/lib/aprovacoes';
import { ApiError } from '@/lib/api-error';

const ROTULO_ACAO: Record<string, string> = { aprovado: 'aprovou', ajustes: 'pediu ajustes', recusado: 'recusou', reenviado: 'enviou uma nova versão' };

function mensagemDeErro(e: unknown): string {
  if (e instanceof ApiError) {
    if (typeof e.body?.title === 'string' && e.status < 500) return e.body.title;
    if (e.status === 409) return 'Esta peça já foi respondida.';
  }
  return 'Não foi possível enviar. Verifique a internet e tente de novo.';
}

export default function DetalheAprovacaoMobile() {
  const { id } = useParams<{ id: string }>();
  const vibrar = useVibrar();
  const [a, setA] = useState<AprovacaoDetalhe | null>(null);
  const [naoAchou, setNaoAchou] = useState(false);
  const [ampliada, setAmpliada] = useState<string | null>(null);
  const [folha, setFolha] = useState<Resposta | null>(null);
  const [texto, setTexto] = useState('');
  const [comentario, setComentario] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const [feito, setFeito] = useState<Resposta | null>(null);

  const carregar = useCallback(() => {
    aprovacoes.detalhe(id).then(setA).catch(() => setNaoAchou(true));
  }, [id]);
  useEffect(() => { carregar(); }, [carregar]);

  const responder = async (acao: Resposta, msg?: string) => {
    setOcupado(true); setErro('');
    try {
      await aprovacoes.responder(id, acao, msg);
      vibrar(acao === 'aprovado' ? [15, 60, 25] : 15);
      setFeito(acao);
      window.dispatchEvent(new Event('khub:aprovacoes'));
      setFolha(null);
      setTexto('');
      carregar();
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setOcupado(false);
    }
  };

  const comentar = async () => {
    if (!comentario.trim()) return;
    setOcupado(true); setErro('');
    try {
      await aprovacoes.comentar(id, comentario);
      setComentario('');
      carregar();
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setOcupado(false);
    }
  };

  if (naoAchou) {
    return (
      <div>
        <Cabecalho titulo="Aprovação" voltar="/m/aprovacoes" />
        <Vazio icone="alert" titulo="Peça não encontrada" texto="Ela pode ter sido removida pela equipe." />
      </div>
    );
  }
  if (!a) {
    return (
      <div>
        <Cabecalho titulo="Aprovação" voltar="/m/aprovacoes" />
        <Esqueleto linhas={3} />
      </div>
    );
  }

  const imagens = a.arquivos.filter((x) => x.mime.startsWith('image/'));
  const pdfs = a.arquivos.filter((x) => x.mime === 'application/pdf');
  const pendente = a.status === 'pendente';

  return (
    <div className={pendente ? 'pb-28' : ''}>
      <Cabecalho
        titulo={a.titulo}
        voltar="/m/aprovacoes"
        sub={
          <span className="flex flex-wrap items-center gap-2 pt-1">
            <StatusPill status={a.status} />
            <span>{ROTULO_TIPO[a.tipo]}{a.canal ? ` · ${a.canal}` : ''}{a.versao > 1 ? ` · versão ${a.versao}` : ''}</span>
          </span>
        }
      />

      {feito && (
        <div className="mb-4 flex items-center gap-3 rounded-2xl bg-success-soft p-4 text-success" role="status">
          <Icon name="check2" size={22} />
          <p className="text-sm font-bold">{feito === 'aprovado' ? 'Aprovado! A equipe já foi avisada.' : feito === 'ajustes' ? 'Pedido de ajuste enviado para a equipe.' : 'Recusa enviada para a equipe.'}</p>
        </div>
      )}

      {/* Imagens: carrossel com deslize */}
      {imagens.length > 0 && (
        <section className="-mx-4 mb-4">
          <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 [scrollbar-width:none]">
            {imagens.map((img, i) => (
              <button key={img.id} type="button" onClick={() => setAmpliada(img.id)} className={cx('relative shrink-0 snap-center overflow-hidden rounded-3xl bg-surface2', imagens.length > 1 ? 'w-[86%]' : 'w-full')}>
                <ImagemProtegida src={urlArquivo(a.id, img.id)} alt={`${a.titulo} — imagem ${i + 1}`} className="max-h-[62vh] w-full object-contain" />
                {imagens.length > 1 && <span className="absolute right-3 top-3 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-bold text-white">{i + 1}/{imagens.length}</span>}
              </button>
            ))}
          </div>
          <p className="mt-2 px-4 text-center text-[11px] text-faint">Toque na imagem para ver em tela cheia</p>
        </section>
      )}

      {pdfs.length > 0 && (
        <section className="mb-4 space-y-2">
          {pdfs.map((p) => (
            <a key={p.id} href={urlArquivo(a.id, p.id)} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-2xl bg-surface p-4 active:scale-[0.99]">
              <Icon name="file" size={22} className="text-brand" />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{p.nome}</span>
              <Icon name="external" size={16} className="text-muted" />
            </a>
          ))}
        </section>
      )}

      {a.linkExterno && (
        <a href={a.linkExterno} target="_blank" rel="noreferrer noopener" className="mb-4 flex items-center gap-3 rounded-2xl border border-brand-border bg-brand-soft p-4 active:scale-[0.99]">
          <Icon name={a.tipo === 'video' ? 'play' : 'link'} size={22} className="text-brand" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold">{a.tipo === 'video' ? 'Assistir ao vídeo' : 'Abrir material'}</span>
            <span className="block truncate text-xs text-muted">{a.linkExterno.replace(/^https:\/\//, '')}</span>
          </span>
          <Icon name="external" size={16} className="text-muted" />
        </a>
      )}

      {a.conteudo && (
        <section className="mb-4 rounded-3xl bg-surface p-5">
          <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted"><Icon name="note" size={14} /> {a.tipo === 'roteiro' ? 'Roteiro' : 'Texto'}</h2>
          <div className="whitespace-pre-wrap text-[15px] leading-relaxed">{a.conteudo}</div>
        </section>
      )}

      {a.legenda && (
        <section className="mb-4 rounded-3xl bg-surface p-5">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Legenda</h2>
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{a.legenda}</p>
        </section>
      )}

      {(a.descricao || a.publicarEm || (a.prazoEm && pendente)) && (
        <section className="mb-4 space-y-2 rounded-3xl bg-surface p-5 text-sm">
          {a.descricao && <p className="whitespace-pre-wrap text-muted">{a.descricao}</p>}
          {a.publicarEm && <p className="flex items-center gap-2"><Icon name="calendar" size={15} className="text-muted" /> Publicação prevista: <strong>{fmtDataHora(a.publicarEm)}</strong></p>}
          {a.prazoEm && pendente && <p className="flex items-center gap-2"><Icon name="clock" size={15} className="text-muted" /> Responder até: <strong>{fmtDataHora(a.prazoEm)}</strong></p>}
        </section>
      )}

      {/* Histórico */}
      <section className="mb-4">
        <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted">Conversa</h2>
        {a.comentarios.length === 0 ? (
          <p className="text-sm text-faint">Sem comentários ainda.</p>
        ) : (
          <ol className="space-y-3">
            {a.comentarios.map((c) => (
              <li key={c.id} className="rounded-2xl bg-surface2 p-3.5">
                <p className="text-[13px]">
                  <strong>{c.autorNome || 'Alguém'}</strong>{' '}
                  {c.acao && <span className="text-muted">{ROTULO_ACAO[c.acao]}{c.acao === 'reenviado' ? ` (v${c.versao})` : ''}</span>}
                  <span className="text-faint"> · {fmtRelativo(c.createdAt)}</span>
                </p>
                {c.texto && <p className="mt-1 whitespace-pre-wrap text-sm">{c.texto}</p>}
              </li>
            ))}
          </ol>
        )}
        <div className="mt-3 flex items-end gap-2">
          <textarea
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
            rows={1}
            maxLength={2000}
            placeholder="Escreva um comentário…"
            className="input min-h-[46px] flex-1 resize-none rounded-2xl py-3 text-[15px]"
          />
          <button type="button" aria-label="Enviar comentário" disabled={ocupado || !comentario.trim()} onClick={comentar} className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-2xl bg-brand text-[#0b0b0b] disabled:opacity-40">
            <Icon name="send" size={18} />
          </button>
        </div>
        {erro && !folha && <div className="mt-3"><Aviso texto={erro} /></div>}
      </section>

      {/* Barra de decisão */}
      {pendente && (
        <div className="fixed inset-x-0 z-30 border-t border-line bg-surface px-4 pt-3" style={{ bottom: 'calc(4.1rem + env(safe-area-inset-bottom))', paddingBottom: '0.75rem' }}>
          <div className="mx-auto flex max-w-md gap-2">
            <BotaoGrande tom="neutro" className="flex-1" onClick={() => { setErro(''); setFolha('ajustes'); }}>
              <Icon name="edit" size={18} /> Pedir ajuste
            </BotaoGrande>
            <BotaoGrande className="flex-[1.3]" onClick={() => { setErro(''); setFolha('aprovado'); }}>
              <Icon name="check" size={18} /> Aprovar
            </BotaoGrande>
          </div>
        </div>
      )}

      <Folha aberta={folha === 'aprovado'} onFechar={() => setFolha(null)} titulo="Aprovar esta peça?">
        <p className="mb-4 text-sm text-muted">A equipe recebe o aviso na hora e segue com a publicação.</p>
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2} maxLength={2000} placeholder="Comentário (opcional)" className="input mb-4 w-full resize-none rounded-2xl text-[15px]" />
        {erro && <div className="mb-3"><Aviso texto={erro} /></div>}
        <div className="space-y-2">
          <BotaoGrande disabled={ocupado} onClick={() => responder('aprovado', texto)}>{ocupado ? 'Enviando…' : 'Sim, aprovar'}</BotaoGrande>
          <BotaoGrande tom="neutro" onClick={() => setFolha(null)}>Voltar</BotaoGrande>
        </div>
      </Folha>

      <Folha aberta={folha === 'ajustes' || folha === 'recusado'} onFechar={() => setFolha(null)} titulo={folha === 'recusado' ? 'Recusar esta peça' : 'O que precisa mudar?'}>
        <p className="mb-3 text-sm text-muted">{folha === 'recusado' ? 'Conte por que a peça não serve. A equipe será avisada.' : 'Descreva o ajuste. A equipe recebe o aviso e manda uma nova versão.'}</p>
        <textarea autoFocus value={texto} onChange={(e) => setTexto(e.target.value)} rows={4} maxLength={2000} placeholder={folha === 'recusado' ? 'Motivo da recusa' : 'Ex.: trocar a cor do fundo, aumentar o logo, mudar a frase do início…'} className="input mb-4 w-full resize-none rounded-2xl text-[15px]" />
        {erro && <div className="mb-3"><Aviso texto={erro} /></div>}
        <div className="space-y-2">
          <BotaoGrande tom={folha === 'recusado' ? 'perigo' : 'brand'} disabled={ocupado || !texto.trim()} onClick={() => responder(folha === 'recusado' ? 'recusado' : 'ajustes', texto)}>
            {ocupado ? 'Enviando…' : folha === 'recusado' ? 'Recusar peça' : 'Enviar pedido de ajuste'}
          </BotaoGrande>
          {folha === 'ajustes' && (
            <button type="button" onClick={() => setFolha('recusado')} className="w-full py-2 text-sm font-semibold text-danger">Recusar a peça inteira</button>
          )}
        </div>
      </Folha>

      {/* Tela cheia */}
      {ampliada && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black" role="dialog" aria-modal="true" aria-label="Imagem em tela cheia" onClick={() => setAmpliada(null)}>
          <ImagemProtegida src={urlArquivo(a.id, ampliada)} alt={a.titulo} className="max-h-full max-w-full object-contain" />
          <button type="button" aria-label="Fechar" className="absolute right-4 grid h-11 w-11 place-items-center rounded-full bg-white/15 text-white" style={{ top: 'calc(0.75rem + env(safe-area-inset-top))' }}>
            <Icon name="close" size={22} />
          </button>
        </div>
      )}
    </div>
  );
}
