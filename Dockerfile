FROM node:current-alpine3.22

WORKDIR /app

COPY package.json .

RUN npm install

COPY . .

RUN npm install express

CMD ["node", "server.js"]
