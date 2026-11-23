# 01 · Auditoria de Identidade — KHUB (v2 "Signal + Intelligence")

Data: 2026-11-22 · Branch: `feat/brand-identity-v2` · Ambiente: local (API :3333, web :3210, tenant demo "Clínica Vitta Prime")
Screenshots: `./antes/` (1440×900 e 390×844, dark e light). Dados 100% de seed demo (fictícios), sem PII real.

**Decisão de modo (registrada):** o dono aprovou **modo autônomo** no intake. Esta auditoria + a direção da Fase 2 ficam registradas aqui e em `02-direcao-de-arte.md`; a implementação prossegue sem pausa no checkpoint.

---

## 1. Inventário de marca

### 1.1 Logo e símbolos (`apps/web/public/`)

| Asset | Pixels | Uso hoje | Notas |
|---|---|---|---|
| `khub-logo.png` | 711×261 | Sidebar, BrandMark, e-mails, agency-invite | Lockup completo: K 3D violeta-glossy + "HUB" violeta + tagline "by ORVYN ai". Fundo transparente. **Perde contraste no dark** (violeta sobre quase-preto). |
| `khub-logo-white.png` | 711×261 | **não usado** | Versão branca flat p/ dark. Sem a tagline. |
| `khub-mark.png` | 338×338 | Sidebar, AuthShell, favicons internos | Só o K 3D: corpo violeta + lâmina lime. Funciona em claro e escuro médio. |
| `khub-mark-white.png` | 338×338 | **não usado** | ⚠️ Artefato: fragmento de glifo extra na borda direita — inspecionar antes de usar. |
| `khub-icon.png` | 512×512 | favicon/app icon | Quadrado near-black #0B0A10 com o K centrado. Autossuficiente. |
| `nico-avatar.png` | 256×256 | NICO, ModoSimples, automações | Estrela/crystal chrome de 8 pontas com reflexos violeta+lime. Lê bem nos dois temas. |
| `nico-logo.png` | 2172×724 | /nyro, /ia | Wordmark "nico" em gel translúcido: contorno violeta, preenchimento branco, sombras lime. |
| `khub-chrome-star.png` | 1194×1196 | **não usado** | Fonte hi-res do avatar NICO. |
| `crystal-video.mp4` | 5,2 MB | `KhubBrandMotion.tsx` | Vídeo de cristal (motion de marca). |
| `khub-wallpaper.jpg` | 1672×941 | Hero do login (AuthShell), `.ambient-bg`, transição de operação | Arte fluida violeta/lime. |
| `Background-login.png` | 3,0 MB | e-mails transacionais da API | — |
| `logos/*.webp` | ~7–15 KB | Ícones de canal (Google Ads, Instagram, Meta, TikTok, WhatsApp, YouTube) | Usados em BrandLogo/origem de lead. |
| **Sem uso (12)** | — | khub-logo-white, khub-mark-white, khub-chrome-star, khub-background.png, 2377084.webp, logo-nyro.png, mockup1/2, logo-insta/whats/meta, `cristais png` (**sem extensão — bug de arquivo**), inter-latin-variable.woff2 | Candidatos a limpeza ou ativação. |

**Cores dominantes do logo (amostradas via PIL, px opacos):** violeta #301072–#361080 com picos ~#5A1BCE; lime #C7F226/#A3DA3A. **Confirma o brief:** violeta profundo + lime são o DNA do símbolo.

Área de respiro recomendada: ~½ largura do K em todos os lados (o crop atual é justo).

### 1.2 Cores realmente usadas (contagem exata, grep em `app/ components/ lib/`)

