'use client';
export interface EmailStatus {configured:boolean;provider:string;from:string|null;missing:string[];publicLinks:boolean;}
export function EmailDeliveryStatus({status}:{status:EmailStatus|null}) {
 if(!status)return null;
 return <div className="rounded-xl border border-line bg-surface2 p-4 text-sm">
 <p className="font-semibold">{status.provider==='resend'?'Resend':'E-mail transacional'} · {status.configured?'Configurado':'Configuração pendente'}</p>
 <p className="mt-1 text-xs text-muted">{status.from??'Defina o remetente de um domínio verificado para enviar convites.'}</p>
 {!status.publicLinks&&<p className="mt-2 text-xs text-amber-700">Ambiente local: os links de convite só abrem neste computador. Para usuários externos, configure o endereço público do KHUB.</p>}
 </div>;
}
