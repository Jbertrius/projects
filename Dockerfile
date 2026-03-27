FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY public ./public
COPY data ./data
COPY docs ./docs
COPY lib ./lib

ENV PORT=8080

EXPOSE 8080

CMD ["node", "server.js"]
