# Blueprints — Templates Verticais (JSON declarativo)

> Blueprints versionados que descrevem o CRM provisionado por nicho. **Ainda vazio.** Escopo de **F2 — Templates + Provisionamento**, não de F0.

Cada template segue a estrutura do PRD §4.2:

```
<template>/
  manifest.json     # id, versao, nicho, subespecialidades
  pipelines.json    # funis, etapas, probabilidades, SLAs
  fields.json       # campos custom por entidade
  automations.json  # workflows (mesmo schema do motor)
  messages.json     # templates de WhatsApp/e-mail
  dashboards.json   # widgets e KPIs do nicho
  nyro/             # persona, regras e ponteiro para a base RAG
```

Templates MVP a definir em F2 (PRD §4.1): **Clínica Médica**, **Advocacia**, **Contabilidade**.

> ⚠️ LACUNA: O JSON Schema formal de cada arquivo do blueprint não está no PRD. Definir em F2 e registrar ADR. Ver [[PRD]] §4.2 e [[Tasks]] backlog F2.
