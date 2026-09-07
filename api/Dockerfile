FROM node:22-alpine

WORKDIR /app

# Dependency layer first so source edits don't trigger a reinstall.
COPY package.json ./
RUN npm install

# Prisma client is generated at build time from the schema.
COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json next.config.ts ./
COPY src ./src

EXPOSE 3000

CMD ["npm", "run", "dev"]
