# Express app and UI.
#
# Configuration comes from the environment, never from the image. The 2024 version of
# this file baked a TLS key in, which is why it was gitignored; this one has nothing
# in it worth keeping secret.

FROM node:20-alpine

WORKDIR /app

# Dependencies are installed before the source is copied so that editing a source file
# does not invalidate the cached npm layer.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 4000

CMD ["node", "frontserver.js"]
