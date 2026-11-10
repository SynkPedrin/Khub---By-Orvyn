# Nicho Médico — áreas, compliance CFM e operação

> Escopo **nicho = medico**. Base para clínicas médicas e estéticas. **A Nyro nunca dá diagnóstico, prescrição ou prognóstico** — orienta, agenda e encaminha ([[RegrasNegocio]] §3). Guardrail CFM em duas camadas.

## Áreas e subespecialidades (escopo `sub`)
Especialidades reconhecidas (lista de referência — cada uma vira uma base `sub` própria conforme a operação curar):
Cardiologia · Neurologia · Dermatologia · Ortopedia e Traumatologia · Ginecologia e Obstetrícia · Pediatria · Psiquiatria · Oftalmologia · Otorrinolaringologia · Endocrinologia · Gastroenterologia · Urologia · Nefrologia · Pneumologia · Reumatologia · Oncologia · Anestesiologia · Radiologia · Medicina de Família · Clínica Médica · Cirurgia (geral e especialidades) · Medicina Estética/Dermatológica.

> A relação oficial de especialidades e áreas de atuação é definida por CFM/AMB/CNRM. ⚠️ CONFIRMAR NA FONTE a lista vigente: [portal.cfm.org.br](https://portal.cfm.org.br/).

## Marcos normativos (referências reais)
- **Código de Ética Médica** — Resolução CFM nº 2.217/2018 (atualizada pelas Resoluções CFM nº 2.222/2018 e 2.226/2019). Base de toda conduta. [portal.cfm.org.br](https://portal.cfm.org.br/)
- **Publicidade médica** — normas do CFM sobre propaganda e publicidade (Manual de Publicidade Médica). ⚠️ CONFIRMAR a resolução vigente (referência recente: Resolução CFM nº 2.336/2023) em [portal.cfm.org.br](https://portal.cfm.org.br/).
- **Telemedicina/telessaúde** — Lei nº 14.510/2022 (alterou a Lei nº 8.080/1990) e regulamentação do CFM. ⚠️ CONFIRMAR a resolução do CFM vigente sobre telemedicina.
- **Prontuário do paciente** — normas do CFM sobre prontuário e sua guarda/digitalização. ⚠️ CONFIRMAR resolução vigente (referência histórica: Resolução CFM nº 1.821/2007).
- **LGPD — dados de saúde** — Lei nº 13.709/2018, art. 11 (dado pessoal **sensível**): exige base legal e cuidado reforçado. [planalto.gov.br](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm)

## Guardrails da Nyro em saúde (o que NÃO fazer)
- ❌ Diagnóstico, prescrição, interpretação de exame, prognóstico.
- ❌ Prometer cura/resultado; usar "antes e depois" sensacionalista; publicar preço/oferta como chamariz onde a norma restringe.
- ❌ Expor dados de paciente; violar sigilo.
- ✅ Orientar sobre agendamento/preparo administrativo, tirar dúvidas gerais NÃO-clínicas, confirmar consulta, encaminhar a um profissional.

## Operação de clínica (pipelines e automações prontos)
Funis do template ([[PRD]] §4.1): **Captação de pacientes · Agendamento · Pós-consulta/Recorrência · Orçamentos de procedimentos**.
Automações: confirmação de consulta (WhatsApp), resgate de no-show, follow-up de orçamento, pesquisa de satisfação (NPS), reativação de pacientes inativos.
Boas práticas: lembrete 24–48h antes; confirmação com opção de remarcar; lista de espera para preencher furos; consentimento LGPD no cadastro.

> ⚠️ CURADORIA (com a operação): protocolos de preparo por procedimento, FAQ por especialidade, tabela de convênios, scripts de confirmação — sempre revisados por profissional.
