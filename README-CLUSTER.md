# Arquitectura de clúster — Trivia Multijugador

Este documento explica los cambios hechos para reemplazar el `servidor-base`
(dummy) de `Codigo/` por el **proyecto de trivia completo** como backend real
del clúster, sin modificar su lógica de negocio.

## Qué se agregó (todo aditivo, nada del proyecto original se eliminó)

| Archivo | Propósito |
|---|---|
| `Dockerfile` | Imagen de la app de trivia (antes solo existía para `servidor-base`) |
| `.dockerignore` | Evita copiar `node_modules`, `.env`, `Codigo/`, etc. al build |
| `nginx/nginx.conf` | Balanceador con `ip_hash` + soporte WebSocket para Socket.IO |
| `docker-compose.yml` | Orquesta Postgres, RabbitMQ, 5 nodos de la app, Nginx y los consumidores |
| `server.js` | +`/health` y header `X-Node-Name` (para identificar qué nodo respondió) |

La carpeta `Codigo/` (laboratorio original con `servidor-base`) se dejó
intacta como referencia; el clúster real ahora vive en la raíz del proyecto.

## Cómo se resolvió el estado en memoria

`sockets/gameSocket.js` guardaba las salas de juego (`roomStates`) en un
`Map` en memoria de cada proceso, y las sesiones de Express/Passport vivían
en el `MemoryStore` por defecto. Con varios nodos detrás de un balanceador,
eso era un problema si dos clientes de una misma sala caían en nodos
distintos.

La primera solución fue **`ip_hash`** en Nginx: una misma IP de cliente
siempre se enruta al mismo nodo. Funcionaba para pruebas desde una sola
máquina, pero tenía una limitación seria: **todo el tráfico de esa IP
(que en la práctica suele ser una sola, la del que prueba) cae siempre en el
mismo nodo**, así que en los hechos nunca se usaban los otros 4.

### Solución actual: estado compartido en Redis

Se movió todo lo que vivía en memoria de cada proceso a Redis, para que
cualquiera de los 5 nodos pueda atenderlo:

| Antes (memoria local) | Ahora (Redis) |
|---|---|
| `roomStates` (`Map` en `gameSocket.js`) | `sockets/roomStore.js` — JSON por sala en Redis (`room:<codigo>`), con lock distribuido (`SET NX`) para las operaciones que modifican una sala, evitando condiciones de carrera cuando dos jugadores de la misma sala pegan en nodos distintos al mismo tiempo |
| Sesión de Express/Passport (`MemoryStore`) | `connect-redis` (`sesion:*` en Redis) |
| Broadcast de Socket.IO (`io.to(sala).emit(...)`) | `@socket.io/redis-adapter`, para que un evento emitido desde el nodo 1 llegue a sockets conectados al nodo 3 |

Lo único que sigue siendo local a cada proceso es el `setInterval` del
cronómetro de cada pregunta (no es serializable). Vive en el nodo del admin,
y cada segundo revisa en Redis si la pregunta ya fue revelada desde otro
nodo (por ejemplo, porque el último jugador conectado a otro nodo contestó
justo antes de que se acabara el tiempo) para saber si debe detenerse.

Con el estado ya compartido, `nginx.conf` pasó de `ip_hash` a `least_conn`
(reparte según conexiones activas por nodo), y los clientes Socket.IO se
conectan forzando `transports: ['websocket']` para que cada conexión sea un
único *upgrade* HTTP —sin eso, el *long-polling* de Socket.IO sí necesitaría
volver a afinidad por sesión, porque el *handshake* de Engine.IO vive en
memoria del proceso que lo aceptó.

**Qué levanta el clúster ahora:** `redis` se sumó a `docker-compose.yml`
como un servicio más (puerto `6379`), del que dependen los 5 nodos y los
consumidores (vía `REDIS_URL`).

## Cómo levantar el clúster

```bash
cp .env.example .env
# editar .env con tus secretos reales (JWT_SECRET, SESSION_SECRET,
# credenciales de Google OAuth si las usas)

docker compose up --build
```

