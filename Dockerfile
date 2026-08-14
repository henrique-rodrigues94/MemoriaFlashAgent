# Dockerfile
#
# Build:
#   docker build -t memoriaflash-agent .
# Run local:
#   docker run --rm --env-file .env memoriaflash-agent

FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --omit=optional && npm cache clean --force

COPY --from=build /app/dist/content-agent.cjs ./content-agent.cjs

# Cloud Run Jobs executa até terminar (exit code) — sem porta HTTP exposta.
CMD ["node", "content-agent.cjs"]
