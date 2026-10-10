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

# Helpers for the binary-reading tools:
# - poppler-utils (+poppler-data, a base font): read_pdf_pages for PDF
# - djvulibre: read_pdf_pages for DjVu; ffmpeg: DjVu PNG re-encode and read_video_frames
# - antiword: read_document for Word 97-2003 .doc (CJK-safe)
# - python3 + mobi (GPL-3.0, run as a separate process): read_document for AZW3/MOBI
RUN apk add --no-cache poppler-utils poppler-data font-dejavu djvulibre ffmpeg antiword python3 \
 && python3 -m venv /opt/mobi \
 && /opt/mobi/bin/pip install --no-cache-dir mobi==0.4.1
ENV FS_MOBI_PYTHON=/opt/mobi/bin/python

# Create non-root user
RUN adduser -D mcp

# Fork: where locate saves its filename index (FS_INDEX_DIR). A named volume
# mounted here inherits this ownership; the NAS runs the container as 1000:1000.
RUN mkdir -p /index && chown 1000:1000 /index

WORKDIR /app

# Copy built artifacts and pre-compiled dependencies from builder
COPY --from=builder /app/dist ./dist/
COPY --from=builder /app/node_modules ./node_modules/
COPY --from=builder /app/package.json ./

USER mcp

ENTRYPOINT ["node", "dist/index.js"]
