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

## 6. Métricas (Fase 4.5)

**Build/lint/typecheck**
- `next build`: **verde** (57 páginas; First Load JS compartilhado **87,5 kB** — dentro do orçamento de 60 kB adicionais, pois a camada visual não adicionou nenhuma dependência de runtime; só CSS e fontes woff2 locais).
- `next lint`: **0 erros** (warnings pré-existentes não tocados).
- `tsc --noEmit`: verde em todos os commits do redesign. Permanecem erros PRÉ-EXISTENTES do trabalho alheio incompleto em `components/agency/onboarding/*` (não tocados, não bloqueiam o build — rota `/agency/onboarding` é deles).

**Web Vitals** (`scripts/brand-vitals.mjs`, build de PRODUÇÃO `next start`, Chrome headless, API local Nest+Docker em modo watch):
| Rota | LCP | CLS |
|---|---|---|
| /login (estática) | **0,06 s** | 0,000 |
| /dashboard | 3,39 s | 0,001 |
| /leads | 3,12 s | 0,002 |
| /conversas | 3,49 s | 0,020 |
CLS dentro do orçamento (≤ 0,05) em todas. **LCP acima da meta de 2,0 s nas rotas de dados — gargalo medido: a API local em modo watch responde ~3 s por query** (a camada visual entrega LCP de 0,06 s na rota estática). Regra: re-medir contra a API de produção antes de cobrar a meta; sem dados, INP não foi medido (sem interações sintéticas representativas).

**Valores arbitrários** (mesmo método da auditoria, grep em `app/`+`components/` tsx):
- Antes: 1.487 totais · 953 `text-[px]`. Depois: 1.604 · 1.058 — **mas o delta líquido do diff da branch é −7** (47 adicionados em linhas tocadas, 54 removidos). A divergência vem de arquivos do trabalho alheio adicionados na árvore (onboarding/genna) no mesmo período, não do redesign.
- Zero valores arbitrários nos arquivos NOVOS do redesign (tokens.css, design-system, loading.tsx, AnimatedNumber).
- **Pendência**: o zero absoluto da seção 10 exige burn-down por módulo (plano: ligar a regra `no-arbitrary-value` por pasta a partir dos módulos migrados). Registrado como dívida com dono e prazo a definir.

**Screenshots depois**: `docs/brand/depois/` (mesmo grid de 136 do antes).

**Testes**: `scripts/brand-fluxos.mjs` — 6/6 PASS (login, criar lead abre modal, pipeline renderiza colunas, mover mostra toast, Desfazer reverte, busca global abre).

## 8. Notas (0–10, antes → depois)

| Critério | Antes | Depois | Justificativa (uma linha) |
|---|---|---|---|
| Identidade de marca | 4 | 8 | Antes: marca só no login e 3 limes divergentes; depois: lime=sinal/violeta=IA consistentes nas telas migradas, aurora rara, logo sem caixa |
| Estética | 5 | 8 | Antes: glass+glow em tudo, "SaaS amador"; depois: superfícies quietas, display font, hierarquia por espaço (diretriz do dono aplicada) |
| Profissionalismo | 5 | 8 | Antes: wallpaper WhatsApp, bolhas hardcoded, env vars na UI; depois: tokens em todo chrome, densidade Linear-like |
| Consistência | 4 | 7 | Antes: 3 brand, raios/glows livres; depois: tokens + aliases unificam o legado, mas telas não migradas ainda convivem (aliases temporários) |
| Hierarquia visual | 5 | 8 | Antes: cards para tudo, glow decorativo; depois: cor com função aprendível, um gradiente por tela, foco lime visível |
| Facilidade de uso | 6 | 8 | Antes: toolbar B1, grupos vazios B5, sem Desfazer; depois: toolbar limpa, chips, Desfazer no pipeline, loading em 22 rotas |
| Responsividade | 6 | 7 | Antes/depois verificados em 390/768/1280/1440; pendente: thread do Inbox estreita em exatamente 1440px (pré-existente, follow-up registrado) |
| Acessibilidade | 6 | 8 | Antes: texto branco sobre lime (~20 lugares), foco inconsistente; depois: `.text-on-brand`, 27/27 pares AA, aria mantido; auditoria leitor de tela não refeita |
| Performance | 6 | 7 | CLS 0,001–0,020 (meta ≤0,05), bundle sem deps novas (+0 kB runtime); LCP preso à API local lenta (shell 0,06 s) — re-medir em produção |
| Qualidade técnica | 6 | 8 | Tokens + aliases com estratégia de remoção, zero deps de runtime, typecheck/lint verdes, testes de fumaça 6/6; dívida: burn-down de valores arbitrários |

**Médias: 5,3 → 7,6.**

## 7. Riscos e pendências conhecidas

- **Working tree compartilhada**: trabalho alheio (genna/onboarding/Carol) com arquivos untracked e erros de typecheck pré-existentes em `components/agency/onboarding/*` — não tocados; alertar o dono antes de qualquer build de produção (o build pode falhar por causa deles, não do redesign).
- `aliases-v1.css` é temporário — remover na 4.5 após varredura.
- `cristais png` sem extensão (B8) e rota `/ia` duplicada (B10): decisões pendentes.
- Conta de agência para screenshots: `pedro.gabriel@conteudo.orvyn.app` / `KhubBrand2026!` (senha resetada localmente para a auditoria — apenas ambiente local).
