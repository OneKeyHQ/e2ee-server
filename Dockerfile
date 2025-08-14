FROM node:24-alpine AS build

WORKDIR /app

# Copy root package files
COPY package.json yarn.lock .yarnrc.yml ./

# Copy workspace package.json files
COPY packages/transfer-server/package.json ./packages/transfer-server/

# Install dependencies
RUN yarn install --immutable

# Copy source code
COPY packages/transfer-server/ ./packages/transfer-server/

# Build the transfer-server
RUN yarn workspace @onekeyhq/transfer-server build

FROM node:24-alpine

WORKDIR /app

RUN apk add --no-cache tzdata && rm -rf /var/cache/apk/*

# Copy built application
COPY --from=build /app/package.json /app/yarn.lock /app/.yarnrc.yml ./
COPY --from=build /app/packages/transfer-server/package.json ./packages/transfer-server/
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/transfer-server/dist ./packages/transfer-server/dist

ENV TZ="Asia/Shanghai"

EXPOSE 3868

# Add health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3868/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
USER nodejs

CMD ["yarn", "workspace", "@onekeyhq/transfer-server", "start"]
