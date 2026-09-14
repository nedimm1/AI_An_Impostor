# The impostor proxy, and nothing else.
#
# `server/` has no npm dependencies — index.js pulls in `http`, `os` and `path`
# and that is the lot — so there is no install step, no node_modules and no
# lockfile to keep in sync. The image is the runtime plus five files.
#
# It exists for the same reason the server does: the OpenRouter key must never
# reach the app bundle. Running the proxy in a container keeps the key in one
# place you can point at a machine that is not your laptop.
FROM node:22-alpine

# Node 20.6+ for `process.loadEnvFile`, which index.js calls for local runs.
# In a container the variables are passed in directly instead, and the call is
# wrapped in a try/catch so a missing .env is the normal case here.

WORKDIR /app

# Only the server. The Expo app, the assets and the tests are not its business,
# and leaving them out keeps a rebuild to the files that actually changed.
COPY server/ ./server/

# Don't run as root for a process whose whole job is talking to the internet.
USER node

ENV NODE_ENV=production
ENV IMPOSTOR_PORT=8787
EXPOSE 8787

# `server.listen(PORT)` binds every interface, so this is reachable from
# outside the container without further argument.
CMD ["node", "server/index.js"]