Esto levanta: `postgres`, `rabbitmq`, `nodo1`..`nodo5` (la app de trivia),
`balanceador` (Nginx en el puerto **8081**) y los 7 consumidores de RabbitMQ
que ya existían en `package.json` (`analitica`, `alertas`, `partidas-1/2`,
`sala-abandonada`, `dlq-*`).

La app queda disponible en **http://localhost:8081**.

> Nota sobre OAuth: si usas login con Google, actualiza el "Authorized
> redirect URI" en Google Cloud Console a
> `http://localhost:8081/auth/google/callback` (antes apuntaba al puerto 3000).

## Cómo verificar el balanceo de carga

Cada respuesta HTTP incluye el header `X-Node-Name`, y existe `/health`:

```powershell
1..18 | ForEach-Object { (Invoke-WebRequest http://localhost:8081/health).Headers['X-Node-Name'] }
```

```bash
for i in $(seq 1 18); do curl -sI http://localhost:8081/health | grep X-Node-Name; done
```

Con `ip_hash`, todas las peticiones desde tu misma máquina caerán
consistentemente en **un solo nodo** (eso es lo esperado: es la garantía que
da `ip_hash`, no round-robin). Para ver la distribución entre los 5 nodos,
prueba desde varias IPs distintas (otros equipos en la red, o el contenedor
Alpine de prueba que ya usaba el laboratorio original apuntando a
`trivia-balanceador`).

## Cómo verificar que el balanceador funciona

### 1. Estado y salud de los contenedores
```bash
docker compose ps
```
Los 5 nodos deben aparecer `healthy` y `balanceador` debe estar `Up` (depende de que los 5 estén `healthy` primero, así que si tarda en aparecer es normal).

### 2. Validar que Nginx cargó la configuración sin errores
```bash
docker compose exec balanceador nginx -t
```

### 3. Ver en vivo qué nodo atiende cada petición
El `nginx.conf` ahora loguea `IP del cliente -> nodo:IP:puerto del backend` en cada request:
```bash
docker compose logs -f balanceador
```
Genera tráfico en otra terminal y observa el log:
```bash
curl http://localhost:8081/health
```
Vas a ver algo como `172.25.0.5 -> nodo:172.25.0.11:3000 ... status:200`. Repite la petición varias veces: **con `ip_hash`, siempre debe ser el mismo nodo** (eso es correcto, no un bug).

### 4. Confirmar el nodo también desde la respuesta HTTP
Cada respuesta trae el header `X-Node-Name`:
```bash
curl -sI http://localhost:8081/health | grep X-Node-Name
```

### 5. Simular clientes con IPs distintas (para ver la distribución real entre los 5 nodos)
Como todo el tráfico desde tu propia máquina comparte una sola IP, para *ver* el reparto entre nodos necesitas varios "clientes" con IPs distintas. La forma más simple es lanzar varios contenedores efímeros en la misma red (cada uno obtiene una IP interna distinta):
```bash
for i in $(seq 1 8); do
  docker run --rm --network proyectofinal_red-cluster alpine sh -c \
    "wget -qO- http://balanceador/health"
  echo
done
```
(el nombre de la red puede variar; confírmalo con `docker network ls | grep red-cluster`). Si repites esto varias veces deberías ver, entre los 8 contenedores, respuestas de nodos distintos — cada contenedor individual siempre volverá a caer en el mismo nodo si lo vuelves a llamar (esa es la garantía de `ip_hash`).

### 6. Probar tolerancia a fallos de un nodo
```bash
docker compose stop nodo3
curl http://localhost:8081/health   # nginx debe seguir respondiendo (redirige a otro nodo)
docker compose start nodo3
```
Nota: si algún cliente estaba "anclado" (por `ip_hash`) al nodo caído, al redistribuirse pierde el estado de su sala en memoria — es la limitación ya documentada arriba, no un error de configuración.

## Estado de los contenedores

```bash
docker compose ps
docker compose logs balanceador
docker compose logs nodo1
```
