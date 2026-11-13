'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { Button, Confirm, Drawer, Select, Switch, useToast } from '@/components/kit';
import { cx } from '@/components/ui';
import type { ConfigWorkflow, SegredoWebhook } from '@/lib/automations';

const DIAS = [
  { n: 1, l: 'S', nome: 'segunda' }, { n: 2, l: 'T', nome: 'terça' }, { n: 3, l: 'Q', nome: 'quarta' }, { n: 4, l: 'Q', nome: 'quinta' },
  { n: 5, l: 'S', nome: 'sexta' }, { n: 6, l: 'S', nome: 'sábado' }, { n: 0, l: 'D', nome: 'domingo' },
];
const FUSOS_BASE = ['America/Sao_Paulo', 'America/Manaus', 'America/Recife', 'America/Belem', 'America/Cuiaba', 'America/Rio_Branco', 'America/Noronha', 'UTC'];
const tzLocal = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'America/Sao_Paulo';
  }
})();
const rotuloFuso = (f: string) => f.replace('America/', '').replace(/_/g, ' ');
const hora = (h: number) => `${String(h).padStart(2, '0')}:00`;

const REENTRADA: { valor: ConfigWorkflow['reentrada']; titulo: string; desc: string }[] = [
  { valor: 'uma_vez', titulo: 'Só uma vez', desc: 'Cada contato passa por este fluxo uma única vez. É o mais seguro.' },
  { valor: 'apos_terminar', titulo: 'Depois que terminar', desc: 'Pode entrar de novo, desde que a execução anterior tenha acabado.' },
  { valor: 'sempre', titulo: 'Toda vez', desc: 'Entra sempre que o gatilho disparar. Cuidado: pode repetir mensagem.' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  config: ConfigWorkflow;
  tags: string[];
  webhookUrl: string | null;
  webhookAssinado: boolean;
  temGatilhoWebhook: boolean;
  onSalvar: (patch: Partial<ConfigWorkflow>) => Promise<void>;
  onTags: (tags: string[]) => Promise<void>;
  onGerarWebhook: () => Promise<void>;
  onGerarSegredo: () => Promise<SegredoWebhook>;
  onRemoverSegredo: () => Promise<void>;
}

function Secao({ titulo, children, className }: { titulo: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cx('space-y-2.5', className)}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{titulo}</h3>
      {children}
    </section>
  );
}

/**
 * Configurações do fluxo (Q3.3). Operação, não lógica: mudar aqui não gera
 * versão nova nem afeta quem já está correndo. Cada controle salva na hora,
 * com toast de confirmação ou de erro (e volta ao valor anterior se falhar).
 */
