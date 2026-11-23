# RELATÓRIO — Redesign de Identidade v2 "Signal + Intelligence" (em andamento)

Data de abertura: 2026-11-22 · Branch: `feat/brand-identity-v2` · Última atualização: 2026-11-23
Documentos irmãos: `01-auditoria-identidade.md` · `02-direcao-de-arte.md` · `03-tecnologia.md` · `04-plano-modulos.md` · `contraste.md` · `bugs.md`

> Este arquivo é o estado durável do projeto — atualizado a cada etapa. A seção final (métricas, notas, pendências) é fechada na Fase 4.5.

## 1. Diagnóstico (antes)

- Marca forte só no login e na NICO; produto era "SaaS genérico de qualidade" (neutro, sem o violeta do logo).
- **Três `--brand` divergentes**: #9bee45 (login/LP), #b6ff00 (dark), #7b2eff violeta (light).
- Violeta (50% do logo) ausente do tema dark do produto.
- Inbox com identidade do WhatsApp (wallpaper + bolhas hardcoded).
- 1.487 classes com valores arbitrários; 953 `text-[px]`; 0 `loading.tsx` em 67 rotas.
- ADR-0040 (NICO=lime) contradizia a semântica desejada; revogado.
- Screenshots: `docs/brand/antes/` (136 arquivos, 29 rotas × 2 temas × 2 viewports).

## 2. Direção escolhida (e o que foi descartado)

**Signal + Intelligence**: dark-first; **lime = sinal** (ação do usuário), **violeta = inteligência** (toda IA, incl. NICO), **vidro = camada** (só flutuantes), **aurora = momento** (máx. 1/tela).
Descartado: FK Grotesk (não existe no repo → Space Grotesk OFL), WebGL no login (CSS aurora basta, 0 KB), Radix/cmdk/sonner/vaul/recharts (kit próprio já cobre), reescrita do DnD do kanban (risco no fluxo central; nativo mantido + Desfazer), Tailwind v4 (fora de escopo).
Diretriz do dono registrada: **clean, profissional, usabilidade primeiro** — menos glow, menos card-aninhado, hierarquia por espaço/tipografia/cor funcional.

## 3. Design system implementado

- **Tokens** (`styles/tokens.css`): neutros frios, lime/violet com papéis, semânticas distintas do lime, dados em ordem fixa, canais, raios fechados (4/6/10/14/full), escala tipográfica de 7 + hero. `fg-3` ajustado por evidência (#75757F→#7F7F89, AA 4.83:1).
- **Aliases** (`styles/aliases-v1.css`, TEMPORÁRIO): tokens legados → novos nos dois temas; remoção prevista na 4.5.
- **Contraste**: `contraste.md` — 27/27 pares AA (script `scripts/brand-contraste.mjs`).
- **Tipografia**: Space Grotesk (display) + Manrope (UI) + JetBrains Mono (dados) + Instrument Serif (acento). woff2 latin variable + OFL em `public/fonts`.
- **Componentes**: kit existente estilizado (`.btn` raio 6/13px, primary lime flat, `.btn-ai` violeta nos 2 temas), Toast com ação **Desfazer**, `AnimatedNumber` próprio, `.text-on-brand`, loading.tsx em 22 rotas, **brand board em `/design-system`**.

## 4. Módulos transformados (agrupado por pasta)

- **Fundação**: `app/layout.tsx`, `styles/*`, `tailwind.config.ts`, `app/globals.css` (botões, sidebar, nav-item, skeleton).
- **Shell**: `components/shell/Sidebar.tsx` (logo branca sem caixa, ativo = barra lime 2px + ícone lime), `Topbar.tsx` ("Perguntar à NICO" violeta), `app/(app)/layout.tsx` (sem NyroDock flutuante, sem rodapé de slogan).
- **Dashboard**: `app/(app)/dashboard/page.tsx` (faixa aurora; insights NICO violeta, demo e real).
- **NICO**: `components/nico/Nico.tsx` (halo/orbe/presença violeta; ADR-0040 revogado no comentário), `app/(app)/nyro/page.tsx`.
- **Pipeline**: `app/(app)/pipeline/page.tsx` (Desfazer ao mover).
- **Automações**: `components/automations/NoCanvas.tsx` (gatilho lime, controle/ação neutros, IA violeta).
- **Agenda**: `components/agenda/AgendaCalendario.tsx` (linha do "agora" lime).
- **Login/Auth** (9 arquivos): `AuthShell`, `LoginForm`, `SignupForm`, `SenhaForms`, `AceiteConviteForm`, `IconInput`, `PasswordInput`, `agency-invite`, bloco AUTH do globals.css.
- **Inbox** (5 arquivos): sem wallpaper WhatsApp (fundo do tema + textura violeta 3%), bolhas com tokens (recebida `--surface-3`, operador lime 14%, IA/automação violeta), `SugestoesIA` violeta, fix de densidade no `Composer`, unificação de canais (Instagram perdeu degradê decorativo; identificado por ícone).
- **Agência**: herda o shell v2 sem trabalho extra (verificado em `/agency` com conta própria).
- **E-mails** (API): `invite-email.ts`, `password-reset-email.ts` (logo B7 + CTA lime).
- **Contraste global**: ~20 arquivos com `bg-brand text-white` → `.text-on-brand`.
- **Leads**: em curso (subagente).

## 5. Bugs funcionais (docs/brand/bugs.md)

Corrigidos: B5, B6, B7, B11. Contratual: B4. Em curso: B1, B9. Abertos (backend/decisão): B2 (mitigado), B3, B8, B10.

## 6. Métricas — FECHAR NA 4.5

- Arbitrários: antes 1.487 (953 text-[px]) → medir no fim (meta: zero nos arquivos migrados).
- Bundle/Web Vitals: medir antes/depois (LCP ≤ 2,0 s, CLS ≤ 0,05, INP ≤ 200 ms em Dashboard/Leads/Conversas).
- Screenshots "depois": `docs/brand/depois/` (mesmo grid do antes).
- Testes: typecheck verde em todos os commits; build + lint + fluxos Playwright da seção 10 do brief na 4.5.

## 7. Riscos e pendências conhecidas

- **Working tree compartilhada**: trabalho alheio (genna/onboarding/Carol) com arquivos untracked e erros de typecheck pré-existentes em `components/agency/onboarding/*` — não tocados; alertar o dono antes de qualquer build de produção (o build pode falhar por causa deles, não do redesign).
- `aliases-v1.css` é temporário — remover na 4.5 após varredura.
- `cristais png` sem extensão (B8) e rota `/ia` duplicada (B10): decisões pendentes.
- Conta de agência para screenshots: `pedro.gabriel@conteudo.orvyn.app` / `KhubBrand2026!` (senha resetada localmente para a auditoria — apenas ambiente local).
