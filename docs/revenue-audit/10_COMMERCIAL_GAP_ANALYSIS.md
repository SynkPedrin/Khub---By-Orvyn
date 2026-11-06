# 10 — Gap Comercial

> Comparação conceitual (nenhuma paridade afirmada sem teste). Base: leitura de código; sem validação em runtime.

## 1. O que já entrega bem (por leitura)
- Multi-tenancy com RLS FORCE nas tabelas de negócio e funções SECURITY DEFINER.
- Motor de automações persistido (delay sobrevive a restart), versão imutável por run, DLQ com reprocesso, 7 templates executáveis.
- Nyro com tools tipadas, aprovação humana e audit.
- Troca de cliente sem logout (owner/admin).
- Chaves de API privadas com hash.

## 2. O que concorrentes entregam e o Revenue OS não
| Capacidade | GoHighLevel / HubSpot / Pipedrive / Kommo | Revenue OS |
|---|---|---|
| Conexão Meta/WhatsApp estável por subconta | Sim (maduro) | Defeitos P0 (token, multi-cliente, Evolution) |
| Visão consolidada de agência com saúde por cliente | GHL sim | Não |
| Snapshot/template de conta de cliente | GHL sim | Só 3 blueprints fixos |
| Importação CSV, dedupe | Todos | Não / só inbound |
| Criar funil e oportunidade na UI | Todos | Não |
| Agenda com sync de calendário | Todos | Backend local; Google Calendar é stub |
| Billing/planos para revenda | GHL SaaS mode | Inexistente |
| Recuperação de senha, verificação de e-mail | Todos | Não |
| Marketplace de integrações / webhooks de saída | Todos | Não |

## 3. Ausências que impedem a venda
1. Meta confiável por cliente (P0).
2. Saúde e revogação de acesso na agência (P0).
3. Operação sem dev: criar funil/oportunidade/lead pela UI, menu que leva às telas reais.
4. Inbox em tempo real e sem perda de mensagem.
5. Recuperação de senha.
6. Dados fictícios fora de produção (`AdsSimulador`, "Plano Pro").

## 4. Ausências que podem esperar
Google Ads, TikTok, Instagram DM, Messenger, WhatsApp Cloud API, CAPI, Zapier/n8n/Make nativos, CRMs externos, billing automatizado, templates de agência avançados.

## 5. Onde diferenciar
- Nyro como configuradora (cria funil, instala automações, aplica blueprint) e RAG por nicho: algo que GHL não faz bem. **Depende de chave Anthropic/Voyage, ainda não validada.**
- Nichos regulados (clínica, advocacia, contabilidade) com guardrails.
- Motor com delay persistido e aprovação humana.

## 6. Respostas
- **Agency Mode comercialmente útil?** Não ainda. Provisiona e troca de cliente, mas sem saúde, revogação, templates e billing.
- **Onboarding simples?** Não; sem fluxo guiado, vários passos manuais e dependência de seed para criar agência.
- **Risco operacional alto?** Sim: tenant errado no Meta, perda de mensagens, follow-up que não cancela, ação duplicada em retry.
- **Integrações indispensáveis:** WhatsApp (Evolution) e Meta Lead Ads. Resto é P2/P3.

## 7. Oferta mínima vendável (MVP comercial)
Para pequenas agências de tráfego pago, até 5 clientes: WhatsApp via Evolution estável + Meta Lead Ads com seleção por cliente + Kanban operável pela UI + 5 automações-chave (novo lead, primeiro atendimento, lead sem resposta, follow-up de orçamento, reativação) + painel de saúde por cliente + recuperação de senha. Billing manual no início.

## 8. Prioridade de integrações
| Prioridade | Pequenas agências de tráfego | Agências maiores |
|---|---|---|
| P0 | Evolution/WhatsApp, Meta Lead Ads (com renovação e seleção por cliente) | + segredo por instância, `state` OAuth seguro |
| P1 | Meta Ads métricas/criativos, e-mail, webhook de entrada | + monitor de expiração, rate limit por app |
| P2 | Google Calendar, Google Ads | CRMs externos, webhooks de saída |
| P3 | TikTok, Instagram DM, Messenger, CAPI, Cloud API | Zapier/n8n/Make |
