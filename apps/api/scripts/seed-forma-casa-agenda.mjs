// Complemento da seed content-demo: agenda de compromissos realistas no
// tenant "Forma Casa Planejados (DEMO)" — visitas ao showroom, medições,
// apresentações de projeto e instalações, ligados a contatos reais do
// tenant. Idempotente: se o tenant já tem compromissos, pula.
//
//   node scripts/seed-forma-casa-agenda.mjs
import { prisma } from './seed-content-demo.mjs';

const DURACAO_MIN = { visita: 60, medicao: 90, projeto: 60, instalacao: 240, briefing: 45 };

/** Date no dia relativo (0 = hoje) e horário comercial local. */
function horario(diasRelativo, hora, minutos = 0) {
  const d = new Date();
  d.setDate(d.getDate() + diasRelativo);
  d.setHours(hora, minutos, 0, 0);
  return d;
}

const COMPROMISSOS = [
  // passado recente — concluídos
  { contato: 'Roberta Nascimento', titulo: 'Apresentação de projeto — Cozinha completa', tipo: 'projeto', dias: -3, hora: 10, status: 'concluido', local: 'Showroom Forma Casa' },
  { contato: 'Simone Freire', titulo: 'Medição — Cozinha + área gourmet', tipo: 'medicao', dias: -2, hora: 14, status: 'concluido', local: 'Residência da cliente' },
  { contato: 'Camila Rocha', titulo: 'Visita ao showroom — cozinha + lavanderia', tipo: 'visita', dias: -1, hora: 16, status: 'concluido', local: 'Showroom Forma Casa' },
  // hoje
  { contato: 'Carla Nogueira', titulo: 'Apresentação de projeto — Dormitório', tipo: 'projeto', dias: 0, hora: 10, status: 'confirmado', local: 'Showroom Forma Casa' },
  { contato: 'Marcos Paulo', titulo: 'Medição — Cozinha planejada', tipo: 'medicao', dias: 0, hora: 14, status: 'confirmado', local: 'Residência do cliente' },
  // amanhã
  { contato: 'Lucas Almeida', titulo: 'Reunião de negociação — Apartamento completo', tipo: 'projeto', dias: 1, hora: 9, status: 'confirmado', local: 'Showroom Forma Casa' },
  { contato: 'Patrícia Gomes', titulo: 'Visita ao showroom — primeira visita', tipo: 'visita', dias: 1, hora: 15, status: 'agendado', local: 'Showroom Forma Casa' },
  // esta semana
  { contato: 'Fernando Costa', titulo: 'Instalação — Sala + cozinha', tipo: 'instalacao', dias: 2, hora: 8, status: 'confirmado', local: 'Residência do cliente' },
  { contato: 'Beatriz Martins', titulo: 'Apresentação de projeto — Dormitório', tipo: 'projeto', dias: 3, hora: 11, status: 'agendado', local: 'Showroom Forma Casa' },
  { contato: 'Rodrigo Cunha', titulo: 'Briefing inicial — projeto sob medida', tipo: 'briefing', dias: 4, hora: 10, status: 'agendado', local: 'Showroom Forma Casa' },
  { contato: 'Aline Barbosa', titulo: 'Medição — ambientes planejados', tipo: 'medicao', dias: 5, hora: 13, status: 'agendado', local: 'Residência da cliente' },
];

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { nome: 'Forma Casa Planejados (DEMO)', isDemo: true } });
  if (!tenant) throw new Error('Tenant Forma Casa (DEMO) não encontrado — rode seed-content-demo-run.mjs antes.');

  const jaTem = await prisma.agendaCompromisso.count({ where: { tenantId: tenant.id } });
  if (jaTem > 0) { console.log('[skip] agenda já tem compromissos'); return; }

  const owners = await prisma.user.findMany({ where: { tenantId: tenant.id } });

  let criados = 0;
  for (const c of COMPROMISSOS) {
    const contact = await prisma.contact.findFirst({ where: { tenantId: tenant.id, nome: c.contato } });
    if (!contact) { console.log(`[aviso] contato "${c.contato}" não encontrado — pulado`); continue; }
    const inicio = horario(c.dias, c.hora);
    const fim = new Date(inicio.getTime() + DURACAO_MIN[c.tipo] * 60_000);
    await prisma.agendaCompromisso.create({
      data: {
        tenantId: tenant.id, contactId: contact.id, titulo: c.titulo, inicio, fim,
        status: c.status, local: c.local, createdBy: owners[0]?.id,
      },
    });
    criados++;
  }
  console.log(`[ok] ${criados} compromissos criados na agenda da Forma Casa`);
}

main().catch((e) => { console.error('[erro]', e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
