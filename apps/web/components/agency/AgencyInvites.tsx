'use client';
import { useEffect,useState } from 'react';
import { agency } from '@/lib/agency';
import { useAgency } from './AgencyProvider';
import { Button,Field,Input } from '@/components/ui';
export function AgencyInvites(){
 const {contexto,clientes}=useAgency();const [email,setEmail]=useState('');const [role,setRole]=useState('member');const [ids,setIds]=useState<string[]>([]);const [rows,setRows]=useState<Awaited<ReturnType<typeof agency.invites>>>([]);const [msg,setMsg]=useState('');const [link,setLink]=useState('');const [busy,setBusy]=useState(false);
 const allowed=!!contexto&&['owner','admin'].includes(contexto.role);
 const load=()=>agency.invites().then(setRows).catch(e=>setMsg(e.message));
 useEffect(()=>{if(allowed)void load();},[allowed]);
 if(!allowed)return null;
 return <div className="mb-6 space-y-4">
 <form className="card space-y-4 p-6" onSubmit={async e=>{e.preventDefault();setBusy(true);setMsg('');setLink('');try{const r=await agency.invite(email,role,ids);setMsg(r.emailSent?'Convite enviado pelo Resend.':r.erro??'Convite criado. Configure o remetente no Resend ou compartilhe o link.');setLink(r.acceptUrl);setEmail('');await load();}catch(e){setMsg(e instanceof Error?e.message:'Não foi possível criar o convite.');}finally{setBusy(false);}}}>
 <h2 className="font-semibold">Convidar para a agência</h2><div className="grid gap-4 sm:grid-cols-2"><Field label="E-mail"><Input type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></Field><Field label="Permissão"><select className="input" value={role} onChange={e=>setRole(e.target.value)}><option value="viewer">Visualizador · somente leitura</option><option value="member">Membro · operar clientes selecionados</option>{contexto?.role==='owner'&&<option value="admin">Administrador · todos os clientes</option>}</select></Field></div>
 <fieldset><legend className="mb-2 text-sm font-medium">Operações com acesso</legend><p className="mb-3 text-xs text-muted">{role==='admin'?'Administradores têm acesso a todos os clientes. Selecione a operação inicial.':'O convite só libera as empresas selecionadas.'}</p><div className="grid gap-2 sm:grid-cols-2">{clientes.filter(c=>c.status==='active').map(c=><label className="flex items-center gap-2 rounded-lg border border-line p-3 text-sm" key={c.id}><input type="checkbox" checked={ids.includes(c.id)} onChange={e=>setIds(e.target.checked?[...ids,c.id]:ids.filter(id=>id!==c.id))}/>{c.nome}</label>)}</div></fieldset>
 <Button type="submit" disabled={busy||!ids.length}>{busy?'Criando convite…':'Enviar convite'}</Button>
 {msg&&<p role="status" className="text-sm text-muted">{msg}</p>}{link&&<div className="flex items-center gap-3 rounded-lg bg-surface2 p-3"><input readOnly aria-label="Link de convite" value={link} className="min-w-0 flex-1 bg-transparent text-xs"/><button type="button" className="text-sm text-brand" onClick={async()=>{try{await navigator.clipboard.writeText(link);setMsg('Link copiado.');}catch{setMsg('Selecione e copie o link.');}}}>Copiar link</button></div>}
 </form>
 <section className="card p-6"><h2 className="mb-4 font-semibold">Convites da agência</h2>{!rows.length&&<p className="text-sm text-muted">Nenhum convite enviado.</p>}{rows.map(r=><div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-3 text-sm"><div><p>{r.email}</p><span className="text-xs text-muted">{r.role} · {r.acceptedAt?'Aceito':r.revokedAt?'Revogado':new Date(r.expiresAt)<new Date()?'Expirado':'Pendente'}</span></div>{!r.acceptedAt&&!r.revokedAt&&<button className="text-red-600" onClick={async()=>{try{await agency.revokeInvite(r.id);await load();}catch(e){setMsg(e instanceof Error?e.message:'Falha ao revogar.');}}}>Revogar</button>}</div>)}</section>
 </div>;
}
