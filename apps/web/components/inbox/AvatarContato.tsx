'use client';

import { useState } from 'react';
import { Avatar } from '@/components/ui';

/**
 * Avatar de contato com foto de perfil. Ordem de tentativa:
 * 1. foto durável da subconta (`/api/fotos/:id`, bytes guardados pela db/066);
 * 2. `fotoUrl` crua (URL assinada do WhatsApp/Meta — pode estar vencida);
 * 3. iniciais.
 * `temFoto === false` (a lista da API informa) pula a tentativa 1: evita um
 * 404 por avatar em quem não tem foto guardada.
 */
export function AvatarContato({ nome, fotoUrl, contatoId, temFoto, size = 36 }: { nome: string; fotoUrl?: string | null; contatoId?: string | null; temFoto?: boolean; size?: number }) {
  const [estagio, setEstagio] = useState(0);
  const duravel = contatoId && temFoto !== false ? `/api/fotos/${contatoId}` : null;
  const opcoes = [duravel, fotoUrl ?? null].filter((v, i, a): v is string => !!v && a.indexOf(v) === i);
  const src = opcoes[Math.min(estagio, opcoes.length - 1)];
  return <Avatar name={nome} size={size} src={opcoes.length ? src : undefined} onError={() => setEstagio((e) => e + 1)} />;
}
