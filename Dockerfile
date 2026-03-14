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
WORKDIR /app
COPY --from=build /app/dist dist/
COPY --from=build /app/node_modules node_modules/
COPY package.json ./
COPY public/ public/

# Pre-install ikea-mcp so IKEA queries work without network fetch at startup
RUN npm install -g ikea-mcp@latest

ENV PORT=4000
ENV MCP_URL=http://localhost:3000
EXPOSE 4000

# ikea-mcp on port 3000 (internal), shopping-copilot on $PORT (exposed)
CMD ["sh", "-c", "PORT=3000 ikea-mcp & node dist/api/http.js"]
