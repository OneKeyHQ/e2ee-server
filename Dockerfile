FROM node:20-alpine AS build

WORKDIR /app

# Copy root package files
COPY package.json yarn.lock .yarnrc.yml ./

# Copy workspace package.json files
COPY packages/e2ee-server/package.json ./packages/e2ee-server/

# Install dependencies
RUN yarn install --immutable

# Copy source code
COPY packages/e2ee-server/ ./packages/e2ee-server/

# Build the e2ee-server
RUN yarn workspace @onekeyhq/e2ee-server build

FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache tzdata && rm -rf /var/cache/apk/*

# Copy built application
COPY --from=build /app/package.json /app/yarn.lock /app/.yarnrc.yml ./
COPY --from=build /app/packages/e2ee-server/package.json ./packages/e2ee-server/
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/e2ee-server/dist ./packages/e2ee-server/dist

ENV TZ="Asia/Shanghai"

EXPOSE 3868

CMD ["yarn", "workspace", "@onekeyhq/e2ee-server", "start"]
