FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY dist ./dist
COPY server.js README.md ./

ENV NODE_ENV=production
ENV HOST=0.0.0.0

EXPOSE 3000

CMD ["npm", "start"]
