'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '@/components/icons';
import { Avatar } from '@/components/ui';
import { Quando } from '@/components/revenue/Quando';
import { CanalBadge, ScoreBadge, StatusBadge, canalRotulo } from '@/components/revenue/lead-ui';
import { telefone as fmtTelefone } from '@/lib/format';
import type { Lead } from '@/lib/revenue/types';

/**
 * Painel lateral de resumo do lead.
 *
 * Mostra o suficiente para decidir a próxima ação sem sair da lista. O que
 * exige leitura profunda (timeline completa, negócios, arquivos) vive no
 * perfil em `/leads/[id]`.
 */
export function PainelLead({ lead, onFechar }: { lead: Lead; onFechar: () => void }) {
  const [aba, setAba] = useState<'resumo' | 'atividades' | 'notas' | 'arquivos'>('resumo');

  return (
    <div className="card overflow-hidden">
      {/* Identificação */}
      <div className="flex items-start gap-3 p-4">
        <Avatar name={lead.nome} size={52} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-bold leading-tight text-fg">{lead.nome}</p>
          <p className="truncate text-[13px] text-muted">{lead.empresa}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <StatusBadge status={lead.status} />
          </div>
        </div>
        <button type="button" onClick={onFechar} className="btn btn-ghost btn-icon btn-sm" aria-label="Fechar painel">
          <Icon name="close" size={16} />
        </button>
      </div>

      {/* Ações rápidas — o que o operador faz 90% das vezes */}
      <div className="flex gap-2 px-4 pb-4">
        <Link href="/conversas" className="btn btn-sm flex-1">
          <Icon name="whatsapp" size={15} style={{ color: 'var(--ch-whatsapp)' }} />
          WhatsApp
        </Link>
        <a href={lead.email ? `mailto:${lead.email}` : undefined} className="btn btn-sm flex-1" aria-disabled={!lead.email}>
          <Icon name="mail" size={15} style={{ color: 'var(--ch-email)' }} />
          E-mail
        </a>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Mais ações">
          <Icon name="dots" size={16} />
        </button>
      </div>

      {/* Abas */}
      <div className="flex gap-5 border-b border-line px-4" role="tablist">
        {(['resumo', 'atividades', 'notas', 'arquivos'] as const).map((a) => (
          <button
            key={a}
            type="button"
            role="tab"
            className="tab"
            aria-selected={aba === a}
            onClick={() => setAba(a)}
          >
            {{ resumo: 'Resumo', atividades: 'Atividades', notas: 'Notas', arquivos: 'Arquivos' }[a]}
          </button>
        ))}
      </div>

      <div className="p-4">
        {aba === 'resumo' ? (
          <Resumo lead={lead} />
        ) : (
          <p className="py-8 text-center text-[13px] text-muted">
            Abra o perfil completo para ver {aba}.
            <br />
            <Link href={`/leads/${lead.id}`} className="mt-2 inline-flex items-center gap-1 font-medium text-brand hover:underline">
              Abrir perfil <Icon name="arrowRight" size={13} />
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}

function Resumo({ lead }: { lead: Lead }) {
  return (
    <>
      <h3 className="mb-2 text-[13px] font-semibold text-fg">Informações principais</h3>
      <ul className="space-y-1.5">
        {lead.email && <Campo icone="mail">{lead.email}</Campo>}
        {lead.telefone && <Campo icone="phone">{fmtTelefone(lead.telefone)}</Campo>}
        {lead.empresa && <Campo icone="building">{lead.empresa}</Campo>}
        {lead.cargo && <Campo icone="user">{lead.cargo}</Campo>}
        {lead.localizacao && <Campo icone="mapPin">{lead.localizacao}</Campo>}
        {lead.linkedin && (
          <Campo icone="linkedin">
            <a
              href={`https://${lead.linkedin}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand hover:underline"
            >
              {lead.linkedin}
            </a>
          </Campo>
        )}
      </ul>

      {lead.tags.length > 0 && (
        <>
          <h3 className="mb-2 mt-5 text-[13px] font-semibold text-fg">Tags</h3>
          <div className="flex flex-wrap gap-1.5">
            {lead.tags.map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
            <button type="button" className="btn btn-ghost btn-sm h-[26px] w-[26px] p-0" aria-label="Adicionar tag">
              <Icon name="plus" size={14} />
            </button>
          </div>
        </>
      )}

      {/* Score e fonte lado a lado */}
      <div className="mt-5 grid grid-cols-2 gap-2">
        <div className="card-inset p-3">
          <p className="text-[11px] text-muted">Score do lead</p>
          <p className="mt-1">
            <ScoreBadge score={lead.score} faixa={lead.faixa} />
          </p>
          <p className="mt-1 text-[11px] leading-snug text-muted">
            {lead.faixa === 'quente'
              ? 'Alta probabilidade de conversão'
              : lead.faixa === 'morno'
                ? 'Probabilidade média'
                : 'Baixa atividade recente'}
          </p>
        </div>

        <div className="card-inset p-3">
          <p className="text-[11px] text-muted">Fonte</p>
          <p className="mt-1">
            <CanalBadge canal={lead.origem} />
          </p>
          <p className="mt-1 text-[11px] text-muted">
            Chegou <Quando data={lead.criadoEm} />
          </p>
        </div>
      </div>

      {/* Última interação */}
      <h3 className="mb-2 mt-5 flex items-center justify-between text-[13px] font-semibold text-fg">
        Última interação
        <Quando data={lead.ultimaInteracaoAt} className="font-normal text-muted" />
      </h3>
      <div className="card-inset p-3">
        <p className="flex items-center gap-1.5 text-[12px] text-muted">
          <Icon name="whatsapp" size={13} style={{ color: 'var(--ch-whatsapp)' }} />
          Mensagem via {canalRotulo(lead.origem)}
        </p>
      </div>

      {/* Próxima ação */}
      {lead.proximaAcao && (
        <>
          <h3 className="mb-2 mt-5 text-[13px] font-semibold text-fg">Próxima ação</h3>
          <Link
            href="/conversas"
            className="flex items-center gap-2.5 rounded-md border border-brand-border bg-brand-softer p-3 transition hover:bg-brand-soft"
          >
            <span className="icon-tile h-8 w-8">
              <Icon name="chat" size={15} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-fg">{lead.proximaAcao.rotulo}</span>
              {lead.proximaAcao.quando && (
                <Quando data={lead.proximaAcao.quando} formato="hora" className="block text-[11px] text-muted" />
              )}
            </span>
            <Icon name="chevronRight" size={16} className="shrink-0 text-faint" />
          </Link>
        </>
      )}

      <Link href={`/leads/${lead.id}`} className="btn btn-primary mt-5 w-full">
        Abrir perfil completo
        <Icon name="arrowRight" size={15} />
      </Link>
    </>
  );
}

function Campo({ icone, children }: { icone: Parameters<typeof Icon>[0]['name']; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2.5">
      <Icon name={icone} size={15} className="shrink-0 text-faint" />
      <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{children}</span>
    </li>
  );
}
