import { NextResponse } from 'next/server';
import { API,setSession } from '@/lib/server-auth';
export async function POST(req:Request){
 try{
 const r=await fetch(`${API}/v1/agency/invites/accept`,{method:'POST',headers:{'content-type':'application/json'},body:await req.text(),cache:'no-store',signal:AbortSignal.timeout(20000)});
 const data=await r.json();if(!r.ok)return NextResponse.json(data,{status:r.status});
 const res=NextResponse.json({user:data.user});setSession(res,data.access,data.refresh);return res;
 }catch{return NextResponse.json({title:'Não foi possível aceitar o convite agora.'},{status:502});}
}
