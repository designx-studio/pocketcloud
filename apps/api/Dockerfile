FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY apps/api/package*.json apps/api/
RUN npm ci
COPY apps/api apps/api
RUN npm run build -w apps/api
FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY apps/api/prisma ./prisma
COPY apps/api/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh
USER node
ENTRYPOINT ["./entrypoint.sh"]
CMD ["node","dist/server.js"]
