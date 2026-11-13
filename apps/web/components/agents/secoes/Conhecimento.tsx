'use client';

import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { agentesApi, dataHora, inteiro, ROTULO_INTENCAO, type FonteConhecimento, type NovaFonte, type ResultadoBusca } from '@/lib/agents';
import { Abas, Alternar, BarraSalvar, Campo, Confirmar, Erro, Esqueleto, Gaveta, ListaTextos, Metrica, Modal, Numero, Painel, Vazio, useAcao, useCarga, useToast } from '../kit';
import { useCamposAgente, useSecaoConfig, type SecaoProps } from '../editor';

const LIMITE_BYTES = 15 * 1024 * 1024;
const EXTENSOES: Record<string, string> = { pdf: 'pdf', docx: 'docx', txt: 'txt', md: 'markdown', markdown: 'markdown', csv: 'csv' };
const ACEITOS = '.pdf,.docx,.txt,.md,.csv';

const ROTULO_TIPO: Record<string, string> = {
  pdf: 'PDF',
  docx: 'Word',
  txt: 'Texto',
  markdown: 'Markdown',
  csv: 'CSV',
  url: 'Página web',
  texto: 'Texto manual',
  faq: 'FAQ',
  catalogo: 'Catálogo',
  comercial: 'Comercial',
};
const STATUS: Record<FonteConhecimento['status'], { rotulo: string; tom: string }> = {
  pending: { rotulo: 'Na fila', tom: 'pill-info' },
  processing: { rotulo: 'Processando', tom: 'pill-info' },
  published: { rotulo: 'Publicado', tom: 'pill-success' },
  failed: { rotulo: 'Falhou', tom: 'pill-danger' },
  superseded: { rotulo: 'Substituído', tom: '' },
  candidate: { rotulo: 'Candidato', tom: 'pill-warning' },
};
const CONFIANCA: Record<ResultadoBusca['confianca']['nivel'], { rotulo: string; tom: string }> = {
  alta: { rotulo: 'Confiança alta', tom: 'pill-success' },
  media: { rotulo: 'Confiança média', tom: 'pill-info' },
  baixa: { rotulo: 'Confiança baixa', tom: 'pill-warning' },
  nenhuma: { rotulo: 'Sem resposta na base', tom: 'pill-danger' },
};
const TIPOS_MANUAIS: { valor: string; rotulo: string }[] = [
  { valor: 'texto', rotulo: 'Texto livre' },
  { valor: 'faq', rotulo: 'Perguntas frequentes' },
  { valor: 'catalogo', rotulo: 'Catálogo de produtos ou serviços' },
  { valor: 'comercial', rotulo: 'Condições comerciais' },
];

const tamanho = (b: number | null) => (b === null ? null : b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
const emAndamento = (f: FonteConhecimento) => f.status === 'pending' || f.status === 'processing';

function lerBase64(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => {
      const s = typeof leitor.result === 'string' ? leitor.result : '';
      const i = s.indexOf(',');
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    leitor.onerror = () => reject(new Error('Não foi possível ler o arquivo'));
    leitor.readAsDataURL(arquivo);
  });
}

/** Chips de seleção múltipla (aria-pressed). */
function Chips({ opcoes, valores, onChange, rotulo }: { opcoes: { valor: string; rotulo: string }[]; valores: string[]; onChange: (v: string[]) => void; rotulo: string }) {
  return (
    <div role="group" aria-label={rotulo} className="flex flex-wrap gap-1.5">
      {opcoes.map((o) => {
        const on = valores.includes(o.valor);
        return (
          <button key={o.valor} type="button" aria-pressed={on} onClick={() => onChange(on ? valores.filter((v) => v !== o.valor) : [...valores, o.valor])} className={cx('pill cursor-pointer', on ? 'pill-brand' : 'hover:bg-surface2')}>
            {on && <Icon name="check" size={11} />}
            {o.rotulo}
          </button>
        );
      })}
    </div>
  );
}

