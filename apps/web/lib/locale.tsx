'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './auth';
import { settingsApi } from './settings';
const translations: Record<string,[string,string]> = {
  'Configurações':['Settings','Configuración'],'Meu perfil':['My profile','Mi perfil'],'Personalização':['Appearance','Personalización'],
  'Empresa':['Company','Empresa'],'Equipe & permissões':['Team & permissions','Equipo y permisos'],'Integrações':['Integrations','Integraciones'],
  'Chaves de API':['API keys','Claves API'],'Auditoria':['Activity log','Auditoría'],'Agência':['Agency','Agencia'],
  'Visão geral':['Overview','Vista general'],'Clientes':['Clients','Clientes'],'Equipe':['Team','Equipo'],
  'Conversas':['Conversations','Conversaciones'],'Automações':['Automations','Automatizaciones'],'Campanhas':['Campaigns','Campañas'],'Agenda':['Calendar','Agenda'],
  'Nome':['Name','Nombre'],'Idioma':['Language','Idioma'],'Salvar alterações':['Save changes','Guardar cambios'],'Salvando…':['Saving…','Guardando…'],
  'Identidade e contato':['Identity & contact','Identidad y contacto'],'Regionalização':['Region & language','Región e idioma'],
  'Nome da empresa':['Company name','Nombre de la empresa'],'Nome da agência':['Agency name','Nombre de la agencia'],
  'Razão social':['Legal name','Razón social'],'Documento fiscal':['Tax ID','Identificación fiscal'],'E-mail comercial':['Business email','Correo comercial'],
  'Telefone':['Phone','Teléfono'],'Endereço':['Address','Dirección'],'Fuso horário':['Time zone','Zona horaria'],'Moeda de exibição':['Display currency','Moneda de visualización'],
  'Preferências salvas.':['Preferences saved.','Preferencias guardadas.'],'Perfil da empresa':['Company profile','Perfil de la empresa'],
  'Salvar perfil':['Save profile','Guardar perfil'],'Conta':['Account','Cuenta'],'Avançado':['Advanced','Avanzado'],
};
const Ctx=createContext({locale:'pt-BR',t:(s:string)=>s,reload:()=>{}});
export function LocaleProvider({children}:{children:React.ReactNode}) {
  const {user}=useAuth();const [locale,setLocale]=useState('pt-BR');const [version,setVersion]=useState(0);
  useEffect(()=>{let alive=true;if(!user)return;settingsApi.profile().then(p=>{if(alive)setLocale(p.idioma);}).catch(()=>{});return()=>{alive=false;};},[user,version]);
  useEffect(()=>{document.documentElement.lang=locale;},[locale]);
  return <Ctx.Provider value={{locale,t:s=>locale==='pt-BR'?s:(translations[s]?.[locale==='en-US'?0:1]??s),reload:()=>setVersion(v=>v+1)}}>{children}</Ctx.Provider>;
}
export const useLocale=()=>useContext(Ctx);
