FROM node:24-alpine AS build

WORKDIR /app

# Use the Yarn version pinned by packageManager in package.json
RUN corepack enable

# Copy root package files
COPY package.json yarn.lock .yarnrc.yml ./

# Copy all workspace manifests so the immutable install matches yarn.lock
COPY packages/transfer-server/package.json ./packages/transfer-server/
COPY packages/cloud-sync-server/package.json ./packages/cloud-sync-server/
COPY examples/mock-app/package.json ./examples/mock-app/

# Install dependencies
RUN yarn install --immutable

# Copy source code
COPY packages/transfer-server/ ./packages/transfer-server/

# Build the transfer-server
RUN yarn workspace @onekeyhq/transfer-server build

# Keep the runtime copy valid even when all dependencies are hoisted
RUN mkdir -p packages/transfer-server/node_modules

FROM node:24-alpine

WORKDIR /app

RUN apk add --no-cache tzdata && rm -rf /var/cache/apk/*

# Copy built application
COPY --from=build /app/package.json /app/yarn.lock /app/.yarnrc.yml ./
COPY --from=build /app/packages/transfer-server/package.json ./packages/transfer-server/
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/transfer-server/node_modules ./packages/transfer-server/node_modules
COPY --from=build /app/packages/transfer-server/dist ./packages/transfer-server/dist

ENV TZ="Asia/Shanghai"

EXPOSE 3868

# Add health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3868/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
USER nodejs

WORKDIR /app/packages/transfer-server

CMD ["node", "dist/server.js"]
