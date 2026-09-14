# The game server: the online match and the impostor, in one process.
#
# It runs TypeScript directly with `tsx`, because the match uses the same rules
# files as the app (`src/game/`) rather than a second copy of them. So the image
# carries three things: the server, those game files, and the three packages
# the server needs — listed in server/package.json so this does not install
# the whole Expo app to get them.
FROM node:22-alpine

WORKDIR /app

# Dependencies first, on their own layer, so changing a line of game code does
# not reinstall them.
COPY server/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund

COPY server/ ./server/
# Only the game rules. The screens, hooks and assets are the app's business.
COPY src/game/ ./src/game/

# Don't run as root for a process whose whole job is talking to the internet.
USER node

ENV NODE_ENV=production
ENV IMPOSTOR_PORT=8787
EXPOSE 8787

# HTTP routes and the `/game` WebSocket share this one port.
CMD ["node_modules/.bin/tsx", "server/index.js"]
