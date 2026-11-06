'use client';
import { useState } from 'react';
import { Button, Field, Input } from '@/components/ui';
import { useLocale } from '@/lib/locale';
export interface AccountPreferences { email?:string;timezone?:string;currency?:string;locale?:string;phone?:string;website?:string;address?:string;legalName?:string;taxId?:string; }
export function AccountPreferencesForm({name,preferences,onSave,agency=false,disabled=false}:{name:string;preferences:AccountPreferences;onSave:(name:string,p:AccountPreferences)=>Promise<void>;agency?:boolean;disabled?:boolean}) {
 const {t}=useLocale();const [nome,setNome]=useState(name);const [p,setP]=useState<AccountPreferences>(preferences);const [busy,setBusy]=useState(false);const [msg,setMsg]=useState('');const [error,setError]=useState('');
 const field=(key:keyof AccountPreferences,label:string,type='text')=><Field label={t(label)}><Input type={type} disabled={disabled} value={p[key]??''} onChange={e=>setP({...p,[key]:e.target.value})}/></Field>;
 return <form className="space-y-5" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');setMsg('');try{await onSave(nome,p);setMsg(t('Preferências salvas.'));}catch(e){setError(e instanceof Error?e.message:'Não foi possível salvar.');}finally{setBusy(false);}}}>
  <section className="card p-6"><h2 className="text-base font-semibold">{t('Identidade e contato')}</h2><p className="mt-1 text-sm text-muted">Informações oficiais usadas pela sua equipe na operação.</p><div className="mt-6 grid gap-4 sm:grid-cols-2">
    <Field label={t(agency?'Nome da agência':'Nome da empresa')}><Input required minLength={2} maxLength={120} disabled={disabled} value={nome} onChange={e=>setNome(e.target.value)}/></Field>
    {field('legalName','Razão social')}{field('taxId','Documento fiscal')}{field('email','E-mail comercial','email')}{field('phone','Telefone','tel')}{field('website','Website','url')}{field('address','Endereço')}
  </div></section>
  <section className="card p-6"><h2 className="text-base font-semibold">{t('Regionalização')}</h2><p className="mt-1 text-sm text-muted">Preferências desta conta. O idioma pessoal da interface fica em Meu perfil.</p><div className="mt-6 grid gap-4 sm:grid-cols-3">
    <Field label={t('Idioma')}><select disabled={disabled} className="input" value={p.locale??'pt-BR'} onChange={e=>setP({...p,locale:e.target.value})}><option value="pt-BR">Português (Brasil)</option><option value="en-US">English</option><option value="es-ES">Español</option></select></Field>
    <Field label={t('Fuso horário')}><select disabled={disabled} className="input" value={p.timezone??'America/Sao_Paulo'} onChange={e=>setP({...p,timezone:e.target.value})}>{['America/Sao_Paulo','America/Manaus','America/Recife','America/New_York','Europe/Lisbon','Europe/Madrid','UTC'].map(v=><option key={v}>{v}</option>)}</select></Field>
    <Field label={t('Moeda de exibição')}><select disabled={disabled} className="input" value={p.currency??'BRL'} onChange={e=>setP({...p,currency:e.target.value})}><option>BRL</option><option>USD</option><option>EUR</option></select></Field>
  </div><p className="mt-4 text-xs text-muted">Alterar a moeda não converte valores já cadastrados. Automações existentes mantêm seu próprio fuso de execução.</p></section>
  {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}{msg&&<p role="status" className="text-sm text-emerald-700">{msg}</p>}
  <Button type="submit" disabled={busy||disabled}>{t(busy?'Salvando…':'Salvar alterações')}</Button>
 </form>;
}
