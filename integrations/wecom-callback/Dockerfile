FROM node:22-alpine
WORKDIR /service
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY *.mjs ./
USER node
EXPOSE 3106
CMD ["node", "server.mjs"]
