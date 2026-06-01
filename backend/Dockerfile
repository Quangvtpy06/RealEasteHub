FROM node:22-alpine

WORKDIR /app

COPY backend/package*.json ./backend/

WORKDIR /app/backend
RUN npm ci --omit=dev

WORKDIR /app
COPY backend/src ./backend/src
COPY artifacts ./artifacts

WORKDIR /app/backend
EXPOSE 3000

CMD ["node", "src/server.js"]
