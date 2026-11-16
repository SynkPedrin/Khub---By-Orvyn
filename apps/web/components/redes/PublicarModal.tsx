'use client';

import { useEffect, useState } from 'react';
import { Field, Input } from '@/components/ui';
import { Button, Confirm, Modal, Select, Switch, Textarea, useToast } from '@/components/kit';
import { ApiError } from '@/lib/api-error';
import { PRIVACIDADE_TIKTOK, VISIBILIDADE_YOUTUBE, redesApi, type CriadorTiktok, type NovaPublicacao, type PainelRede, type RedeSocial } from '@/lib/redes';

const NOME: Record<RedeSocial, string> = { instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube' };
const FORMATO: Record<string, string> = { imagem: 'Imagem (JPEG)', reels: 'Reels (vídeo)', video: 'Vídeo' };
const LIMITE_LEGENDA: Record<RedeSocial, number> = { instagram: 2200, tiktok: 2200, youtube: 5000 };

/**
 * Nova publicação. Dois passos obrigatórios: o formulário e a CONFIRMAÇÃO
 * explícita (resumo do que vai sair, em qual conta e quando). Só depois disso
 * a API grava; quem publica é o worker.
 */
export function PublicarModal({ painel, aberto, onFechar, onCriada }: { painel: PainelRede; aberto: boolean; onFechar: () => void; onCriada: () => void }) {
  const toast = useToast();
  const rede = painel.rede;
  const conta = painel.conta!;
  const [formato, setFormato] = useState<string>(painel.publicacao.formatos[0] ?? 'video');
  const [legenda, setLegenda] = useState('');
  const [titulo, setTitulo] = useState('');
  const [midiaUrl, setMidiaUrl] = useState('');
  const [privacidade, setPrivacidade] = useState('');
  const [quando, setQuando] = useState<'agora' | 'agendar'>('agora');
  const [dataHora, setDataHora] = useState('');
  const [semComentarios, setSemComentarios] = useState(false);
  const [criador, setCriador] = useState<CriadorTiktok | null>(null);
  const [erroCriador, setErroCriador] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto || rede !== 'tiktok') return;
    setCriador(null);
    setErroCriador(null);
    redesApi
      .criadorTiktok(conta.conexaoId)
      .then(setCriador)
      .catch((e) => setErroCriador(e instanceof ApiError ? e.message : 'Não consegui consultar as opções da conta no TikTok.'));
  }, [aberto, rede, conta.conexaoId]);

  const privacidades: { value: string; label: string }[] =
    rede === 'tiktok' ? (criador?.privacidades ?? []).map((p) => ({ value: p, label: PRIVACIDADE_TIKTOK[p] ?? p })) : rede === 'youtube' ? Object.entries(VISIBILIDADE_YOUTUBE).map(([value, label]) => ({ value, label })) : [];

  const validar = (): string | null => {
    if (!/^https:\/\//i.test(midiaUrl.trim())) return 'Informe a URL pública (https) da mídia.';
    if (legenda.length > LIMITE_LEGENDA[rede]) return `A legenda passa do limite de ${LIMITE_LEGENDA[rede]} caracteres.`;
    if (rede === 'youtube' && !titulo.trim()) return 'O título do vídeo é obrigatório no YouTube.';
    if (rede !== 'instagram' && !privacidade) return rede === 'tiktok' ? 'Escolha quem pode ver o vídeo no TikTok.' : 'Escolha a visibilidade do vídeo.';
    if (quando === 'agendar') {
      const t = new Date(dataHora).getTime();
      if (!dataHora || Number.isNaN(t)) return 'Escolha a data e a hora do agendamento.';
      if (t < Date.now()) return 'A data do agendamento já passou.';
    }
    return null;
  };

  const revisar = () => {
    const e = validar();
    setErro(e);
    if (!e) setConfirmando(true);
  };

  const enviar = async () => {
    setEnviando(true);
    const dados: NovaPublicacao = {
      rede,
      conexaoId: conta.conexaoId,
      formato: formato as NovaPublicacao['formato'],
      legenda,
      midiaUrl: midiaUrl.trim(),
      confirmado: true,
      ...(rede === 'youtube' ? { titulo: titulo.trim() } : {}),
      ...(privacidade ? { privacidade } : {}),
      ...(quando === 'agendar' ? { agendarPara: new Date(dataHora).toISOString() } : {}),
      ...(rede === 'tiktok' ? { desativarComentarios: semComentarios } : {}),
    };
    try {
      await redesApi.publicar(dados);
      toast.success(quando === 'agendar' ? 'Publicação agendada.' : 'Publicação enviada para a fila. Sai em até 1 minuto.');
      setConfirmando(false);
      onCriada();
      onFechar();
    } catch (e) {
      setConfirmando(false);
      const extra = e instanceof ApiError && Array.isArray(e.body.faltando) && e.body.faltando.length ? ` Falta: ${(e.body.faltando as string[]).join(', ')}.` : '';
      setErro(`${e instanceof Error ? e.message : 'Não consegui criar a publicação.'}${extra}`);
    } finally {
      setEnviando(false);
    }
  };

  const quandoTexto = quando === 'agendar' && dataHora ? new Date(dataHora).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'agora (em até 1 minuto)';

  return (
    <>
      <Modal
        open={aberto && !confirmando}
        onClose={onFechar}
        size="lg"
        title={`Nova publicação no ${NOME[rede]}`}
        description={`Conta: ${conta.usuario ?? conta.nome}. A rede busca a mídia na URL informada, então ela precisa estar pública.`}
        footer={
          <>
            <Button variant="ghost" onClick={onFechar}>Cancelar</Button>
            <Button onClick={revisar} disabled={rede === 'tiktok' && !criador}>Revisar e confirmar</Button>
          </>
        }
      >
        <div className="space-y-4">
          {painel.publicacao.motivo && <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">{painel.publicacao.motivo}</p>}
          {erroCriador && <p className="rounded-xl bg-danger/5 px-3 py-2 text-xs text-danger">{erroCriador}</p>}
          {rede === 'tiktok' && criador && (
            <p className="text-xs text-muted">Publicando como <strong className="text-fg">{criador.apelido ?? criador.usuario}</strong>{criador.duracaoMaxSeg ? ` · vídeos de até ${Math.floor(criador.duracaoMaxSeg / 60)} min` : ''}.</p>
          )}
          {painel.publicacao.formatos.length > 1 && (
            <Field label="Formato">
              <Select value={formato} onChange={setFormato} options={painel.publicacao.formatos.map((f) => ({ value: f, label: FORMATO[f] ?? f }))} />
            </Field>
          )}
          <Field label={formato === 'imagem' ? 'URL pública da imagem (JPEG)' : 'URL pública do vídeo'} hint={rede === 'tiktok' ? 'O domínio da URL precisa estar verificado no portal do TikTok.' : rede === 'youtube' ? 'O servidor precisa informar o tamanho do arquivo. Limite de 2 GB.' : undefined}>
            <Input value={midiaUrl} onChange={(e) => setMidiaUrl(e.target.value)} placeholder="https://" inputMode="url" />
          </Field>
          {rede === 'youtube' && (
            <Field label="Título">
              <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={100} />
            </Field>
          )}
          <Field label={rede === 'youtube' ? 'Descrição' : 'Legenda'}>
            <Textarea value={legenda} onChange={(e) => setLegenda(e.target.value)} maxLength={LIMITE_LEGENDA[rede]} showCount rows={4} />
          </Field>
          {rede !== 'instagram' && (
            <Field label={rede === 'tiktok' ? 'Quem pode ver' : 'Visibilidade'}>
              <Select value={privacidade} onChange={setPrivacidade} placeholder="Escolha" options={privacidades} />
            </Field>
          )}
          {rede === 'tiktok' && <Switch checked={semComentarios || !!criador?.comentariosDesativados} onChange={setSemComentarios} disabled={!!criador?.comentariosDesativados} label="Desativar comentários" />}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Quando">
              <Select value={quando} onChange={(v) => setQuando(v as 'agora' | 'agendar')} options={[{ value: 'agora', label: 'Publicar agora' }, { value: 'agendar', label: 'Agendar' }]} />
            </Field>
            {quando === 'agendar' && (
              <Field label="Data e hora">
                <Input type="datetime-local" value={dataHora} onChange={(e) => setDataHora(e.target.value)} />
              </Field>
            )}
          </div>
          {erro && <p className="rounded-xl bg-danger/5 px-3 py-2 text-sm text-danger">{erro}</p>}
        </div>
      </Modal>
      <Confirm
        open={confirmando}
        onClose={() => setConfirmando(false)}
        onConfirm={enviar}
        loading={enviando}
        tone="primary"
        confirmLabel={quando === 'agendar' ? 'Confirmar agendamento' : 'Confirmar publicação'}
        title="Confirmar publicação"
        description={`Vai sair no ${NOME[rede]} (${conta.usuario ?? conta.nome}), ${quandoTexto}${privacidade ? `, visível para: ${rede === 'tiktok' ? PRIVACIDADE_TIKTOK[privacidade] : VISIBILIDADE_YOUTUBE[privacidade]}` : ''}. Depois de publicado, só dá para apagar direto na rede.`}
      />
    </>
  );
}
