'use client';

import { useCallback, useEffect, useState } from 'react';
import { agentesApi, type Agente, type AgenteInput, type AgentConfig, type CatalogoAgentes, type SecaoConfig } from '@/lib/agents';
import { clonar, igual, mensagemDeErro, useToast } from './kit';

/** Props comuns de toda seção do workspace do agente. */
export interface SecaoProps {
  agente: Agente;
  catalogo: CatalogoAgentes;
  /** Chamar com o agente devolvido pela API depois de salvar. */
  onAtualizado: (a: Agente) => void;
}

/**
 * Rascunho local de UMA seção da configuração estendida. Salvar manda só a
 * seção (PATCH `{ config: { [secao]: ... } }`); o servidor valida com Zod e
 * devolve o agente — a UI nunca decide se a config é válida.
 */
export function useSecaoConfig<K extends Exclude<SecaoConfig, 'modo'>>(agente: Agente, secao: K, onAtualizado: (a: Agente) => void) {
  const toast = useToast();
  const original = agente.config[secao];
  const [rascunho, setRascunho] = useState<AgentConfig[K]>(() => clonar(original));
  const [salvando, setSalvando] = useState(false);
  // Agente recarregado (outra aba salvou, restauração de versão): ressincroniza.
  useEffect(() => { setRascunho(clonar(original)); }, [agente.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const sujo = !igual(rascunho, original);
  const salvar = useCallback(async () => {
    setSalvando(true);
    try {
      const a = await agentesApi.atualizar(agente.id, { config: { [secao]: rascunho } } as AgenteInput);
      onAtualizado(a);
      toast('ok', 'Rascunho salvo. Publique para valer no atendimento.');
    } catch (e) {
      toast('erro', mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  }, [agente.id, secao, rascunho, onAtualizado, toast]);
  const descartar = useCallback(() => setRascunho(clonar(original)), [original]);
  const set = useCallback(<C extends keyof AgentConfig[K]>(campo: C, valor: AgentConfig[K][C]) => setRascunho((r) => ({ ...r, [campo]: valor })), []);
  return { rascunho, setRascunho, set, sujo, salvando, salvar, descartar };
}

/** Rascunho local de campos de coluna do agente (nome, instruções, modelo…). */
export function useCamposAgente<T extends Partial<AgenteInput>>(agente: Agente, extrair: (a: Agente) => T, onAtualizado: (a: Agente) => void) {
  const toast = useToast();
  const [rascunho, setRascunho] = useState<T>(() => extrair(agente));
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { setRascunho(extrair(agente)); }, [agente.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const original = extrair(agente);
  const sujo = !igual(rascunho, original);
  const salvar = useCallback(async (extra?: AgenteInput) => {
    setSalvando(true);
    try {
      const a = await agentesApi.atualizar(agente.id, { ...rascunho, ...(extra ?? {}) });
      onAtualizado(a);
      toast('ok', 'Rascunho salvo. Publique para valer no atendimento.');
      return true;
    } catch (e) {
      toast('erro', mensagemDeErro(e));
      return false;
    } finally {
      setSalvando(false);
    }
  }, [agente.id, rascunho, onAtualizado, toast]);
  const descartar = () => setRascunho(extrair(agente));
  return { rascunho, setRascunho, sujo, salvando, salvar, descartar };
}
