# 124 · Varios print-agents por negocio, cada uno con su alcance

**Issue:** [#191](https://github.com/gachetponzellini/RestaurantOS-app/issues/191) ·
**Milestone:** Post-demo · Growth & hardening

## Por qué

Golf necesita una segunda PC con print-agent para la segunda caja, y las dos
máquinas están en **LANs distintas** — ninguna llega a las impresoras de la otra.

Hoy el contrato del agente no contempla dos agentes en un mismo negocio. La key
es una por negocio (`print_agent_credentials.business_id` es PK, migración 0014)
y el `GET /api/print-agent` sirve **todo** lo pendiente del negocio: el
`?station_id=` filtra sólo las comandas, mientras que control, cuenta y factura
se arman siempre por `business_id`. Los dos agentes verían lo mismo.

El papel no se duplicaría —cada agente sólo puede abrir socket contra IPs de su
propia LAN— pero el estado sí se rompe:

- **Falsos «no salió la comanda».** El agente que no alcanza la IP reporta
  `failed`, y eso setea `print_failed_at` **y llama `notifyPrintFailed`**
  (`route.ts`, handler de confirmación). Sería una alerta a cocina por cada
  ticket del otro local, todo el servicio.
- **Carrera que pisa un ticket bueno.** El `failed` no mira si el ticket ya está
  impreso: si A imprime bien y después llega el `failed` de B, la comanda que
  salió perfecta queda marcada como fallida igual.
- **Heartbeat pisado.** `print_agent_status` se upsertea con `business_id` como
  PK (migración 0002). Los dos agentes escriben la misma fila, así que si una PC
  se muere Operación sigue mostrando «conectada».

## Qué se construye

### 1. La key identifica al agente

`print_agent_credentials` pasa de una fila por negocio a **N filas**: `id`
propio, `business_id` como FK común, `label` para distinguirlas en el panel
(«Caja principal», «Caja bar»).

Esto es lo que evita tocar la PC que ya está instalada: el agente de golf sigue
mandando exactamente lo mismo que hoy (su Bearer + `business_id`) y el server,
al validar la key, ya sabe **qué agente es**. Cero cambios en el ejecutable, cero
reinstalación. La PC nueva baja su instalador con su propia key por el
autoinstalador que ya existe (spec 046).

`verifyAgentKey` deja de resolver «la key del negocio» y pasa a resolver «qué
fila de credenciales coincide con este Bearer, dentro de este negocio». La
comparación sigue siendo en tiempo constante y una key sigue sin autenticar
nunca contra otro `business_id`.

### 2. El alcance se declara por IP alcanzable

Cada fila de credenciales lleva un `printer_scope`: la lista de IPs o rangos que
ese agente puede alcanzar (`["192.168.1.0/24"]`). El `GET` filtra el array de
respuesta por el `printer_ip` que cada trabajo ya trae resuelto.

Un solo filtro, al final, cubre las cuatro familias de papel a la vez. La
alternativa era declarar el alcance por sector + salón + caja + control (cuatro
resoluciones distintas: `stations.printer_ip`, `resolveCuentaPrinter` por salón
con fallback al negocio, `resolveFiscalPrinter` por caja sin fallback, y
`businesses.control_printer_ip`), y mantenerlas sincronizadas con la
configuración de impresoras a mano. Filtrar por IP dice lo mismo con un dato que
ya está en el payload, y es literalmente la pregunta física: *¿este agente llega
a esta impresora?*

**Default `null` = todo**, así que un negocio con un solo agente no configura
nada y queda exactamente como hoy. Un `[]` se lee igual que `null`: sólo puede
llegar por una config a medio hacer, y leerlo como «no alcanza ninguna» apagaría
el local en silencio.

Dos destinos se le sirven **a todos** los agentes en vez de filtrarse: el que no
tiene impresora resoluble (hoy también se sirve, y el agente lo saltea) y el que
no es una IPv4. Este último importa: `isValidPrinterHost` acepta hostnames
(`comandera-cocina.local`) y desde el server no hay forma de saber en qué subred
vive un nombre — sólo el agente, que lo resuelve en su LAN. Descartarlo dejaría
esa comandera huérfana sin una sola traza.

⚠️ Esto asume que las dos LANs no comparten subred. Si las dos fueran
`192.168.1.x` el rango no alcanza para distinguirlas y hay que listar IPs
sueltas — que también se admite. Verificar la topología real antes de
configurar.

### 3. Heartbeat por agente

`print_agent_status` pasa a PK `(business_id, agent_id)`. `getPrintAgentHealth`
hacía `.maybeSingle()` (`src/lib/admin/local-query.ts`) y con dos filas rompería;
ahora devuelve **el latido más viejo**, no el más nuevo. La pill de Operación
contesta «¿está saliendo el papel?», y si una de las dos PCs está muerta la mitad
de los tickets no se imprimen: eso es rojo. Quedarse con el más nuevo sería el
mismo bug de origen, corrido a la otra punta. El detalle por agente vive en
Configuración → Local, un renglón por PC con su label y su alcance.

### 4. El aviso de las impresoras que no alcanza nadie

Configuración → Local cruza el alcance de todos los agentes contra las impresoras
configuradas (sectores, control, cuenta por salón, factura por caja) y marca las
que **ningún** agente alcanza. Es la contracara del modo de fallar más caro que
introduce esta spec: un typo en un CIDR no produce un error ni un `failed` —
produce silencio, porque el agente que no alcanza esa impresora directamente no
recibe el trabajo.

## Qué NO cambia

- **El contrato del agente instalado.** Mismo GET, mismo POST, mismos campos. El
  alcance y el label se configuran del lado del server.
- **La resolución de impresoras.** `resolveCuentaPrinter` y
  `resolveFiscalPrinter` no se tocan: el filtro corre después, sobre el
  resultado.
- **La semántica de `failed`.** Con el alcance bien partido un agente sólo
  reporta lo suyo, así que `failed` vuelve a significar «esta impresora no
  respondió» — que es lo que la spec 33 quiso decir.

## Puesta en producción — el orden importa

Golf está imprimiendo en vivo y hace GET + heartbeat **cada segundo**, así que la
migración va partida en tres para que no haya ni una ventana rota:

| Migración | Cuándo | Qué hace |
|---|---|---|
| **0046** | ya | Aditiva: columnas (`id`, `label`, `printer_scope`, `agent_id`), PK de credenciales a `id`, único de `api_key`. El código viejo sigue andando. |
| **0047** | ya, pegada a la 0046 | Los dos índices que sostienen la ventana: repone el **único** de `business_id` (sin él, el `upsert onConflict:"business_id"` del código viejo rompe con 42P10 y **rotar la key deja de andar**) y crea el único de `(business_id, agent_id)` que el heartbeat nuevo necesita apenas se deploye. |
| **0048** | después del deploy | Cierra el modelo: afloja el único de `business_id`, `label` obligatorio y único por negocio, PK del heartbeat a `(business_id, agent_id)` + FK con cascade. |

**Las tres están aplicadas** (2026-08-19). El deploy de Vercel salió automático con
el push a `master`; la 0048 se aplicó recién después de confirmar que el agente de
golf seguía latiendo contra el código nuevo. Siguió latiendo también después de
ella, sin que nadie tocara esa PC.

La segunda key no se podía crear hasta la 0048: mientras el código viejo estuvo
vivo, un segundo agente habría roto su `.maybeSingle()` y golf se quedaba sin
autenticar. Ya se puede.

## Riesgo

La key sigue siendo un secreto compartido dentro del negocio hasta que se rote;
esto no lo empeora, pero ahora son dos copias en dos máquinas. Rotar una key se
hace sin voltear al otro agente: el `upsert onConflict: business_id` que le
pisaba la fila al vecino pasó a ser un `update … where id = <agente>`.

## Verificación

1. `pnpm typecheck` + `pnpm test` en verde.
2. Migraciones aplicadas al cloud, y **el agente de golf sigue imprimiendo sin
   que nadie toque esa PC** — es la condición de éxito de todo esto.
   Verificable: `git status print-agent/` limpio al terminar.
3. Con dos keys y alcances disjuntos: cada agente recibe sólo sus trabajos, y
   ninguno reporta `failed` sobre papel del otro.
4. Con una sola key y `printer_scope` null: idéntico a hoy.
5. Bajar un agente y ver que Configuración → Local lo marca sin conexión
   mientras el otro sigue en verde.