export function ConfigFluxo(p: Props) {
  const toast = useToast();
  const [c, setC] = useState(p.config);
  const [novaTag, setNovaTag] = useState('');
  const [segredo, setSegredo] = useState<SegredoWebhook | null>(null);
  const [confirmar, setConfirmar] = useState<null | 'url' | 'rotacionar' | 'desligar'>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => setC(p.config), [p.config]);
  useEffect(() => {
    if (!p.open) setSegredo(null);
  }, [p.open]);

  const salvar = async (patch: Partial<ConfigWorkflow>) => {
    const antes = c;
    setC({ ...c, ...patch });
    try {
      await p.onSalvar(patch);
      toast.success('Configuração salva.');
    } catch {
      setC(antes);
      toast.error('Não consegui salvar a configuração.', { description: 'Nada foi alterado. Tente de novo.' });
    }
  };

  // A API só valida início < fim quando recebe os dois: o par sai sempre junto.
  const mudarInicio = (h: number) => void salvar({ janelaInicio: h, janelaFim: c.janelaFim > h ? c.janelaFim : Math.min(h + 1, 24) });
  const mudarFim = (h: number) => void salvar({ janelaFim: h, janelaInicio: c.janelaInicio < h ? c.janelaInicio : Math.max(h - 1, 0) });
  const alternarDia = (n: number) => {
    const dias = c.janelaDias.includes(n) ? c.janelaDias.filter((d) => d !== n) : [...c.janelaDias, n].sort();
    if (!dias.length) {
      toast.info('Deixe pelo menos um dia na janela.');
      return;
    }
    void salvar({ janelaDias: dias });
  };

  const addTag = async () => {
    const t = novaTag.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 24);
    setNovaTag('');
    if (!t || p.tags.includes(t)) return;
    try {
      await p.onTags([...p.tags, t]);
    } catch {
      toast.error('Não consegui salvar a etiqueta.');
    }
  };
  const removerTag = async (t: string) => {
    try {
      await p.onTags(p.tags.filter((x) => x !== t));
    } catch {
      toast.error('Não consegui remover a etiqueta.');
    }
  };

  const copiar = async (texto: string, rotulo: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      toast.success(`${rotulo} copiado.`);
    } catch {
      toast.error('Não consegui copiar. Selecione o texto e copie manualmente.');
    }
  };

  const executarConfirmado = async () => {
    setOcupado(true);
    try {
      if (confirmar === 'url') {
        await p.onGerarWebhook();
        toast.success('URL nova gerada. A antiga parou de funcionar.');
      } else if (confirmar === 'rotacionar') {
        setSegredo(await p.onGerarSegredo());
        toast.success('Segredo novo gerado. O anterior parou de valer.');
      } else if (confirmar === 'desligar') {
        await p.onRemoverSegredo();
        setSegredo(null);
        toast.success('Assinatura desligada. Só a URL protege o webhook agora.');
      }
      setConfirmar(null);
    } catch {
      toast.error('Não consegui concluir. Tente de novo.');
    } finally {
      setOcupado(false);
    }
  };

  const gerarUrl = async () => {
    setOcupado(true);
    try {
      await p.onGerarWebhook();
      toast.success('URL de entrada gerada.');
    } catch {
      toast.error('Não consegui gerar a URL.');
    } finally {
      setOcupado(false);
    }
  };
  const gerarSegredo = async () => {
    setOcupado(true);
    try {
      setSegredo(await p.onGerarSegredo());
    } catch {
      toast.error('Não consegui gerar o segredo.');
    } finally {
      setOcupado(false);
    }
  };

  return (
    <>
      <Drawer open={p.open} onClose={p.onClose} title="Configurações do fluxo" description="Valem na hora e não criam versão nova." width="sm:max-w-md">
        <div className="space-y-7">
          <Secao titulo="Quem já passou pode entrar de novo?">
            <div className="space-y-1.5" role="radiogroup" aria-label="Reentrada">
              {REENTRADA.map((r) => {
                const ativo = c.reentrada === r.valor;
                return (
                  <button
                    key={r.valor}
                    type="button"
                    role="radio"
                    aria-checked={ativo}
                    onClick={() => !ativo && void salvar({ reentrada: r.valor })}
                    className={cx('w-full rounded-xl border p-3 text-left transition-colors', ativo ? 'border-brand bg-brand-softer' : 'border-line hover:bg-surface2')}
                  >
                    <span className="flex items-center gap-2">
                      <span className={cx('grid h-4 w-4 place-items-center rounded-full border', ativo ? 'border-brand bg-brand' : 'border-line-strong')}>
                        {ativo && <span className="h-1.5 w-1.5 rounded-full bg-surface" />}
                      </span>
                      <span className="text-sm font-semibold text-fg">{r.titulo}</span>
                    </span>
                    <span className="mt-0.5 block pl-6 text-xs leading-snug text-muted">{r.desc}</span>
                  </button>
                );
              })}
            </div>
          </Secao>

          <Secao titulo="Conversa">
            <Switch
              layout="row"
              checked={c.pararNoReply}
              onChange={(v) => void salvar({ pararNoReply: v })}
              label="Parar quando o contato responder"
              description="Virou conversa humana: a automação sai da frente e não manda mais nada."
            />
          </Secao>

          <Secao titulo="Janela de envio">
            <Switch
              layout="row"
              checked={c.janelaAtiva}
              onChange={(v) => void salvar({ janelaAtiva: v })}
              label="Só enviar em horário útil"
              description="Fora da janela, a mensagem espera a próxima abertura em vez de chegar de madrugada."
            />
            {c.janelaAtiva && (
              <div className="space-y-4 rounded-xl border border-line p-3">
                <div>
                  <p className="mb-1.5 text-xs text-muted">Dias</p>
                  <div className="flex gap-1" role="group" aria-label="Dias da janela">
                    {DIAS.map((d) => {
                      const on = c.janelaDias.includes(d.n);
                      return (
                        <button
                          key={d.n}
                          type="button"
                          aria-pressed={on}
                          aria-label={d.nome}
                          onClick={() => alternarDia(d.n)}
                          className={cx('h-8 w-8 rounded-lg text-xs font-semibold transition-colors', on ? 'bg-brand text-white' : 'bg-surface2 text-muted hover:text-fg')}
                        >
                          {d.l}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-xs text-muted">Das</span>
                    <Select size="sm" value={String(c.janelaInicio)} onChange={(v) => mudarInicio(Number(v))} options={Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: hora(h) }))} />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-muted">Até</span>
                    <Select size="sm" value={String(c.janelaFim)} onChange={(v) => mudarFim(Number(v))} options={Array.from({ length: 24 }, (_, i) => ({ value: String(i + 1), label: hora(i + 1) }))} />
                  </label>
                </div>
                <label className="block">
                  <span className="mb-1 block text-xs text-muted">Fuso horário (o do seu cliente, não o do servidor)</span>
                  <Select
                    size="sm"
                    value={c.timezone}
                    onChange={(v) => void salvar({ timezone: v })}
                    options={Array.from(new Set([c.timezone, tzLocal, ...FUSOS_BASE])).map((f) => ({ value: f, label: `${rotuloFuso(f)}${f === tzLocal ? ' (seu)' : ''}` }))}
                  />
                </label>
                <Switch
                  layout="row"
                  checked={!!c.janelaIncluiEquipe}
                  onChange={(v) => void salvar({ janelaIncluiEquipe: v })}
                  label="Aplicar a janela também ao aviso da equipe"
                  description="Desligado, o &quot;Notificar equipe&quot; sai na hora, mesmo fora do horário."
                />
              </div>
            )}
          </Secao>

          <Secao titulo="Etiquetas">
            <div className="flex flex-wrap items-center gap-1.5">
              {p.tags.map((t) => (
                <span key={t} className="pill pill-brand">
                  #{t}
                  <button type="button" onClick={() => void removerTag(t)} className="grid h-4 w-4 place-items-center rounded-full hover:bg-brand-soft" aria-label={`Remover etiqueta ${t}`}>
                    <Icon name="close" size={11} />
                  </button>
                </span>
              ))}
              <input
                value={novaTag}
                onChange={(e) => setNovaTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void addTag();
                  }
                }}
                onBlur={() => void addTag()}
                placeholder="Nova etiqueta"
                aria-label="Nova etiqueta"
                className="input h-8 w-36 text-sm"
              />
            </div>
          </Secao>

          {p.temGatilhoWebhook && (
            <Secao titulo="Webhook de entrada">
              <p className="text-xs leading-snug text-muted">Quem tiver esta URL dispara o fluxo: trate como senha.</p>
              {p.webhookUrl ? (
                <div className="space-y-2">
                  <code className="block break-all rounded-lg bg-surface2 p-2.5 font-mono text-xs text-fg">{p.webhookUrl}</code>
                  <div className="flex gap-2">
                    <Button size="sm" variant="soft" icon="copy" onClick={() => void copiar(p.webhookUrl!, 'Endereço')}>Copiar URL</Button>
                    <Button size="sm" variant="ghost" icon="refresh" onClick={() => setConfirmar('url')}>Trocar URL</Button>
                  </div>
                </div>
              ) : (
                <Button size="sm" variant="primary" loading={ocupado} onClick={() => void gerarUrl()}>Gerar URL</Button>
              )}

              <div className="rounded-xl border border-line p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-fg">Assinatura HMAC</p>
                  <span className={cx('pill', p.webhookAssinado ? 'pill-success' : '')}>{p.webhookAssinado ? 'Ligada' : 'Desligada'}</span>
                </div>
                <p className="mt-1 text-xs leading-snug text-muted">
                  Com a assinatura ligada, todo POST precisa do cabeçalho abaixo; sem ele, a chamada é recusada (401) e nada executa.
                </p>
                <code className="mt-2 block break-all rounded-lg bg-surface2 p-2.5 font-mono text-xs text-fg">X-KHUB-Signature: sha256=&lt;hmac&gt;</code>
                <p className="mt-1 text-2xs text-muted">
                  O hmac é o HMAC-SHA256, em hexadecimal, do corpo cru da requisição usando o segredo como chave.
                </p>

                {segredo && (
                  <div className="mt-3 rounded-lg border border-warning-border bg-warning-soft p-2.5" role="status">
                    <p className="text-xs font-semibold text-warning">Copie agora: este segredo não aparece de novo.</p>
                    <code className="mt-1.5 block break-all font-mono text-xs text-fg">{segredo.segredo}</code>
                    <Button size="sm" variant="soft" icon="copy" className="mt-2" onClick={() => void copiar(segredo.segredo, 'Segredo')}>Copiar segredo</Button>
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  {p.webhookAssinado ? (
                    <>
                      <Button size="sm" variant="soft" icon="refresh" onClick={() => setConfirmar('rotacionar')}>Rotacionar segredo</Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmar('desligar')}>Desligar assinatura</Button>
                    </>
                  ) : (
                    <Button size="sm" variant="primary" icon="shield" loading={ocupado} onClick={() => void gerarSegredo()}>Gerar segredo</Button>
                  )}
                </div>
              </div>
            </Secao>
          )}
        </div>
      </Drawer>

      <Confirm
        open={confirmar !== null}
        onClose={() => setConfirmar(null)}
        onConfirm={executarConfirmado}
        loading={ocupado}
        tone={confirmar === 'desligar' || confirmar === 'url' ? 'danger' : 'primary'}
        title={confirmar === 'url' ? 'Trocar a URL do webhook?' : confirmar === 'rotacionar' ? 'Rotacionar o segredo?' : 'Desligar a assinatura?'}
        description={
          confirmar === 'url'
            ? 'A URL atual para de funcionar na hora. Atualize o sistema que chama este fluxo.'
            : confirmar === 'rotacionar'
              ? 'O segredo atual para de valer na hora. Chamadas assinadas com ele passam a ser recusadas.'
              : 'Sem assinatura, qualquer um com a URL consegue disparar o fluxo.'
        }
        confirmLabel={confirmar === 'url' ? 'Trocar URL' : confirmar === 'rotacionar' ? 'Rotacionar' : 'Desligar'}
      />
    </>
  );
}
