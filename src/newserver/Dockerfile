# Edge capture and database services.
#
# bashservice.sh is deliberately not the entry point: it reads a USB serial device that
# only exists on the host the Arduino is plugged into. In a container this image runs
# the seed and database services, which need nothing but a MongoDB connection.

FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

CMD ["node", "dbservice.js"]
