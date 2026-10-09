# ---- Builder Stage ----
FROM node:24-alpine AS builder

WORKDIR /app

# Install dependencies first (layer caching)
# --ignore-scripts: no lifecycle script here needs to run, and none should while node_modules is untrusted input
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Copy source and build
COPY src/ ./src/
COPY tsconfig.json ./
RUN npm run build

# Remove dev dependencies
RUN npm prune --production

# ---- Release Stage ----
FROM node:24-alpine

ENV NODE_ENV=production

# Labels for Docker MCP Catalog
LABEL org.opencontainers.image.title="Filesystem MCP" \
      org.opencontainers.image.description="Secure filesystem MCP server for reading, writing, searching, diffing, and patching files." \
      org.opencontainers.image.source="https://github.com/j0hanz/filesystem-mcp" \
      org.opencontainers.image.licenses="MIT" \
      io.modelcontextprotocol.server.name="io.github.j0hanz/filesystem-mcp"

# poppler-utils renders PDF pages for read_pdf_pages; poppler-data and a base
# font cover CJK CMaps and non-embedded standard fonts.
RUN apk add --no-cache poppler-utils poppler-data font-dejavu

# Create non-root user
RUN adduser -D mcp

WORKDIR /app

# Copy built artifacts and pre-compiled dependencies from builder
COPY --from=builder /app/dist ./dist/
COPY --from=builder /app/node_modules ./node_modules/
COPY --from=builder /app/package.json ./

USER mcp

ENTRYPOINT ["node", "dist/index.js"]
