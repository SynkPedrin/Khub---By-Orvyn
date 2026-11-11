import type { RealtimeEvent } from '@khub/types';
import type { EventoEspera, FiltroEvento } from './catalogo';

/**
 * Eventos que acordam "Esperar até" (modo evento) e disparam "Meta" (Q3.1).
 * Vêm do MESMO outbox que os gatilhos: o worker de gatilhos chama
 * `RunsService.avisarEvento` antes de abrir fluxos novos.
 */
export const EVENTO_DOMINIO_PARA_ESPERA: Partial<Record<RealtimeEvent, EventoEspera>> = {
  'message.created': 'mensagem_recebida',
  'contact.tagged': 'tag_adicionada',
  'deal.moved': 'etapa_mudou',
  'appointment.created': 'agendamento_criado',
  'appointment.confirmed': 'agendamento_confirmado',
  'deal.status_changed': 'negocio_status',
  'form.submitted': 'formulario_enviado',
  'payment.received': 'pagamento_recebido',
};

const txt = (v: unknown): string => String(v ?? '').trim().toLowerCase();

/** O evento `dados` (payload do outbox) satisfaz o evento + filtro configurado? */
export function eventoBate(cfg: Partial<FiltroEvento> | undefined, evento: EventoEspera, dados: Record<string, unknown>): boolean {
  if (!cfg?.evento || cfg.evento !== evento) return false;
  switch (evento) {
    case 'tag_adicionada':
      return !cfg.tag?.trim() || txt(cfg.tag) === txt(dados.tag);
    case 'etapa_mudou':
      return !cfg.stageId || cfg.stageId === String(dados.stageId ?? '');
    case 'mensagem_recebida':
      return String(dados.de ?? 'contato') === 'contato' && (!cfg.contem?.trim() || txt(dados.texto).includes(txt(cfg.contem)));
    case 'negocio_status':
      // igual ao gatilho "Ganho ou perdido": vazio = ganho OU perdido (reabrir não conta)
      return cfg.status ? cfg.status === String(dados.status ?? '') : ['ganho', 'perdido'].includes(String(dados.status ?? ''));
    case 'formulario_enviado':
      return !cfg.formId || cfg.formId === String(dados.formId ?? '');
    case 'pagamento_recebido':
      return !cfg.valorMinimo || Number(dados.valorCentavos ?? 0) / 100 >= cfg.valorMinimo;
    case 'agendamento_criado':
    case 'agendamento_confirmado':
      return true;
    default:
      return false;
  }
}
