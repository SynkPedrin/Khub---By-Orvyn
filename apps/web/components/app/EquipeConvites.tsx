'use client';

import { useEffect, useState } from 'react';
import { Avatar, Badge, Card, Field, Input } from '@/components/ui';
import { Icon } from '@/components/icons';
import { Button, Confirm, Select, SkeletonRows, Textarea, useToast } from '@/components/kit';
import { EmailDeliveryStatus, type EmailStatus } from '@/components/app/EmailDeliveryStatus';
import { RemoverMembro } from '@/components/app/EquipeAcoes';
import { EditarAcessos, ResumoModulos, SeletorModulos } from '@/components/app/AcessoModulos';
import { MODULOS_PADRAO, papelRestringivel } from '@/lib/modulos';
import { settingsApi, type ConviteEntregue, type Invite, type Member } from '@/lib/settings';
import { useAuth } from '@/lib/auth';

const PAPEIS = [
  { value: 'admin', label: 'Administrador' },
  { value: 'manager', label: 'Gestor' },
  { value: 'member', label: 'Atendente / vendedor' },
  { value: 'viewer', label: 'Somente leitura' },
  { value: 'owner', label: 'Proprietário' },
];
const DICA_PAPEL: Record<string, string> = {
  admin: 'Gerencia tudo desta empresa e pode convidar a própria equipe.',
  manager: 'Configura funis, automações e importa contatos. Não gerencia a equipe.',
  member: 'Colaborador do dia a dia: atende, cuida de leads e da agenda.',
  viewer: 'Só visualiza, não altera nada.',
  owner: 'Controle total, inclusive de outros proprietários.',
};
const ROTULO_PAPEL: Record<string, string> = { owner: 'Proprietário', admin: 'Administrador', manager: 'Gestor', member: 'Atendente', viewer: 'Leitura' };
const msg = (e: unknown) => (e instanceof Error ? e.message : 'Tente novamente.');

/** Copia com fallback para navegadores sem clipboard API. */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = texto;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/**
 * Equipe da subaccount (ADR-0042): convite personalizado por e-mail (Resend)
 * + mensagem pronta para WhatsApp copiada com um clique. Quem aceita escolhe a
 * senha e entra só nesta subaccount.
 */
