FROM node:20-alpine

WORKDIR /app

# deps d'abord (cache)
COPY package.json ./
RUN npm install --omit=dev

# code
COPY server.js ./
COPY lib ./lib
COPY public ./public
# Les scripts de maintenance (reprise, sauvegarde) doivent voyager avec l image :
# les monter a la main au moment ou on en a besoin, c est les oublier.
COPY scripts ./scripts

ENV NODE_ENV=production
ENV PORT=3200
ENV TZ=Europe/Paris
ENV DATA_DIR=/app/data
RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 3200

CMD ["node", "server.js"]