export function Conhecimento({ agente, catalogo, onAtualizado }: SecaoProps) {
  const toast = useToast();
  const { ocupado, executar } = useAcao();
  const lista = useCarga(() => agentesApi.conhecimento(agente.id), [agente.id]);
  const [filtro, setFiltro] = useState('__todas__');
  const [editar, setEditar] = useState<{ fonte: FonteConhecimento; titulo: string; categoria: string } | null>(null);
  const [ver, setVer] = useState<FonteConhecimento | null>(null);
  const [excluir, setExcluir] = useState<FonteConhecimento | null>(null);

  // Polling enquanto houver item na fila/processando (para quando não houver).
  const setDados = lista.setDados;
  const pendente = !!lista.dados?.itens.some(emAndamento);
  useEffect(() => {
    if (!pendente) return;
    const t = setInterval(() => {
      agentesApi.conhecimento(agente.id).then(setDados).catch(() => undefined);
    }, 4000);
    return () => clearInterval(t);
  }, [pendente, agente.id, setDados]);

  const atualizarLista = () => agentesApi.conhecimento(agente.id).then(setDados).catch(() => void lista.recarregar());
  const categorias = lista.dados?.resumo.categorias ?? [];
  const itens = (lista.dados?.itens ?? []).filter((i) => filtro === '__todas__' || i.categoria === filtro);

  const alternarAtivo = async (f: FonteConhecimento) => {
    const r = await executar(`ativo:${f.id}`, () => agentesApi.atualizarFonte(agente.id, f.id, { ativo: !f.ativo }), f.ativo ? 'Fonte desativada: o agente deixa de consultá-la' : 'Fonte ativada');
    if (r !== null) void atualizarLista();
  };
  const reprocessar = async (f: FonteConhecimento) => {
    const r = await executar(`rep:${f.id}`, () => agentesApi.reprocessarFonte(agente.id, f.id), 'Reprocessamento iniciado');
    if (r) void atualizarLista();
  };
  const salvarEdicao = async () => {
    if (!editar) return;
    const { fonte, titulo, categoria } = editar;
    const r = await executar('editar', () => agentesApi.atualizarFonte(agente.id, fonte.id, { titulo: titulo.trim(), categoria: categoria.trim() || undefined }), 'Fonte atualizada');
    if (r !== null) {
      setEditar(null);
      void atualizarLista();
    }
  };
  const confirmarExclusao = async () => {
    if (!excluir) return;
    const alvo = excluir;
    setExcluir(null);
    const r = await executar(`del:${alvo.id}`, () => agentesApi.removerFonte(agente.id, alvo.id));
    if (r) {
      toast('ok', r.documentoApagado ? 'Fonte excluída e documento apagado' : 'Fonte desvinculada (o documento continua em uso por outro agente)');
      void atualizarLista();
    }
  };

  return (
    <div className="space-y-5">
      <ConfigConhecimento agente={agente} catalogo={catalogo} onAtualizado={onAtualizado} />

      <Painel
        titulo="Fontes do agente"
        descricao="Documentos que o agente consulta para responder. Só o conteúdo publicado e ativo entra nas respostas."
        acao={<button className="btn btn-ghost btn-sm" onClick={() => void lista.recarregar()} disabled={lista.carregando}><Icon name="refresh" size={14} /> Atualizar</button>}
        corpo="p-0"
      >
        {lista.carregando && !lista.dados ? (
          <Esqueleto linhas={5} />
        ) : lista.erro && !lista.dados ? (
          <Erro texto={lista.erro} tentar={lista.recarregar} />
        ) : lista.dados ? (
          <>
            <div className="grid grid-cols-2 gap-3 px-5 pt-4 sm:grid-cols-3 lg:grid-cols-5">
              <Metrica rotulo="Fontes" valor={inteiro(lista.dados.resumo.total)} icone="knowledge" />
              <Metrica rotulo="Ativas" valor={inteiro(lista.dados.resumo.ativos)} icone="check" tom="success" />
              <Metrica rotulo="Processando" valor={inteiro(lista.dados.resumo.processando)} icone="clock" tom="info" detalhe={pendente ? 'Atualizando a cada 4 s' : undefined} />
              <Metrica rotulo="Falhas" valor={inteiro(lista.dados.resumo.falhas)} icone="alert" tom={lista.dados.resumo.falhas ? 'danger' : 'neutral'} />
              <Metrica rotulo="Trechos indexados" valor={inteiro(lista.dados.resumo.chunks)} icone="list" />
            </div>
            {categorias.length > 0 && (
              <div className="px-5 pt-4">
                <Abas
                  valor={filtro}
                  onChange={setFiltro}
                  opcoes={[{ valor: '__todas__', rotulo: 'Todas', contagem: lista.dados.itens.length }, ...categorias.map((c) => ({ valor: c, rotulo: c, contagem: lista.dados?.itens.filter((i) => i.categoria === c).length }))]}
                />
              </div>
            )}
            {itens.length === 0 ? (
              <Vazio icone="knowledge" titulo={lista.dados.itens.length ? 'Nenhuma fonte nesta categoria' : 'Nenhuma fonte ainda'} descricao={lista.dados.itens.length ? undefined : 'Envie um arquivo, uma página ou um texto abaixo. Sem fontes, o agente diz que vai confirmar com a equipe quando não souber.'} />
            ) : (
              <ul className="mt-4 divide-y divide-line border-t border-line">
                {itens.map((f) => {
                  const st = STATUS[f.status];
                  return (
                    <li key={f.id} className="px-5 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="icon-tile icon-tile-neutral h-7 w-7 rounded-md"><Icon name={f.tipo === 'url' ? 'globe' : 'file'} size={14} /></span>
                            <span className="min-w-0 truncate text-[14px] font-medium text-fg">{f.titulo}</span>
                            <span className={cx('pill', st.tom)}>
                              {emAndamento(f) && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-info" />}
                              {st.rotulo}
                            </span>
                            {!f.ativo && <span className="pill">Desativada</span>}
                          </div>
                          <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                            <span>{ROTULO_TIPO[f.tipo] ?? f.tipo}</span>
                            <span>Categoria: {f.categoria}</span>
                            <span>{inteiro(f.chunks)} trechos</span>
                            {tamanho(f.tamanhoBytes) && <span>{tamanho(f.tamanhoBytes)}</span>}
                            <span>v{f.versao}</span>
                            <span>Enviado {dataHora(f.createdAt)}</span>
                            {f.processadoEm && <span>Processado {dataHora(f.processadoEm)}</span>}
                          </p>
                          {f.indexacao === 'lexical' && (
                            <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted"><Icon name="info" size={13} className="mt-px shrink-0" /> Só busca por palavras: conecte a Voyage e reprocesse para busca semântica.</p>
                          )}
                          {f.indexacao === 'hibrida' && <p className="mt-1.5 text-xs text-success">Busca semântica e por palavras</p>}
                          {f.status === 'failed' && f.erro && <p className="mt-1.5 rounded-lg border border-danger-border bg-danger-soft px-2.5 py-1.5 text-xs text-fg">{f.erro}</p>}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={f.ativo}
                            aria-label={f.ativo ? `Desativar ${f.titulo}` : `Ativar ${f.titulo}`}
                            disabled={ocupado === `ativo:${f.id}`}
                            onClick={() => void alternarAtivo(f)}
                            className={cx('relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-60', f.ativo ? 'bg-brand' : 'bg-surface3')}
                          >
                            <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', f.ativo ? 'translate-x-[18px]' : 'translate-x-0.5')} />
                          </button>
                          <button className="btn btn-ghost btn-sm btn-icon" aria-label={`Ver conteúdo de ${f.titulo}`} title="Ver conteúdo" onClick={() => setVer(f)}><Icon name="eye" size={14} /></button>
                          <button className="btn btn-ghost btn-sm btn-icon" aria-label={`Editar ${f.titulo}`} title="Editar título e categoria" onClick={() => setEditar({ fonte: f, titulo: f.titulo, categoria: f.categoria })}><Icon name="edit" size={14} /></button>
                          <button className="btn btn-ghost btn-sm btn-icon" aria-label={`Reprocessar ${f.titulo}`} title="Reprocessar" disabled={emAndamento(f) || ocupado === `rep:${f.id}`} onClick={() => void reprocessar(f)}><Icon name="refresh" size={14} /></button>
                          <button className="btn btn-ghost btn-sm btn-icon" aria-label={`Excluir ${f.titulo}`} title="Excluir" disabled={ocupado === `del:${f.id}`} onClick={() => setExcluir(f)}><Icon name="trash" size={14} /></button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : null}
      </Painel>

      <AdicionarFonte agenteId={agente.id} categorias={categorias} onAdicionado={() => void atualizarLista()} />

      <Testador agenteId={agente.id} categorias={categorias} escopos={catalogo.escopos} />

      <Modal
        aberto={!!editar}
        onFechar={() => setEditar(null)}
        titulo="Editar fonte"
        rodape={<><button className="btn btn-ghost" onClick={() => setEditar(null)}>Cancelar</button><button className="btn btn-primary" disabled={!editar?.titulo.trim() || ocupado === 'editar'} onClick={() => void salvarEdicao()}>{ocupado === 'editar' ? 'Salvando…' : 'Salvar'}</button></>}
      >
        {editar && (
          <div className="space-y-4">
            <Campo rotulo="Título">
              <input className="input" value={editar.titulo} maxLength={200} onChange={(e) => setEditar({ ...editar, titulo: e.target.value })} />
            </Campo>
            <Campo rotulo="Categoria" dica="Usada para filtrar o que o agente consulta.">
              <input className="input" list="kb-categorias-editar" value={editar.categoria} maxLength={60} onChange={(e) => setEditar({ ...editar, categoria: e.target.value })} />
              <datalist id="kb-categorias-editar">{categorias.map((c) => <option key={c} value={c} />)}</datalist>
            </Campo>
          </div>
        )}
      </Modal>

      <Gaveta aberto={!!ver} onFechar={() => setVer(null)} titulo={ver ? ver.titulo : 'Conteúdo'}>
        {ver && <ConteudoFonte agenteId={agente.id} fonteId={ver.id} />}
      </Gaveta>

      <Confirmar
        aberto={!!excluir}
        titulo="Excluir fonte"
        texto={<p>&quot;{excluir?.titulo}&quot; sai da base deste agente. Se nenhum outro agente usar o documento, ele e seus trechos são apagados.</p>}
        confirmar="Excluir"
        perigo
        onConfirmar={() => void confirmarExclusao()}
        onFechar={() => setExcluir(null)}
      />
    </div>
  );
}

// ------------------------------------------------------------------ configuração

function ConfigConhecimento({ agente, catalogo, onAtualizado }: SecaoProps) {
  const toast = useToast();
  const cfg = useSecaoConfig(agente, 'conhecimento', onAtualizado);
  const cols = useCamposAgente(agente, (a) => ({ conhecimentoAtivo: a.conhecimentoAtivo, conhecimentoEscopos: a.conhecimentoEscopos }), onAtualizado);
  const r = cfg.rascunho;
  const ativo = cols.rascunho.conhecimentoAtivo ?? false;
  const escopos = cols.rascunho.conhecimentoEscopos ?? [];
  const maxOk = Number.isInteger(r.maxTrechos) && r.maxTrechos >= 1 && r.maxTrechos <= 12;

  const salvar = async () => {
    if (!maxOk) {
      toast('erro', 'Trechos por consulta: entre 1 e 12');
      return;
    }
    if (cols.sujo) await cols.salvar(cfg.sujo ? { config: { conhecimento: r } } : undefined);
    else await cfg.salvar();
  };

  return (
    <Painel titulo="Como o agente usa a base" descricao="Ligue a consulta, escolha os níveis de conhecimento e quando consultar antes de responder.">
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Alternar ligado={ativo} onChange={(v) => cols.setRascunho({ ...cols.rascunho, conhecimentoAtivo: v })} rotulo="Consultar a base de conhecimento" descricao="Desligado, o agente não busca em nenhuma fonte e a ferramenta de busca fica indisponível." />
          <Alternar ligado={r.somenteFontesDoAgente} onChange={(v) => cfg.set('somenteFontesDoAgente', v)} rotulo="Só as fontes deste agente" descricao="Ligado, ignora documentos da empresa que não estão vinculados aqui." />
        </div>
        <div>
          <span className="mb-1.5 block text-[13px] font-medium text-fg">Níveis de conhecimento consultados</span>
          <Chips rotulo="Níveis de conhecimento" opcoes={catalogo.escopos.map((e) => ({ valor: e.id, rotulo: e.nome }))} valores={escopos} onChange={(v) => cols.setRascunho({ ...cols.rascunho, conhecimentoEscopos: v })} />
          {escopos.length === 0 && <p className="mt-1.5 text-xs text-muted">Nenhum nível marcado: o servidor usa o padrão da empresa.</p>}
        </div>
        <div>
          <span className="mb-1.5 block text-[13px] font-medium text-fg">Consultar antes de responder quando a intenção for</span>
          <Chips rotulo="Intenções que disparam consulta" opcoes={catalogo.intencoesBase.map((i) => ({ valor: i, rotulo: ROTULO_INTENCAO[i] ?? i }))} valores={r.consultarEm} onChange={(v) => cfg.set('consultarEm', v)} />
        </div>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_200px]">
          <div>
            <span className="mb-1.5 block text-[13px] font-medium text-fg">Categorias consultadas</span>
            <ListaTextos valores={r.categorias} onChange={(v) => cfg.set('categorias', v.map((c) => c.slice(0, 60)))} placeholder="Ex.: precos" max={30} />
            <p className="mt-1 text-xs text-muted">Vazio = todas as categorias.</p>
          </div>
          <Campo rotulo="Trechos por consulta" dica="1 a 12.">
            <Numero valor={r.maxTrechos} onChange={(v) => cfg.set('maxTrechos', v)} min={1} max={12} />
          </Campo>
        </div>
      </div>
      <BarraSalvar sujo={cfg.sujo || cols.sujo} salvando={cfg.salvando || cols.salvando} onSalvar={() => void salvar()} onDescartar={() => { cfg.descartar(); cols.descartar(); }} />
    </Painel>
  );
}

// ------------------------------------------------------------------ adicionar fontes

type Modo = 'arquivo' | 'url' | 'texto' | 'reaproveitar';

function AdicionarFonte({ agenteId, categorias, onAdicionado }: { agenteId: string; categorias: string[]; onAdicionado: () => void }) {
  const toast = useToast();
  const { ocupado, executar } = useAcao();
  const [modo, setModo] = useState<Modo>('arquivo');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [titulo, setTitulo] = useState('');
  const [categoria, setCategoria] = useState('');
  const [url, setUrl] = useState('');
  const [tipoTexto, setTipoTexto] = useState('texto');
  const [texto, setTexto] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const limpar = () => {
    setArquivo(null);
    setErroArquivo(null);
    setTitulo('');
    setUrl('');
    setTexto('');
    if (input.current) input.current.value = '';
  };

  const escolher = (f: File | undefined) => {
    setErroArquivo(null);
    if (!f) return;
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    if (!EXTENSOES[ext]) {
      setArquivo(null);
      setErroArquivo(`Formato não aceito (.${ext}). Envie PDF, DOCX, TXT, MD ou CSV.`);
      return;
    }
    if (f.size > LIMITE_BYTES) {
      setArquivo(null);
      setErroArquivo(`O arquivo tem ${tamanho(f.size)}. O limite é 15 MB: divida o documento ou comprima as imagens.`);
      return;
    }
    setArquivo(f);
    if (!titulo.trim()) setTitulo(f.name.replace(/\.[^.]+$/, '').slice(0, 200));
  };

  const soltar = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setArrastando(false);
    escolher(e.dataTransfer.files[0]);
  };

  const enviar = async () => {
    let fonte: NovaFonte | null = null;
    const base = { titulo: titulo.trim(), categoria: categoria.trim() || undefined };
    if (modo === 'arquivo' && arquivo) {
      const ext = arquivo.name.split('.').pop()?.toLowerCase() ?? '';
      const tipo = EXTENSOES[ext];
      if (!tipo) return;
      let b64: string;
      try {
        b64 = await lerBase64(arquivo);
      } catch {
        toast('erro', 'Não foi possível ler o arquivo');
        return;
      }
      fonte = { ...base, tipo, arquivoBase64: b64, nomeArquivo: arquivo.name };
    } else if (modo === 'url') {
      fonte = { ...base, tipo: 'url', url: url.trim() };
    } else if (modo === 'texto') {
      fonte = { ...base, tipo: tipoTexto, texto };
    }
    if (!fonte) return;
    const enviado = fonte;
    const r = await executar('enviar', () => agentesApi.adicionarFonte(agenteId, enviado));
    if (r) {
      toast('ok', r.duplicado ? 'Esse conteúdo já existia: a fonte foi vinculada sem duplicar' : 'Fonte enviada. O processamento começa em instantes.');
      limpar();
      onAdicionado();
    }
  };

  const urlOk = /^https?:\/\/\S+\.\S+/.test(url.trim());
  const podeEnviar =
    titulo.trim().length > 0 &&
    ocupado !== 'enviar' &&
    ((modo === 'arquivo' && !!arquivo) || (modo === 'url' && urlOk) || (modo === 'texto' && texto.trim().length > 0));

  const campoCategoria = (
    <Campo rotulo="Categoria" dica="Opcional. Agrupa fontes e permite filtrar o que o agente consulta.">
      <input className="input" list="kb-categorias-nova" value={categoria} maxLength={60} placeholder="Ex.: precos" onChange={(e) => setCategoria(e.target.value)} />
      <datalist id="kb-categorias-nova">{categorias.map((c) => <option key={c} value={c} />)}</datalist>
    </Campo>
  );
  const campoTitulo = (
    <Campo rotulo="Título">
      <input className="input" value={titulo} maxLength={200} placeholder="Ex.: Tabela de preços 2026" onChange={(e) => setTitulo(e.target.value)} />
    </Campo>
  );

  return (
    <Painel titulo="Adicionar conhecimento" descricao="Arquivos, páginas e textos são extraídos, divididos em trechos e indexados no servidor.">
      <Abas<Modo>
        valor={modo}
        onChange={setModo}
        opcoes={[
          { valor: 'arquivo', rotulo: 'Arquivo' },
          { valor: 'url', rotulo: 'Adicionar por URL' },
          { valor: 'texto', rotulo: 'Texto manual' },
          { valor: 'reaproveitar', rotulo: 'Reaproveitar documento' },
        ]}
      />

      <div className="mt-4">
        {modo === 'arquivo' && (
          <div className="space-y-4">
            <div
              role="button"
              tabIndex={0}
              aria-label="Selecionar arquivo para enviar"
              onClick={() => input.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click(); } }}
              onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
              onDragLeave={() => setArrastando(false)}
              onDrop={soltar}
              className={cx('flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line px-4 py-8 text-center transition-colors hover:bg-surface2/60', arrastando && 'border-brand bg-brand-softer/60')}
            >
              <span className="icon-tile icon-tile-neutral h-10 w-10 rounded-lg"><Icon name="upload" size={18} /></span>
              {arquivo ? (
                <>
                  <span className="max-w-full truncate text-[14px] font-medium text-fg">{arquivo.name}</span>
                  <span className="text-xs text-muted">{tamanho(arquivo.size)} · clique para trocar</span>
                </>
              ) : (
                <>
                  <span className="text-[14px] font-medium text-fg">Arraste um arquivo aqui ou clique para escolher</span>
                  <span className="text-xs text-muted">PDF, DOCX, TXT, MD ou CSV · até 15 MB</span>
                </>
              )}
              <input ref={input} type="file" accept={ACEITOS} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => escolher(e.target.files?.[0])} />
            </div>
            {erroArquivo && <p role="alert" className="rounded-xl border border-danger-border bg-danger-soft px-3.5 py-2.5 text-[13px] text-fg">{erroArquivo}</p>}
            <div className="grid gap-4 md:grid-cols-2">
              {campoTitulo}
              {campoCategoria}
            </div>
          </div>
        )}

        {modo === 'url' && (
          <div className="grid gap-4 md:grid-cols-2">
            <Campo rotulo="Endereço da página" className="md:col-span-2" dica="A página precisa ser pública. O texto é extraído uma vez; reprocesse para atualizar.">
              <input className="input" type="url" inputMode="url" value={url} maxLength={2000} placeholder="https://suaempresa.com.br/precos" onChange={(e) => setUrl(e.target.value)} aria-invalid={!!url && !urlOk} />
            </Campo>
            {campoTitulo}
            {campoCategoria}
          </div>
        )}

        {modo === 'texto' && (
          <div className="grid gap-4 md:grid-cols-2">
            <Campo rotulo="Tipo de conteúdo">
              <select className="select" value={tipoTexto} onChange={(e) => setTipoTexto(e.target.value)}>
                {TIPOS_MANUAIS.map((t) => <option key={t.valor} value={t.valor}>{t.rotulo}</option>)}
              </select>
            </Campo>
            {campoTitulo}
            {campoCategoria}
            <Campo rotulo="Conteúdo" className="md:col-span-2" dica={tipoTexto === 'faq' ? 'Escreva cada pergunta seguida da resposta.' : undefined}>
              <textarea className="textarea" rows={8} maxLength={600000} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Cole ou escreva o conteúdo" />
            </Campo>
          </div>
        )}

        {modo === 'reaproveitar' && <Reaproveitar agenteId={agenteId} categorias={categorias} onVinculado={onAdicionado} />}

        {modo !== 'reaproveitar' && (
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button className="btn btn-ghost btn-sm" onClick={limpar} disabled={ocupado === 'enviar'}>Limpar</button>
            <button className="btn btn-primary btn-sm" disabled={!podeEnviar} onClick={() => void enviar()}>
              <Icon name="upload" size={14} /> {ocupado === 'enviar' ? 'Enviando…' : 'Adicionar à base'}
            </button>
          </div>
        )}
      </div>
    </Painel>
  );
}

function Reaproveitar({ agenteId, categorias, onVinculado }: { agenteId: string; categorias: string[]; onVinculado: () => void }) {
  const docs = useCarga(() => agentesApi.documentosDisponiveis(agenteId), [agenteId]);
  const { ocupado, executar } = useAcao();
  const [categoria, setCategoria] = useState('');
  const [busca, setBusca] = useState('');

  const vincular = async (documentId: string) => {
    const r = await executar(`vinc:${documentId}`, () => agentesApi.vincularDocumento(agenteId, documentId, categoria.trim() || undefined), 'Documento vinculado a este agente');
    if (r !== null) {
      void docs.recarregar();
      onVinculado();
    }
  };

  if (docs.carregando && !docs.dados) return <Esqueleto linhas={3} />;
  if (docs.erro && !docs.dados) return <Erro texto={docs.erro} tentar={docs.recarregar} />;
  const lista = (docs.dados ?? []).filter((d) => !busca.trim() || d.titulo.toLowerCase().includes(busca.trim().toLowerCase()));

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted">Documentos já enviados para a empresa (por outros agentes ou pela base geral) podem ser usados aqui sem reenviar.</p>
      <div className="grid gap-4 md:grid-cols-2">
        <Campo rotulo="Buscar documento">
          <input className="input" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Título" />
        </Campo>
        <Campo rotulo="Categoria neste agente" dica="Opcional.">
          <input className="input" list="kb-categorias-vincular" value={categoria} maxLength={60} onChange={(e) => setCategoria(e.target.value)} />
          <datalist id="kb-categorias-vincular">{categorias.map((c) => <option key={c} value={c} />)}</datalist>
        </Campo>
      </div>
      {lista.length === 0 ? (
        <Vazio icone="file" titulo={docs.dados?.length ? 'Nenhum documento encontrado' : 'Nenhum documento disponível'} descricao={docs.dados?.length ? undefined : 'Todos os documentos da empresa já estão vinculados a este agente.'} />
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {lista.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-3">
              <div className="min-w-0">
                <p className="truncate text-[13.5px] font-medium text-fg">{d.titulo}</p>
                <p className="text-xs text-muted">{ROTULO_TIPO[d.fonte] ?? d.fonte} · {d.status} · {dataHora(d.createdAt)}</p>
              </div>
              <button className="btn btn-soft btn-sm" disabled={ocupado === `vinc:${d.id}`} onClick={() => void vincular(d.id)}><Icon name="link" size={14} /> Vincular</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ conteúdo e testador

function ConteudoFonte({ agenteId, fonteId }: { agenteId: string; fonteId: string }) {
  const c = useCarga(() => agentesApi.conteudoFonte(agenteId, fonteId), [agenteId, fonteId]);
  const [aba, setAba] = useState<'trechos' | 'texto'>('trechos');
  if (c.carregando && !c.dados) return <Esqueleto linhas={6} />;
  if (c.erro || !c.dados) return <Erro texto={c.erro ?? 'Conteúdo indisponível'} tentar={c.recarregar} />;
  const d = c.dados;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="pill">{ROTULO_TIPO[d.fonte] ?? d.fonte}</span>
        <span>{d.status}</span>
        {d.uri && <a className="inline-flex items-center gap-1 text-brand hover:underline" href={d.uri} target="_blank" rel="noreferrer noopener"><Icon name="external" size={12} /> Abrir origem</a>}
      </div>
      {d.erro && <p className="rounded-xl border border-danger-border bg-danger-soft px-3.5 py-2.5 text-[13px] text-fg">{d.erro}</p>}
      <Abas valor={aba} onChange={setAba} opcoes={[{ valor: 'trechos', rotulo: 'Trechos', contagem: d.chunks.length }, { valor: 'texto', rotulo: 'Texto extraído' }]} />
      {aba === 'texto' ? (
        d.textoFonte ? <pre className="whitespace-pre-wrap break-words rounded-xl border border-line bg-surface2/60 p-3.5 text-[12.5px] leading-relaxed text-fg">{d.textoFonte}</pre> : <Vazio icone="file" titulo="Sem texto extraído" descricao="O documento ainda não foi processado ou não tinha texto legível." />
      ) : d.chunks.length === 0 ? (
        <Vazio icone="list" titulo="Nenhum trecho" descricao="Os trechos aparecem depois do processamento." />
      ) : (
        <ol className="space-y-2.5">
          {d.chunks.map((ch) => (
            <li key={ch.id} className="rounded-xl border border-line p-3.5">
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className="tabular">#{ch.ordem}</span>
                {ch.breadcrumb && <span className="truncate">{ch.breadcrumb}</span>}
                <span className="ml-auto tabular">{inteiro(ch.tokens)} tokens</span>
              </p>
              <p className="mt-1.5 whitespace-pre-wrap break-words text-[13px] text-fg">{ch.conteudo}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Testador({ agenteId, categorias, escopos }: { agenteId: string; categorias: string[]; escopos: { id: string; nome: string }[] }) {
  const nomeEscopo = (e: string) => escopos.find((x) => x.id === e)?.nome ?? e;
  const { ocupado, executar } = useAcao();
  const [pergunta, setPergunta] = useState('');
  const [cats, setCats] = useState<string[]>([]);
  const [res, setRes] = useState<ResultadoBusca | null>(null);
  const ok = pergunta.trim().length >= 2;

  const testar = async () => {
    if (!ok) return;
    const r = await executar('testar', () => agentesApi.testarConhecimento(agenteId, pergunta.trim(), cats.length ? cats : undefined));
    if (r) setRes(r);
  };

  return (
    <Painel titulo="Testar a base" descricao="Faça uma pergunta como um cliente faria e veja o que o agente encontraria, com a mesma configuração salva.">
      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); void testar(); }}>
        <label className="sr-only" htmlFor="kb-pergunta">Pergunta de teste</label>
        <input id="kb-pergunta" className="input" value={pergunta} maxLength={500} placeholder="Ex.: quanto custa a consulta?" onChange={(e) => setPergunta(e.target.value)} />
        <button type="submit" className="btn btn-primary btn-sm shrink-0" disabled={!ok || ocupado === 'testar'}><Icon name="search" size={14} /> {ocupado === 'testar' ? 'Buscando…' : 'Testar'}</button>
      </form>
      {categorias.length > 0 && (
        <div className="mt-3">
          <span className="mb-1.5 block text-xs text-muted">Filtrar por categoria (opcional)</span>
          <Chips rotulo="Categorias do teste" opcoes={categorias.map((c) => ({ valor: c, rotulo: c }))} valores={cats} onChange={setCats} />
        </div>
      )}
      {res && (
        <div className="mt-5 space-y-3" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cx('pill', CONFIANCA[res.confianca.nivel].tom)}>{CONFIANCA[res.confianca.nivel].rotulo}</span>
            <span className="text-[13px] text-muted">{res.confianca.motivo}</span>
          </div>
          <p className="text-xs text-faint">
            {inteiro(res.latenciaMs)} ms · níveis: {res.escopos.map(nomeEscopo).join(', ') || 'padrão'}{res.filtradoPorFontes ? ' · só fontes do agente' : ''}
          </p>
          {res.conflitos.length > 0 && (
            <div role="alert" className="rounded-xl border border-warning-border bg-warning-soft px-3.5 py-2.5 text-[13px] text-fg">
              <p className="flex items-center gap-1.5 font-medium"><Icon name="alert" size={14} /> Informação conflitante</p>
              <ul className="mt-1 list-disc pl-5">{res.conflitos.map((c) => <li key={c}>{c}</li>)}</ul>
              <p className="mt-1 text-xs text-muted">Nesses casos o agente não escolhe um valor: diz que vai confirmar com a equipe.</p>
            </div>
          )}
          {res.hits.length === 0 ? (
            <Vazio icone="search" titulo="Nenhum trecho encontrado" descricao="O agente diria que vai confirmar com a equipe. Adicione uma fonte que responda essa pergunta." />
          ) : (
            <ol className="space-y-2.5">
              {res.hits.map((h, i) => (
                <li key={h.chunkId} className="rounded-xl border border-line p-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs tabular text-faint">{i + 1}.</span>
                    <span className="min-w-0 truncate text-[13.5px] font-medium text-fg">{h.titulo}</span>
                    <span className="pill">{nomeEscopo(h.escopo)}</span>
                    <span className="ml-auto text-xs tabular text-muted">score {h.score.toFixed(3)}</span>
                  </div>
                  {h.breadcrumb && <p className="mt-1 truncate text-xs text-muted">{h.breadcrumb}</p>}
                  <p className="mt-1.5 line-clamp-4 whitespace-pre-wrap break-words text-[13px] text-fg">{h.conteudo}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </Painel>
  );
}
