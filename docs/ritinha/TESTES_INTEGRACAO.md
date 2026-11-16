# TESTES DE INTEGRAÇÃO — Avec e canais

> Não iniciado (Fase Zero = somente leitura).

## Estado conhecido
- Avec: sem API de escrita conhecida; extração read-only validada em 14/11 (totais 1:1 com o Avec).
- Importação idempotente provada no QA (2ª rodada 0 criados).
- Canais: Stevo conectado e entregando; Meta conectada; Evolution `connecting/unknown`.

## Plano
1. Re-extração Avec (read-only) para medir drift desde 14/11.
2. Se houver caminho de escrita no Avec: criar/ler/reagendar/cancelar em ambiente de teste, com reversão — **nunca em cliente real sem autorização**.
3. Idempotência de webhook (coberta pelo BUG-041 no QA: 20 entregas simultâneas, 0 falhas — repetir em produção após deploy).
4. Isolamento entre subcontas em cada novo caminho.
