# @khub/web — Front-end + cérebro Obsidian como backend

App Next.js 14 (App Router) do KHUB. O **backend é o cérebro Obsidian**: as notas markdown em `Nyro IA/cerebro/` são a fonte de dados, lidas pelo filesystem em `lib/cerebro.ts` e servidas por Route Handlers (`app/api/...`). Ver **ADR-0005** em `Nyro IA/cerebro/Arquitetura.md`.

## Rodar (dev)

```bash
# ative o Node do projeto (nvm) se necessário
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"

cd "apps/web"
npm install
npm run dev            # http://localhost:3000
```

> ⚠️ **Porta 3000 já é usada por outro projeto nesta máquina ("SmartFood").** Rode em outra porta:
> `npm run dev -- -p 3221`  (ou `npx next start -p 3221` após `npm run build`).

Verificação usada nesta entrega (tudo verde na porta 3221):
```bash
npm run typecheck && npm run build
npx next start -p 3221
curl -s localhost:3221/api/health           # {service:"khub-web", backend:"cerebro-obsidian", docs:10}
curl -s localhost:3221/api/cerebro           # índice do cérebro
curl -s localhost:3221/api/cerebro/RAG/RAG   # doc aninhado
```

## Onde fica o cérebro
`lib/cerebro.ts` resolve o vault por candidatos, ou via env:
```bash
CEREBRO_DIR="/caminho/para/Nyro IA/cerebro" npm run dev
```

## Estrutura
```
app/
  layout.tsx              # shell: Topbar + Sidebar + painel Nyro + CommandBar
  page.tsx                # dashboard (hero, stats, cards do cérebro, empty state c/ CTA Nyro)
  cerebro/[...slug]/page.tsx   # leitor de documento (markdown + wikilinks)
  not-found.tsx
  api/
    health/route.ts             # GET /api/health
    cerebro/route.ts            # GET /api/cerebro          (índice)
    cerebro/[...slug]/route.ts  # GET /api/cerebro/<slug>   (documento, 404 RFC7807)
lib/cerebro.ts            # BACKEND: leitura do vault, guard anti path-traversal
components/               # Topbar, Sidebar, NavLink, NyroPanel, CommandBar, Markdown, Logo
public/logo.png          # marca (copiada da raiz do projeto)
```

## O que já cobre do F0 Bloco 4 (design system)
- Tokens de marca (`#7B2FBE`, creme, dark mode) em `globals.css` + `tailwind.config.ts`.
- Mobile-first (sidebar colapsa, painel Nyro vira FAB no mobile).
- Painel lateral da Nyro + command bar `Cmd/Ctrl+K`.
- Zero tela em branco: dashboard e not-found têm CTA da Nyro; empty state quando o cérebro está vazio.
