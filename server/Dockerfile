# The game server: the online match and the impostor, in one process.
#
# Built from the server/ folder alone — it carries its own copy of the game
# rules in server/rules/ (the app imports them from there), so nothing outside
# this folder is needed. It runs TypeScript directly with `tsx`.
#
#   cd server && docker compose up -d --build
FROM node:22-alpine

WORKDIR /app

# Dependencies first, on their own layer, so changing a line of game code does
# not reinstall them.
COPY package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund

COPY . ./server/

# Don't run as root for a process whose whole job is talking to the internet.
USER node

ENV NODE_ENV=production
ENV IMPOSTOR_PORT=8787
EXPOSE 8787

# HTTP routes and the `/game` WebSocket share this one port.
CMD ["node_modules/.bin/tsx", "server/index.js"]
