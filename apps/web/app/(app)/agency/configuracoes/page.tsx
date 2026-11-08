'use client';
import { useEffect,useState } from 'react';
import { agency } from '@/lib/agency';
import { useAgency } from '@/components/agency/AgencyProvider';
import { AccountPreferencesForm,type AccountPreferences } from '@/components/app/AccountPreferencesForm';
import { EmailDeliveryStatus,type EmailStatus } from '@/components/app/EmailDeliveryStatus';
export default function AgencySettings(){
 const [data,setData]=useState<{nome:string;settings:AccountPreferences;role:string;email:EmailStatus}|null>(null);const [error,setError]=useState('');const {recarregarClientes}=useAgency();
 useEffect(()=>{agency.settings().then(setData).catch(e=>setError(e.message));},[]);
 return <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 lg:px-8 lg:py-8">
 <header className="flex items-center gap-4">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/khub-mark.png" alt="KHUB" className="h-12 w-12 object-contain"/><div><h1 className="t-display">Configurações da agência</h1><p className="mt-1.5 text-[15px] text-muted">Sua identidade, equipe e preferências em um só lugar.</p></div></header>
 {error&&<p role="alert" className="text-red-600">{error}</p>}
 {data?<><EmailDeliveryStatus status={data.email}/><AccountPreferencesForm name={data.nome} preferences={data.settings} agency disabled={!['owner','admin'].includes(data.role)} onSave={async(nome,settings)=>{await agency.updateSettings(nome,settings);await recarregarClientes();}}/></>:!error&&<p>Carregando configurações…</p>}
 </div>;
}
