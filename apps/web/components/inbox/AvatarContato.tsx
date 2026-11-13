'use client';

import { useState } from 'react';
import { Avatar } from '@/components/ui';

/**
 * Avatar de contato com foto do WhatsApp. A URL é assinada e pode estar
 * vencida mesmo com o TTL do backend — se a imagem falhar, cai pras
 * iniciais sem quebrar a linha.
 */
export function AvatarContato({ nome, fotoUrl, size = 36 }: { nome: string; fotoUrl?: string | null; size?: number }) {
  const [falhou, setFalhou] = useState(false);
  return <Avatar name={nome} size={size} src={fotoUrl && !falhou ? fotoUrl : undefined} onError={() => setFalhou(true)} />;
}
