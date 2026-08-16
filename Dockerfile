# Build:
#   docker build -t memoriaflash-agent .
# Run:
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
ENV CONTENT_AGENT_PRODUCTION_STRICT=true

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --omit=optional && npm cache clean --force
COPY --from=build /app/dist/content-agent.cjs ./content-agent.cjs

# O worker não precisa de privilégios de root.
RUN groupadd --system --gid 10001 agent && useradd --system --uid 10001 --gid agent agent
USER 10001:10001

# Cloud Run Jobs executa até terminar; não expõe porta HTTP.
CMD ["node", "content-agent.cjs"]
