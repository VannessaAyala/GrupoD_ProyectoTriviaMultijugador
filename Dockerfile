FROM node:24-alpine

WORKDIR /app

# Dependencias de compilación necesarias para módulos nativos (bcrypt) en Alpine.
# Se instalan, se usan para el build y se eliminan en la misma capa.
RUN apk add --no-cache --virtual .build-deps python3 make g++

COPY package*.json ./
RUN npm install --omit=dev

RUN apk del .build-deps

COPY . .

# Puerto interno de la aplicación (Socket.IO + Express).
# Se sobreescribe en tiempo de ejecución con la variable PORT si aplica.
EXPOSE 3000

CMD ["npm", "start"]
