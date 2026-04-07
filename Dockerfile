FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

COPY server.js ./
COPY src ./src
COPY public ./public
COPY data ./data
COPY lib ./lib

ENV PORT=8080

EXPOSE 8080

CMD ["node", "server.js"]
