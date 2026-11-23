'use client';
import { useState } from 'react';
export default function AcceptAgencyInvite(){
 const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 return <main className="grid min-h-screen place-items-center bg-bg p-6"><form className="auth-card glass w-full max-w-md" onSubmit={async e=>{e.preventDefault();const form=new FormData(e.currentTarget);setBusy(true);setError('');try{const r=await fetch('/api/agency/invites/accept',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:new URLSearchParams(location.search).get('token'),nome:form.get('nome'),password:form.get('password')})});const j=await r.json();if(!r.ok)throw new Error(j.title??'Convite indisponível');location.assign('/agency');}catch(e){setError(e instanceof Error?e.message:'Falha ao aceitar.');setBusy(false);}}}>
 {/* eslint-disable-next-line @next/next/no-img-element */}<img src="/khub-logo-white.png" alt="KHUB" className="mb-8 w-40"/>
 <h1 className="font-display text-2xl tracking-tight">Sua equipe está esperando.</h1><p className="mb-6 mt-3 text-sm text-muted">Aceite o convite para entrar na agência. Se já tem conta, confirme sua senha atual.</p>
 <label className="mb-4 block text-sm">Seu nome<input className="input mt-2 w-full" name="nome" required minLength={2} maxLength={120} autoComplete="name"/></label>
 <label className="mb-6 block text-sm">Senha<input className="input mt-2 w-full" name="password" type="password" required minLength={8} autoComplete="current-password"/></label>
 {error&&<p role="alert" className="mb-4 rounded-card bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
 <button className="btn btn-auth-primary w-full" disabled={busy}>{busy?'Entrando…':'Aceitar convite'}</button></form></main>;
}
