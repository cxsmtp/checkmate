# Checkmate event scanner — one image for Docker and Podman (amd64 and arm64).
# Everything it keeps (registrations, settings, samples, installed updates) lives in /data.
#
#   docker run -d --name checkmate -p 3000:3000 -v checkmate-data:/data ghcr.io/cxsmtp/checkmate:latest
#
# The first start prints the admin password in the container log:
#   docker logs checkmate

# Both stages start from plain Alpine with Alpine's own Node.js, so the runtime
# image carries no package manager (and none of its CVEs).

# ---- Dependencies: installed with npm here, only node_modules moves on ----
FROM docker.io/library/alpine:3.24 AS deps

# Building behind a proxy that inspects TLS? Pass its CA certificate:
#   docker build --secret id=ca,src=company-ca.pem -t checkmate .
RUN --mount=type=secret,id=ca,required=false \
    if [ -s /run/secrets/ca ]; then cat /run/secrets/ca >> /etc/ssl/certs/ca-certificates.crt; fi && \
    apk add --no-cache nodejs~=24 npm~=11
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=ca,required=false \
    if [ -s /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi && \
    npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# ---- The file list: every file the image runs, with its SHA-256 (src/integrity/) ----
# The release workflow signs this exact file (a GitHub build attestation, logged by Sigstore), and
# the server checks its own files and that signature (Admin → Updates & integrity).
FROM deps AS integrity
ARG APP_VERSION=""
ARG APP_COMMIT=""
ARG APP_REPOSITORY=""
COPY src ./src
COPY public ./public
COPY scripts ./scripts
# CI stamps every build with its own version (major.minor from package.json, patch = run number),
# so each push to main is a newer release the running containers can update to.
RUN if [ -n "$APP_VERSION" ]; then node -e "const f='package.json',p=JSON.parse(require('fs').readFileSync(f));p.version=process.argv[1];require('fs').writeFileSync(f,JSON.stringify(p,null,2)+'\n')" "$APP_VERSION"; fi && \
    node scripts/integrity.mjs write /app --commit "$APP_COMMIT" --repository "$APP_REPOSITORY"

# The file list alone, for the release workflow to sign: docker buildx build --target integrity-out --output type=local,dest=out .
FROM scratch AS integrity-out
COPY --from=integrity /app/integrity.json /

# ---- Runtime: Node.js without a package manager, runs as `node` (uid 1000) ----
FROM docker.io/library/alpine:3.24
ARG APP_VERSION=""

# tini: passes stop signals on and reaps child processes. `apk upgrade` takes OS packages to their latest fixes.
RUN --mount=type=secret,id=ca,required=false \
    if [ -s /run/secrets/ca ]; then cat /run/secrets/ca >> /etc/ssl/certs/ca-certificates.crt; fi && \
    apk upgrade --no-cache && \
    apk add --no-cache nodejs~=24 tini~=0.19 && \
    addgroup -g 1000 -S node && adduser -u 1000 -S -G node -h /home/node node

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=integrity /app/package.json /app/package-lock.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY --from=integrity /app/integrity.json ./
# The Node.js this image runs (# checkmate-runtime): an update that needs another one says so.
RUN node -p "process.versions.node" > .node-version # checkmate-runtime

RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data \
    TZ=UTC

LABEL org.opencontainers.image.title="Checkmate event scanner" \
      org.opencontainers.image.source="https://github.com/cxsmtp/checkmate" \
      io.checkmate.version="${APP_VERSION}"

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "scripts/healthcheck.mjs"]

# The launcher runs the version chosen under Admin → Updates (or this image's own), switches and
# rolls back without a container restart. `node src/server.js` still works on its own.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/launch.js"]
