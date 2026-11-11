'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, Input, cx } from '@/components/ui';
import { Button, Confirm, Modal, Select, SkeletonRows, Switch, TabPanel, Tabs, useToast } from '@/components/kit';
import { Icon } from '@/components/icons';
import { EmptyState, ErrorState } from '@/components/revenue/States';
import { ApiError } from '@/lib/api-error';
import {
  ENTIDADES, TIPOS, customFields, mensagemErro, rotuloTipo, temOpcoes,
  type CampoDef, type CampoInput, type EntidadeCampo, type TipoCampo,
} from '@/lib/custom-fields';

interface Rascunho {
  rotulo: string;
  tipo: TipoCampo;
  opcoes: string;
  obrigatorio: boolean;
  grupo: string;
}
const NOVO: Rascunho = { rotulo: '', tipo: 'text', opcoes: '', obrigatorio: false, grupo: '' };
const linhasOpcoes = (s: string) => s.split('\n').map((o) => o.trim()).filter(Boolean);

/**
 * Configurações › Campos personalizados (Q2.3): definições por entidade.
 * Arquivar tira o campo do formulário e do filtro sem apagar os valores;
 * excluir só é aceito pela API quando nenhum registro tem valor.
 */
export function CamposPersonalizadosTab() {
  const [entidade, setEntidade] = useState<EntidadeCampo>('contact');
  const [lista, setLista] = useState<CampoDef[] | null>(null);
  const [erro, setErro] = useState(false);
  const [editor, setEditor] = useState<{ aberto: boolean; def: CampoDef | null }>({ aberto: false, def: null });
  const [excluir, setExcluir] = useState<CampoDef | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const toast = useToast();

  const carregar = useCallback(async () => {
    setErro(false);
    try {
      setLista(await customFields.list(entidade));
    } catch {
      setErro(true);
      setLista([]);
    }
  }, [entidade]);
  useEffect(() => { setLista(null); carregar(); }, [carregar]);

  const ativos = (lista ?? []).filter((d) => !d.arquivado);
  const arquivados = (lista ?? []).filter((d) => d.arquivado);

  const mover = async (id: string, delta: -1 | 1) => {
    const ids = ativos.map((d) => d.id);
    const i = ids.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    // otimista: a lista troca na hora; se a API recusar, recarrega
    setLista((l) => (l ? [...ids.map((x) => l.find((d) => d.id === x)!), ...arquivados] : l));
    try {
      setLista(await customFields.reordenar(entidade, [...ids, ...arquivados.map((d) => d.id)]));
    } catch (e) {
      toast.error(mensagemErro(e, 'Não consegui reordenar'));
      carregar();
    }
  };

  const arrastar = useArrastar(ativos, (ids) => {
    setLista((l) => (l ? [...ids.map((x) => l.find((d) => d.id === x)!), ...arquivados] : l));
    customFields.reordenar(entidade, [...ids, ...arquivados.map((d) => d.id)]).then(setLista).catch((e) => { toast.error(mensagemErro(e, 'Não consegui reordenar')); carregar(); });
  });

  const alternarArquivo = async (d: CampoDef) => {
    setOcupado(d.id);
    try {
      if (d.arquivado) await customFields.restaurar(d.id);
      else await customFields.arquivar(d.id);
      toast.success(d.arquivado ? `"${d.rotulo}" voltou ao formulário` : `"${d.rotulo}" arquivado. Os valores foram mantidos.`);
      await carregar();
    } catch (e) {
      toast.error(mensagemErro(e, 'Não consegui alterar o campo'));
    } finally {
      setOcupado(null);
    }
  };

  const confirmarExclusao = async () => {
    if (!excluir) return;
    setOcupado(excluir.id);
    try {
      await customFields.remove(excluir.id);
      toast.success(`Campo "${excluir.rotulo}" excluído`);
      setExcluir(null);
      await carregar();
    } catch (e) {
      const emUso = e instanceof ApiError && e.status === 409;
      toast.error(emUso ? 'Este campo tem valores gravados: arquive em vez de excluir.' : mensagemErro(e, 'Não consegui excluir o campo'));
      setExcluir(null);
    } finally {
      setOcupado(null);
    }
  };

  return (
    <div className="space-y-5">
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-bold text-fg">Campos personalizados</h2>
            <p className="mt-0.5 text-xs text-muted">Dados próprios do seu negócio no cadastro de contatos, negócios e empresas. Aparecem no perfil, podem ser obrigatórios e filtram a lista de leads.</p>
          </div>
          <Button variant="primary" icon="plus" onClick={() => setEditor({ aberto: true, def: null })}>Novo campo</Button>
        </div>
        <div className="mt-4">
          <Tabs
            items={ENTIDADES.map((e) => ({ value: e.key, label: e.label }))}
            value={entidade}
            onChange={(v) => setEntidade(v)}
            label="Entidade dos campos"
            idBase="campos-entidade"
            variant="segmented"
          />
        </div>
      </Card>

      <TabPanel idBase="campos-entidade" value={entidade} active>
      <Card className="overflow-hidden p-0">
        {lista === null ? (
          <div className="p-5"><SkeletonRows rows={4} /></div>
        ) : erro ? (
          <ErrorState description="Não consegui carregar os campos personalizados." onRetry={carregar} />
        ) : ativos.length === 0 && arquivados.length === 0 ? (
          <EmptyState
            icon="list"
            title="Nenhum campo ainda"
            description="Crie campos como convênio, data de nascimento ou plano contratado. Eles aparecem no perfil de cada registro."
            action={<Button variant="primary" icon="plus" onClick={() => setEditor({ aberto: true, def: null })}>Criar o primeiro campo</Button>}
          />
        ) : (
          <>
            <ul className="divide-y divide-line" aria-label="Campos ativos">
              {ativos.map((d, i) => (
                <li
                  key={d.id}
                  {...arrastar.props(d.id)}
                  className={cx('flex items-center gap-3 px-5 py-3', arrastar.sobre === d.id && 'bg-surface2')}
                >
                  <span className="cursor-grab text-faint" aria-hidden title="Arraste para reordenar"><Icon name="grid" size={14} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-fg">
                      {d.rotulo}
                      {d.obrigatorio && <span className="ml-2 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand">Obrigatório</span>}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {rotuloTipo(d.tipo)}
                      {temOpcoes(d.tipo) && ` · ${d.opcoes.length} opç${d.opcoes.length === 1 ? 'ão' : 'ões'}`}
                      {d.grupo && ` · ${d.grupo}`}
                      {' · '}<code className="text-faint">cf_{d.chave}</code>
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" iconOnly icon="arrowUp" aria-label={`Subir ${d.rotulo}`} disabled={i === 0} onClick={() => mover(d.id, -1)} />
                    <Button variant="ghost" size="sm" iconOnly icon="arrowDown" aria-label={`Descer ${d.rotulo}`} disabled={i === ativos.length - 1} onClick={() => mover(d.id, 1)} />
                    <Button variant="ghost" size="sm" iconOnly icon="edit" aria-label={`Editar ${d.rotulo}`} onClick={() => setEditor({ aberto: true, def: d })} />
                    <Button variant="ghost" size="sm" loading={ocupado === d.id} onClick={() => alternarArquivo(d)}>Arquivar</Button>
                  </div>
                </li>
              ))}
              {ativos.length === 0 && <li className="px-5 py-6 text-center text-sm text-muted">Nenhum campo ativo. Restaure um arquivado ou crie um novo.</li>}
            </ul>
            {arquivados.length > 0 && (
              <div className="border-t border-line">
                <p className="px-5 pt-4 text-xs font-semibold uppercase tracking-wide text-faint">Arquivados ({arquivados.length})</p>
                <ul className="divide-y divide-line" aria-label="Campos arquivados">
                  {arquivados.map((d) => (
                    <li key={d.id} className="flex items-center gap-3 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-muted">{d.rotulo}</p>
                        <p className="truncate text-xs text-faint">{rotuloTipo(d.tipo)} · valores mantidos nos registros</p>
                      </div>
                      <Button variant="ghost" size="sm" loading={ocupado === d.id} onClick={() => alternarArquivo(d)}>Restaurar</Button>
                      <Button variant="ghost" size="sm" iconOnly icon="trash" aria-label={`Excluir ${d.rotulo}`} onClick={() => setExcluir(d)} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </Card>
      </TabPanel>

      <EditorCampo
        aberto={editor.aberto}
        def={editor.def}
        entidade={entidade}
        onClose={() => setEditor({ aberto: false, def: null })}
        onSalvo={async (d, novo) => {
          setEditor({ aberto: false, def: null });
          toast.success(novo ? `Campo "${d.rotulo}" criado` : `Campo "${d.rotulo}" atualizado`);
          await carregar();
        }}
      />

      <Confirm
        open={!!excluir}
        onClose={() => setExcluir(null)}
        onConfirm={confirmarExclusao}
        loading={!!excluir && ocupado === excluir.id}
        title={`Excluir o campo "${excluir?.rotulo ?? ''}"?`}
        description="A definição some de vez. Só é possível quando nenhum registro tem valor neste campo; se houver, ele continua arquivado."
        confirmLabel="Excluir campo"
      />
    </div>
  );
}

function EditorCampo({ aberto, def, entidade, onClose, onSalvo }: {
  aberto: boolean;
  def: CampoDef | null;
  entidade: EntidadeCampo;
  onClose: () => void;
  onSalvo: (d: CampoDef, novo: boolean) => void | Promise<void>;
}) {
  const [r, setR] = useState<Rascunho>(NOVO);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setErro('');
    setR(def ? { rotulo: def.rotulo, tipo: def.tipo, opcoes: def.opcoes.join('\n'), obrigatorio: def.obrigatorio, grupo: def.grupo ?? '' } : NOVO);
  }, [aberto, def]);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!r.rotulo.trim()) { setErro('Informe o nome do campo.'); return; }
    if (temOpcoes(r.tipo) && linhasOpcoes(r.opcoes).length === 0) { setErro('Informe ao menos uma opção, uma por linha.'); return; }
    setErro('');
    setSalvando(true);
    const dados: CampoInput = {
      rotulo: r.rotulo.trim(),
      tipo: r.tipo,
      obrigatorio: r.obrigatorio,
      grupo: r.grupo.trim() || null,
      ...(temOpcoes(r.tipo) ? { opcoes: linhasOpcoes(r.opcoes) } : {}),
    };
    try {
      const salvo = def ? await customFields.update(def.id, dados) : await customFields.create(entidade, dados);
      await onSalvo(salvo, !def);
    } catch (err) {
      setErro(mensagemErro(err, 'Não consegui salvar o campo.'));
    } finally {
      setSalvando(false);
    }
  };

  const entidadeNome = ENTIDADES.find((x) => x.key === (def?.entidade ?? entidade))?.label.toLowerCase();

  return (
    <Modal
      open={aberto}
      onClose={onClose}
      title={def ? 'Editar campo' : 'Novo campo'}
      description={def ? `Chave cf_${def.chave} (não muda depois de criada).` : `Campo para ${entidadeNome}.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button variant="primary" type="submit" form="form-campo" loading={salvando}>{def ? 'Salvar' : 'Criar campo'}</Button>
        </>
      }
    >
      <form id="form-campo" onSubmit={salvar} className="space-y-4" noValidate>
        <div>
          <label htmlFor="campo-rotulo" className="mb-1 block text-xs font-semibold text-muted">Nome</label>
          <Input id="campo-rotulo" value={r.rotulo} maxLength={80} onChange={(e) => setR({ ...r, rotulo: e.target.value })} placeholder="Ex.: Convênio" autoFocus />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="campo-tipo" className="mb-1 block text-xs font-semibold text-muted">Tipo</label>
            <Select id="campo-tipo" value={r.tipo} onChange={(v) => setR({ ...r, tipo: v as TipoCampo })} options={TIPOS.map((t) => ({ value: t.key, label: t.label }))} />
            {def && def.tipo !== r.tipo && <p className="mt-1 text-xs text-muted">Só é possível trocar o tipo se nenhum registro tiver valor.</p>}
          </div>
          <div>
            <label htmlFor="campo-grupo" className="mb-1 block text-xs font-semibold text-muted">Grupo (opcional)</label>
            <Input id="campo-grupo" value={r.grupo} maxLength={60} onChange={(e) => setR({ ...r, grupo: e.target.value })} placeholder="Ex.: Dados clínicos" />
          </div>
        </div>
        {temOpcoes(r.tipo) && (
          <div>
            <label htmlFor="campo-opcoes" className="mb-1 block text-xs font-semibold text-muted">Opções (uma por linha)</label>
            <textarea id="campo-opcoes" className="textarea" rows={5} value={r.opcoes} onChange={(e) => setR({ ...r, opcoes: e.target.value })} placeholder={'Unimed\nAmil\nParticular'} />
          </div>
        )}
        <Switch checked={r.obrigatorio} onChange={(v) => setR({ ...r, obrigatorio: v })} label="Obrigatório" description="O formulário não salva sem este campo preenchido." />
        {erro && <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger" role="alert">{erro}</p>}
      </form>
    </Modal>
  );
}

/** Arrastar e soltar nativo (HTML5) para reordenar; as setas cobrem teclado e toque. */
function useArrastar(itens: CampoDef[], onSoltar: (ids: string[]) => void) {
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  return {
    sobre,
    props: (id: string) => ({
      draggable: true,
      onDragStart: (e: React.DragEvent) => { setArrastando(id); e.dataTransfer.effectAllowed = 'move'; },
      onDragOver: (e: React.DragEvent) => { if (arrastando) { e.preventDefault(); setSobre(id); } },
      onDragLeave: () => setSobre((s) => (s === id ? null : s)),
      onDragEnd: () => { setArrastando(null); setSobre(null); },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        const de = arrastando;
        setArrastando(null);
        setSobre(null);
        if (!de || de === id) return;
        const ids = itens.map((d) => d.id).filter((x) => x !== de);
        ids.splice(ids.indexOf(id), 0, de);
        onSoltar(ids);
      },
    }),
  };
}
