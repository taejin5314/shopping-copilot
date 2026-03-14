# ── build stage ──
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# ── runtime stage ──
FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends wget && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/dist dist/
COPY --from=build /app/node_modules node_modules/
COPY package.json ./
COPY public/ public/
COPY start.sh ./
RUN chmod +x start.sh

# Pre-install ikea-mcp so IKEA queries work without network fetch at startup
RUN npm install -g ikea-mcp@latest

ENV PORT=4000
ENV MCP_URL=http://localhost:3000
EXPOSE 4000

CMD ["./start.sh"]
