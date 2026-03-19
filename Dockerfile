FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/client/public/manifest.json ./dist/public/
COPY --from=builder /app/client/public/sw.js ./dist/public/
COPY --from=builder /app/client/public/icon-192.png ./dist/public/
COPY --from=builder /app/client/public/icon-512.png ./dist/public/
ENV NODE_ENV=production
EXPOSE 5000
CMD ["node", "dist/index.cjs"]
