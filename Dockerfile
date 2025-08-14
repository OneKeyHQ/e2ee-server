FROM node:20-alpine AS build

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

FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache tzdata && rm -rf /var/cache/apk/*

# Copy built application
COPY --from=build /app/package.json /app/yarn.lock /app/.yarnrc.yml ./
COPY --from=build /app/packages/transfer-server/package.json ./packages/transfer-server/
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/transfer-server/dist ./packages/transfer-server/dist

ENV TZ="Asia/Shanghai"

EXPOSE 3868

CMD ["yarn", "workspace", "@onekeyhq/transfer-server", "start"]
