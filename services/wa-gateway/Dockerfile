# wa-gateway (KHUB) — Node 20 + Chromium do Debian, usuário sem root, dados em /data.
FROM node:20-bookworm-slim

# Chromium + bibliotecas que o puppeteer precisa + fontes (emoji/acentos nas
# capturas) + tini (recolhe processos filhos do Chromium).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium fonts-liberation fonts-noto-color-emoji ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    CHROME_PATH=/usr/bin/chromium \
    CHROME_NO_SANDBOX=1 \
    DATA_DIR=/data \
    PORT=8080

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src

RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080

# /health exige a chave (contrato); o healthcheck roda dentro do contêiner, onde ela já está no env.
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health',{headers:{'x-gateway-key':process.env.OPENWA_GATEWAY_KEY}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/index.js"]
