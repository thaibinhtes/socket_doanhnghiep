FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

ENV SOCKET_PORT=3001 \
    REDIS_HOST=redis \
    REDIS_PORT=6379 \
    REDIS_CHANNEL=mobi:import-events

EXPOSE 3001

CMD ["npm", "start"]
