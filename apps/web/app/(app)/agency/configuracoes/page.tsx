'use client';
import { useEffect,useState } from 'react';
import { agency } from '@/lib/agency';
import { useAgency } from '@/components/agency/AgencyProvider';
import { AccountPreferencesForm,type AccountPreferences } from '@/components/app/AccountPreferencesForm';
import { EmailDeliveryStatus,type EmailStatus } from '@/components/app/EmailDeliveryStatus';
export default function AgencySettings(){
 const [data,setData]=useState<{nome:string;settings:AccountPreferences;role:string;email:EmailStatus}|null>(null);const [error,setError]=useState('');const {recarregarClientes}=useAgency();
 useEffect(()=>{agency.settings().then(setData).catch(e=>setError(e.message));},[]);
 return <div className="mx-auto max-w-5xl space-y-6 p-6">
 <header className="rounded-2xl bg-[#281043] p-8 text-white" style={{backgroundImage:"linear-gradient(90deg,#241037ee,#4a157daa),url('/Background-login.png')",backgroundSize:'cover'}}>
 {/* eslint-disable-next-line @next/next/no-img-element */}<img src="/logo-revenue.png" alt="ORVYN Revenue OS" className="mb-6 w-36 rounded-lg bg-white p-2"/><h1 className="text-2xl font-semibold">Configurações da agência</h1><p className="mt-2 text-sm text-purple-100">Sua identidade, equipe e preferências em um só lugar.</p></header>
 {error&&<p role="alert" className="text-red-600">{error}</p>}
 {data?<><EmailDeliveryStatus status={data.email}/><AccountPreferencesForm name={data.nome} preferences={data.settings} agency disabled={!['owner','admin'].includes(data.role)} onSave={async(nome,settings)=>{await agency.updateSettings(nome,settings);await recarregarClientes();}}/></>:!error&&<p>Carregando configurações…</p>}
 </div>;
}
