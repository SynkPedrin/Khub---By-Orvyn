import Link from 'next/link';
import { Container } from '@/components/marketing/ui/Container';
import { Section } from '@/components/marketing/ui/Section';
import { Reveal } from '@/components/marketing/ui/Reveal';
import { BotaoBaixarApp, IconeBaixarApp } from '@/components/marketing/ui/BaixarApp';

const RECURSOS = [
  { t: 'Aprove artes e roteiros', d: 'A peça chega no celular. Um toque aprova; se precisar, peça o ajuste ali mesmo.' },
  { t: 'Aviso na hora', d: 'Notificação no celular sempre que tiver algo esperando a sua aprovação.' },
  { t: 'Agenda no bolso', d: 'Veja os horários do dia, confirme, remarque e marque novos atendimentos.' },
];

/** Prévia do app (HTML, não imagem): a tela de aprovação como o cliente vê. */
function Celular() {
  return (
    <div className="relative mx-auto w-[272px] shrink-0 sm:w-[300px]" aria-hidden>
      <div className="absolute -inset-10 rounded-full bg-[#6c2bff]/25 blur-[80px]" />
      <div className="relative rounded-[46px] border border-white/15 bg-[#0b0b0d] p-[10px] shadow-[0_40px_120px_-30px_rgba(108,43,255,0.55)]">
        <div className="overflow-hidden rounded-[37px] bg-[#050505]">
          <div className="flex items-center justify-between px-6 pb-1 pt-3 text-[11px] font-semibold text-white">
            <span>9:41</span>
            <span className="h-[22px] w-[84px] rounded-full bg-black" />
            <span>100%</span>
          </div>
          <div className="px-4 pb-4 pt-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-white/45">Arte · Instagram</p>
            <p className="mb-3 text-[17px] font-bold leading-tight text-white">Post Black Friday</p>
            <div className="relative mb-3 aspect-square overflow-hidden rounded-[22px] bg-gradient-to-br from-[#6c2bff] via-[#3b1a8f] to-[#0b0b0d]">
              <div className="absolute inset-0 grid place-items-center p-6 text-center">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/70">Só esta semana</p>
                  <p className="mt-1 text-[34px] font-black leading-none text-[#c6f432]">20% OFF</p>
                  <p className="mt-2 text-[12px] text-white/80">em todos os procedimentos</p>
                </div>
              </div>
              <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-bold text-white">v2</span>
            </div>
            <div className="mb-3 rounded-2xl bg-white/[0.06] p-3 text-[11px] leading-relaxed text-white/75">
              <strong className="text-white">Equipe:</strong> ajustei a cor do fundo como você pediu ✨
            </div>
            <div className="flex gap-2">
              <span className="flex h-10 flex-1 items-center justify-center rounded-xl border border-white/15 text-[12px] font-bold text-white">Pedir ajuste</span>
              <span className="flex h-10 flex-[1.3] items-center justify-center rounded-xl bg-[#c6f432] text-[12px] font-bold text-[#0b0b0b]">Aprovar</span>
            </div>
          </div>
          <div className="flex justify-around border-t border-white/10 px-2 pb-4 pt-2 text-[9px] font-semibold text-white/45">
            <span>Início</span>
            <span className="text-[#c6f432]">Aprovações</span>
            <span>Agenda</span>
            <span>Perfil</span>
          </div>
        </div>
      </div>
      {/* Notificação flutuante */}
      <div className="absolute -right-3 top-16 w-[220px] rounded-2xl border border-white/10 bg-[#1a1a1f]/95 p-3 shadow-2xl backdrop-blur sm:-right-14">
        <div className="flex items-start gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/pwa/icon-192.png" alt="" className="h-8 w-8 rounded-lg" />
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-white">Arte para aprovar</p>
            <p className="truncate text-[11px] text-white/65">Post Black Friday</p>
          </div>
          <span className="ml-auto text-[10px] text-white/40">agora</span>
        </div>
      </div>
    </div>
  );
}

/** App mobile do cliente (PWA): aprovações, avisos e agenda — com o botão de baixar. */
export function AppMobile() {
  return (
    <Section id="app" space="lg" className="overflow-hidden">
      <Container>
        <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-20">
          <div>
            <p className="lp-label lp-eyebrow mb-6">App no celular</p>
            <h2 className="lp-h2 max-w-[15ch] text-[var(--lp-ink)]">
              <Reveal variant="clip" as="span" className="block">Seu cliente aprova</Reveal>
              <Reveal variant="clip" as="span" delay={0.1} className="block">
                de onde <span className="lp-serif text-[var(--lp-accent)]">estiver.</span>
              </Reveal>
            </h2>
            <Reveal delay={0.2}>
              <p className="lp-body mt-8 max-w-[46ch]">
                O app do KHUB leva aprovações de artes e roteiros, avisos e a agenda para o celular. Sem loja de aplicativos:
                instala em segundos e entra com o mesmo e-mail e senha.
              </p>
            </Reveal>
            <ul className="mt-8 grid gap-4">
              {RECURSOS.map((r, i) => (
                <Reveal key={r.t} delay={0.24 + i * 0.05}>
                  <li className="flex gap-4 border-t border-[var(--lp-rule)] pt-4">
                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--lp-accent)]" />
                    <span>
                      <span className="block text-[15px] font-semibold text-[var(--lp-ink)]">{r.t}</span>
                      <span className="mt-1 block text-[14px] leading-relaxed text-[var(--lp-ink-3)]">{r.d}</span>
                    </span>
                  </li>
                </Reveal>
              ))}
            </ul>
            <Reveal delay={0.4}>
              <div className="mt-10 flex flex-wrap items-center gap-4">
                <BotaoBaixarApp className="lp-cta gap-2">
                  <IconeBaixarApp size={18} /> Baixar app
                </BotaoBaixarApp>
                <Link href="/login?next=/m" className="lp-cta-quiet">Entrar no app</Link>
              </div>
            </Reveal>
          </div>
          <Reveal variant="shot">
            <Celular />
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}
