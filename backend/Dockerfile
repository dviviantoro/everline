FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/tsconfig.json ./tsconfig.json
# src/ (TS source, not just compiled dist/) is needed too: `npm run seed`
# runs scripts/seed.ts directly via tsx, which imports ../src/* as TypeScript.
COPY --from=build /app/src ./src

# tsx is a devDependency (used for `npm run seed`) — install it standalone
# in the runtime image too, so `docker compose exec api npm run seed` works
# without needing a separate build stage just for the seed script.
# --include=dev overrides NODE_ENV=production (set above), which npm
# otherwise uses to silently skip devDependencies even when named explicitly.
RUN npm install --no-save --include=dev tsx

RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 3001
CMD ["node", "dist/src/index.js"]
