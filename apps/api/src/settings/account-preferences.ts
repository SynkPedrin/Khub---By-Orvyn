import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export const accountPreferences = z.object({
  email: z.union([z.string().email(), z.literal('')]).optional(),
  timezone: z.string().refine(v => { try { new Intl.DateTimeFormat('pt-BR', { timeZone: v }); return true; } catch { return false; } }, 'Fuso horário inválido').optional(),
  currency: z.enum(['BRL','USD','EUR']).optional(),
  locale: z.enum(['pt-BR','en-US','es-ES']).optional(),
  phone: z.string().max(40).optional(),
  website: z.union([z.string().url().refine(v => /^https?:/.test(v)), z.literal('')]).optional(),
  address: z.string().max(240).optional(),
  legalName: z.string().max(160).optional(),
  taxId: z.string().max(30).optional(),
}).strict();

export function parsePreferences(value: unknown) {
  const parsed = accountPreferences.safeParse(value);
  if (!parsed.success) throw new BadRequestException(parsed.error.issues.map(i => i.message).join('; '));
  return parsed.data;
}
