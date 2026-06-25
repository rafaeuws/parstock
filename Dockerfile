# Imagem única: compila o front-end e roda a API
FROM node:20-bookworm-slim

# Dependências de build para o módulo nativo do SQLite (better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/app/data/parstock.db
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["npm", "start"]