export function EquipeConvites() {
  const toast = useToast();
  const { user: eu } = useAuth();
  const [emailStatus, setEmailStatus] = useState<EmailStatus | null>(null);
  const [data, setData] = useState<{ members: Member[]; invites: Invite[] } | null>(null);
  // Padrão = colaborador da loja já restrito ao dia a dia (ADR-0045); IA fica para liberar depois.
  const [form, setForm] = useState({ email: '', nome: '', telefone: '', papel: 'member', mensagem: '' });
  const [modulos, setModulos] = useState<string[] | null>([...MODULOS_PADRAO]);
  const [acessos, setAcessos] = useState<Member | null>(null);
  const [busy, setBusy] = useState(false);
  const [entregue, setEntregue] = useState<ConviteEntregue | null>(null);
  const [revogar, setRevogar] = useState<Invite | null>(null);

  const load = () => settingsApi.members().then(setData).catch((e) => toast.error('Não foi possível carregar a equipe', { description: msg(e) }));
  useEffect(() => { load(); settingsApi.emailStatus().then(setEmailStatus).catch(() => undefined); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const convidar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email.trim()) return;
    setBusy(true);
    try {
      const r = await settingsApi.invite(form.email.trim(), form.papel, { nome: form.nome.trim() || undefined, mensagem: form.mensagem.trim() || undefined, telefone: form.telefone.trim() || undefined, modulos: papelRestringivel(form.papel) && modulos !== null ? modulos : undefined });
      setEntregue(r);
      setForm({ email: '', nome: '', telefone: '', papel: form.papel, mensagem: '' });
      toast.success('Convite criado', { description: r.emailSent ? `E-mail enviado para ${r.email}.` : 'Envie pelo WhatsApp ou copie o link.' });
      load();
    } catch (err) {
      toast.error('Não foi possível convidar', { description: msg(err) });
    } finally {
      setBusy(false);
    }
  };

  const novoLink = async (i: Invite) => {
    try {
      const r = await settingsApi.resendInvite(i.id);
      setEntregue(r);
      toast.success('Novo link gerado', { description: r.emailSent ? 'E-mail reenviado. O link anterior não vale mais.' : 'O link anterior não vale mais.' });
      load();
    } catch (err) { toast.error('Não foi possível gerar o link', { description: msg(err) }); }
  };

  return (
    <div className="space-y-5">
      <Card className="p-6">
        <h2 className="font-bold text-fg">Convidar colaborador</h2>
        <p className="mt-1 text-sm text-muted">A pessoa recebe o convite, cria a própria senha e entra só nesta empresa, vendo só o que você liberar.</p>
        <div className="mt-4"><EmailDeliveryStatus status={emailStatus} /></div>
        <form onSubmit={convidar} className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="E-mail (vai ser o login)"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="pessoa@empresa.com" required /></Field>
          <Field label="Nome (opcional)"><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ana Souza" maxLength={120} /></Field>
          <Field label="WhatsApp (opcional)" hint="Com DDD. Abre a conversa direto com a pessoa."><Input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} placeholder="(11) 99999-0000" inputMode="tel" maxLength={30} /></Field>
          <Field label="Papel" hint={DICA_PAPEL[form.papel]}><Select value={form.papel} onChange={(v) => setForm({ ...form, papel: v })} options={PAPEIS} /></Field>
          <div className="sm:col-span-2 rounded-2xl border border-line p-4">
            <p className="text-sm font-semibold text-fg">O que essa pessoa vai ver</p>
            {papelRestringivel(form.papel) ? (
              <>
                <p className="mb-3 mt-0.5 text-xs text-muted">Dá para mudar depois em Membros › Acessos, inclusive liberar a IA.</p>
                <SeletorModulos valor={modulos} onChange={setModulos} disabled={busy} />
              </>
            ) : (
              <p className="mt-0.5 text-xs text-muted">Proprietário e administrador sempre veem tudo. Para restringir, escolha outro papel.</p>
            )}
          </div>
          <div className="sm:col-span-2">
            <Field label="Recado (opcional)" hint="Aparece no e-mail e na mensagem de WhatsApp.">
              <Textarea value={form.mensagem} onChange={(e) => setForm({ ...form, mensagem: e.target.value })} placeholder="Ex.: Oi, Ana! Este é o sistema onde vamos acompanhar os seus leads e o atendimento." maxLength={600} rows={3} />
            </Field>
          </div>
          <div className="sm:col-span-2 flex justify-end"><Button type="submit" loading={busy} disabled={!form.email.trim()}><Icon name="send" size={15} /> Enviar convite</Button></div>
        </form>
        {entregue && <ConvitePronto c={entregue} onFechar={() => setEntregue(null)} />}
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-line px-5 py-3"><h2 className="font-bold text-fg">Membros</h2></div>
        <div className="divide-y divide-line">
          {!data && <SkeletonRows rows={3} label="Carregando equipe" />}
          {data?.members.map((m) => (
            <div key={m.identityId} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <Avatar name={m.nome ?? m.email} size={34} />
              <div className="min-w-0 flex-1"><p className="truncate font-semibold text-fg">{m.nome ?? '-'}</p><p className="truncate text-xs text-muted">{m.email}</p><ResumoModulos role={m.role} modulos={m.modulos} /></div>
              {papelRestringivel(m.role) && <Button size="sm" variant="secondary" onClick={() => setAcessos(m)}><Icon name="lock" size={14} /> Acessos</Button>}
              <select className="input w-40" value={m.role} aria-label={`Papel de ${m.nome ?? m.email}`} onChange={async (e) => { try { await settingsApi.changeRole(m.identityId, e.target.value); toast.success('Papel atualizado'); load(); } catch (err) { toast.error('Não foi possível alterar', { description: msg(err) }); } }}>
                {PAPEIS.map((p) => <option key={p.value} value={p.value}>{ROTULO_PAPEL[p.value]}</option>)}
              </select>
              <RemoverMembro membro={m} euEmail={eu?.email} onRemovido={load} />
            </div>
          ))}
        </div>
      </Card>

      {(data?.invites.length ?? 0) > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="border-b border-line px-5 py-3"><h2 className="font-bold text-fg">Convites pendentes</h2></div>
          <div className="divide-y divide-line">
            {data?.invites.map((i) => {
              const expirado = new Date(i.expiresAt).getTime() < Date.now();
              return (
                <div key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-fg">{i.email}</p>
                    <p className="text-xs text-muted">{ROTULO_PAPEL[i.role] ?? i.role} · {expirado ? 'expirou' : 'vale até'} {new Date(i.expiresAt).toLocaleDateString('pt-BR')}</p>
                    <ResumoModulos role={i.role} modulos={i.modulos} />
                  </div>
                  {expirado && <Badge tone="amber">Expirado</Badge>}
                  <Button size="sm" variant="secondary" onClick={() => novoLink(i)}><Icon name="refresh" size={14} /> Gerar novo link</Button>
                  <button onClick={() => setRevogar(i)} className="text-xs font-semibold text-red-600 dark:text-red-400">Revogar</button>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <EditarAcessos membro={acessos} onFechar={() => setAcessos(null)} onSalvo={load} />

      <Confirm open={!!revogar} onClose={() => setRevogar(null)} title={`Revogar o convite de ${revogar?.email ?? ''}?`} description="O link enviado deixa de funcionar." confirmLabel="Revogar"
        onConfirm={async () => { if (!revogar) return; try { await settingsApi.revokeInvite(revogar.id); toast.success('Convite revogado'); setRevogar(null); load(); } catch (err) { toast.error('Não foi possível revogar', { description: msg(err) }); } }} />
    </div>
  );
}

/** Resultado do convite: status do e-mail + WhatsApp (copiar/abrir) + link. */
function ConvitePronto({ c, onFechar }: { c: ConviteEntregue; onFechar: () => void }) {
  const toast = useToast();
  const [copiou, setCopiou] = useState<'whats' | 'link' | null>(null);
  const copiar = async (tipo: 'whats' | 'link') => {
    const ok = await copiarTexto(tipo === 'whats' ? c.whatsappTexto : c.acceptUrl);
    if (ok) { setCopiou(tipo); toast.success(tipo === 'whats' ? 'Mensagem copiada: é só colar no WhatsApp' : 'Link copiado'); }
    else toast.error('Não consegui copiar. Selecione o texto abaixo e copie manualmente.');
  };
  return (
    <div className="mt-5 rounded-2xl border border-brand/30 bg-brand/5 p-4" data-testid="convite-pronto">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-fg">Convite pronto para {c.email}</p>
          <p className={c.emailSent ? 'mt-0.5 text-xs text-emerald-700 dark:text-emerald-400' : 'mt-0.5 text-xs text-amber-700 dark:text-amber-400'}>
            {c.emailSent ? 'E-mail enviado pelo Resend.' : `E-mail não enviado${c.erro ? `: ${c.erro}` : c.missing?.length ? ` (falta configurar ${c.missing.join(', ')})` : ''}. Use o WhatsApp abaixo.`}
          </p>
          {!c.linkPublico && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Atenção: o link usa o endereço local deste computador. Para um cliente abrir de fora, o KHUB precisa estar publicado (WEB_URL com https).</p>}
        </div>
        <button onClick={onFechar} className="rounded p-1 text-muted hover:text-fg" aria-label="Fechar"><Icon name="close" size={14} /></button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={() => copiar('whats')} data-testid="copiar-whatsapp"><Icon name={copiou === 'whats' ? 'check' : 'whatsapp'} size={15} /> {copiou === 'whats' ? 'Mensagem copiada' : 'Copiar mensagem para WhatsApp'}</Button>
        <a href={c.whatsappUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary inline-flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-sm font-semibold text-fg hover:bg-surface2"><Icon name="external" size={14} /> Abrir no WhatsApp</a>
        <Button variant="ghost" onClick={() => copiar('link')}><Icon name={copiou === 'link' ? 'check' : 'link'} size={15} /> {copiou === 'link' ? 'Link copiado' : 'Copiar só o link'}</Button>
      </div>
      <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-surface p-3 font-sans text-xs text-muted">{c.whatsappTexto}</pre>
    </div>
  );
}