- `#B6FF00`: **7** ocorrências (4 em globals.css + 3 em teste). `#C8FF4D`: **1**. `#D6FF8F`: **7**.
- Violetas do brief (#331177/#4411AA/#5511CC/#8F6BFF): **0 — não existem no código.**
- Violetas reais do produto: `#7b2eff` (brand do tema claro!), `#a66bff`, `#8b35ff`, `#a855f7`, `#6a1fe6`, `#8b5cf6` (cat-1 dos gráficos + canal e-mail).
- **Três valores diferentes de `--brand`:** `#9bee45` (:root default, usado no login/LP), `#b6ff00` (dark), `#7b2eff` (light) — o "dois limes" documentado no v1 está confirmado e na verdade são três.

Famílias de tokens (globals.css, 3.010 linhas): `--base-*` (4 superfícies ×3 contextos), `--brand*`/`--khub-lime-*` (duplicadas entre si), `--lg-*` (liquid glass, 15+ vars), `--glow-*`, `--edge*`, `--cat-1..4` (gráficos), `--ch-*` (canais), `--lp-*` (marketing), `--r-*` (6 raios), `--s-*` (espaçamento), `--sh-*`, `--z-*`, `--dur-*` + aliases legados (`--glass-*`, `--amethyst-*` = clones de lime, `--lilac`).

### 1.3 Tipografia

| Fonte | Arquivo | Status |
|---|---|---|
| **Manrope** (variable 200–800) | `manrope-latin-variable.woff2` | Sans de UI, via `next/font/local` → `--font-sans`. Única sans carregada. |
| **Instrument Serif** (400 normal + itálica) | 2 arquivos | Acento editorial: `.t-accent`, `.lp-serif`, usada em 1 tsx direto. |
| Inter (variable) | `inter-latin-variable.woff2` | **Órfã** — arquivo existe, nunca carregada (comentário desatualizado em globals.css:565 diz que Inter está carregada). |
| **FK Grotesk Neue** | — | **NÃO EXISTE** no repositório nem é referenciada. A premissa do brief cai: não há display de marca licenciada disponível. |

Escala atual (tailwind.config): 11/12/13/14/15/16/20/24/30/34 — 10 tamanhos, **mais 953 usos de `text-[..px]` arbitrários** fora da escala.

### 1.4 Valores arbitrários (números do lint futuro)

- Classes Tailwind arbitrárias (`w-[`, `text-[`, etc.): **1.487**
- `text-[<n>px]`: **953** · `rounded-[...]`: **21**
- Meta da seção 10: **zero**.

---

## 2. Onde a marca aparece forte × onde desaparece

**Forte:**
- **Login/Auth** (`AuthShell.tsx`): split 52/48, hero com `khub-wallpaper.jpg`, headline "Transforme operação em **receita.**" (acento em gradiente `#d6ff8f→#9bee45`), wordmark + benefícios. É o único momento de marca plena.
- **NICO**: orbe/avatar crystal com halo, `/nyro` tem identidade própria — mas em **lime**, não violeta (ver conflito §3).
- **Landing (marketing)**: família `--lp-*` própria com lime #b6ff00 + violeta #8b35ff — a LP é mais "KHUB" que o produto.

**Fraca/ausente:**
- **Tabelas, formulários, configurações, financeiro**: cinza neutro total; o lime aparece só em botões primários e links; o **violeta sumiu do produto dark** (só existe como `--violet*` em dark para badges "IA" no inbox e no tema claro como brand).
- **Gráficos**: paleta `--cat-*` genérica (roxo Tailwind, laranja, azul, verde) — nenhuma relação com a marca.
- **Inbox**: papel de parede do WhatsApp (`fundo-claro.jpg` **no tema escuro**, inversão registrada como "escolha do dono" em globals.css:48) + bolhas `#d9fdd3`/`#005c4b` hardcoded — o app importa a identidade do WhatsApp em vez de impor a própria.
- **Agency**: mesmas telas do cliente, nenhum marcador de camada "visão de agência".

---

## 3. Conflitos e achados

1. **Três `--brand` diferentes** (#9bee45/#b6ff00/#7b2eff) por contexto — e no claro o brand é violeta, não lime.
2. **Violeta ausente do dark** apesar de ser 50% do logo. Tokens `--violet*` só existem nos blocos dark/light, não no :root default (login).
3. **CONFLITO DE DIRETRIZ — ADR-0040 vs brief:** `components/nico/Nico.tsx:5-14` documenta "NICO = lime; Agentes de IA = violeta". O brief manda "tudo que é IA vira violeta: NICO, agentes, sugestões, automações rodando". **Decisão (modo autônomo):** seguir o brief — violeta = inteligência, inclusive NICO — e atualizar o ADR-0040/comentário no código na Fase 4. Racional: uma única semântica aprendível ("violeta = a IA está agindo") vale mais que a distinção interna marketing/atendimento; o lime fica 100% reservado a *sinal/ação do usuário*.
4. **Lime como texto em fundo claro:** `--khub-lime` vira `#a66bff` no claro (gambiarra que resolve contraste trocando de cor) — confirma o problema e sugere a solução correta (lime-ink escuro para texto, lime só como preenchimento).
5. **Glows decorativos:** `--glow-lg`, `box-shadow lp-card/lp-pop` rgba(123,46,255,…) hardcoded no tailwind.config.
6. **Wallpaper WhatsApp invertido** (foto clara no tema escuro) + bolhas com hex do WhatsApp hardcoded.
7. **`cristais png`** sem extensão; `inter-latin` órfã; comentários do CSS contradizem os valores (dizem "roxo como iluminação" onde o valor é lime; dizem "dark nunca principal" sendo dark o default server-rendered).
8. **E-mails transacionais** (`apps/api/src/common/invite-email.ts`, `password-reset-email.ts`) referenciam **`/logo-revenue.png` que não existe** → imagem quebrada no e-mail. Nodemailer, não Resend.
9. **Loading:** 0 `loading.tsx` em 67 rotas; skeleton é classe CSS usada em 30 lugares, estados hand-rolled por página.
10. **Dois seletores de conta** (SubaccountSwitcher na sidebar × AccountMenu na topbar) com fontes derivadas diferentes — causa provável do "seletor desincronizado" (detalhes em `bugs.md`).

---

## 4. Moodboard textual (adjetivos de marca, justificados)

1. **Noturno** — o produto inteiro nasce dark (#050505), a LP é dark, o ícone é quase-preto.
2. **Elétrico** — o lime #B6FF00 é literalmente tensão; usado em doses pequenas funciona como corrente.
3. **Inteligente** — o cristal chrome da NICO e o violeta do K pedem uma semântica de "mente", não de enfeite.
4. **Fluido/orgânico** — wallpaper e arte do login são líquidos/vitreous, não geométricos.
5. **Preciso** — CRM denso, mono/tabular nos números, toolbar de trabalho (régua: Linear).
6. **Premium** — glossy 3D do K, glass já presente nos tokens `--lg-*`; falta disciplina, não repertório.
7. **Calor humano** — Instrument Serif nos acentos e tom de voz pt-BR direto ("Mais conversas · Mais receita").

**Síntese:** *"uma central de comando noturna, elétrica e viva — onde o lime é o sinal do usuário e o violeta é a mente da IA."*

---

## 5. Screenshots "antes"

Em `./antes/`, nomeados `<rota>-<tema>-<viewport>.png`. Cobertura: login, signup + 22 rotas de cliente + 7 de agência × dark/light × 1440×900/390×844.

## 6. Bugs funcionais encontrados (não visuais) → ver `bugs.md`

Consolidados os já conhecidos + novos: e-mail com logo quebrada (#8), `cristais png` sem extensão, bolhas WhatsApp hardcoded, ConfigRequired expondo nomes de env vars, etc.
