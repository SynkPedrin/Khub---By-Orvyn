#!/usr/bin/env bash
# VIRADA GHL -> KHUB pela API (Studio da Beleza). Rode SÓ depois de PAUSAR o GHL:
# enquanto o GHL estiver ativo, o cliente receberia cada mensagem em dobro.
#
#   KHUB_URL=https://khub-os.vercel.app MASTER_EMAIL=... MASTER_PASSWORD=... bash deploy/virada-ghl-api.sh            # simulação
#   KHUB_URL=... MASTER_EMAIL=... MASTER_PASSWORD=... bash deploy/virada-ghl-api.sh --aplicar                       # executa
#
# Publica os 2 fluxos fiéis ao GHL (Novo Lead v14 e Notificação Interna) e pausa as 2 versões simplificadas. A IA (Ritinha) entra pelo nó
# "Ativar IA" do Novo Lead, não como agente padrão.
set -euo pipefail
: "${KHUB_URL:?}" "${MASTER_EMAIL:?}" "${MASTER_PASSWORD:?}"
APLICAR=0; [ "${1:-}" = "--aplicar" ] && APLICAR=1
J=$(mktemp); trap 'rm -f "$J"' EXIT
curl -sf -c "$J" -o /dev/null -X POST "$KHUB_URL/api/auth/login" -H 'content-type: application/json' \
  -d "{\"email\":\"$MASTER_EMAIL\",\"password\":\"$MASTER_PASSWORD\"}"
A="$KHUB_URL/api/v1/automations/workflows"
LISTA=$(curl -sf -b "$J" "$A")
id_de() { python3 -c "import sys,json; n=sys.argv[1]; l=json.load(sys.stdin); l=l if isinstance(l,list) else l.get('itens',[]); print(next((w['id'] for w in l if w['nome']==n),''))" "$1" <<<"$LISTA"; }
st_de() { python3 -c "import sys,json; n=sys.argv[1]; l=json.load(sys.stdin); l=l if isinstance(l,list) else l.get('itens',[]); print(next((w['status'] for w in l if w['nome']==n),''))" "$1" <<<"$LISTA"; }
echo "== VIRADA ($([ $APLICAR = 1 ] && echo APLICANDO || echo simulação)) =="
# Só os 2 fluxos conferidos contra o histórico do GHL (auditoria 2026-11-16). NÃO publicar:
#  'Resposta na Dm' (boas-vindas em dobro / pergunta de origem para cliente antiga),
#  'Disparo de Mensagem📨' (texto provisório, sem imagem, ritmo 180x o do GHL),
#  'Agendamento Confirmado 📅' (no GHL a confirmação era manual; ninguém chama o webhook).
for n in 'Novo Lead 🚀 (importado do GHL v14)' 'Notificação Interna 🔔 (importado do GHL)'; do
  id=$(id_de "$n"); [ -z "$id" ] && { echo "! ausente: $n"; continue; }
  [ "$(st_de "$n")" = ativo ] && { echo "= já ativo: $n"; continue; }
  ok=$(curl -sf -b "$J" -X POST "$A/$id/validar" -H 'content-type: application/json' -d '{}' | python3 -c "import sys,json;print(json.load(sys.stdin)['ok'])")
  [ "$ok" != True ] && { echo "✗ NÃO valida, não publico: $n"; continue; }
  echo "$([ $APLICAR = 1 ] && echo + || echo →) publicar: $n"
  [ $APLICAR = 1 ] && curl -sf -b "$J" -o /dev/null -X POST "$A/$id/publicar" -H 'content-type: application/json' -d '{}'
done
for n in 'Novo Lead 🚀' 'Notificação Interna 🔔'; do
  id=$(id_de "$n"); [ -z "$id" ] && continue
  [ "$(st_de "$n")" != ativo ] && { echo "= já não-ativo: $n"; continue; }
  echo "$([ $APLICAR = 1 ] && echo - || echo →) pausar duplicata: $n"
  [ $APLICAR = 1 ] && curl -sf -b "$J" -o /dev/null -X PATCH "$A/$id/status" -H 'content-type: application/json' -d '{"status":"pausado"}'
done
echo "== fim =="
