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
nada y queda exactamente como hoy.

⚠️ Esto asume que las dos LANs no comparten subred. Si las dos fueran
`192.168.1.x` el rango no alcanza para distinguirlas y hay que listar IPs
sueltas — que también se admite. Verificar la topología real antes de
configurar.

### 3. Heartbeat por agente

`print_agent_status` pasa a PK `(business_id, agent_id)`. `getPrintAgentHealth`
hoy hace `.maybeSingle()` (`src/lib/admin/local-query.ts`) y con dos filas
rompería: pasa a devolver la lista, y Configuración → Local muestra un renglón
por agente con su label. Un agente caído se ve, aunque el otro esté vivo.

## Qué NO cambia

- **El contrato del agente instalado.** Mismo GET, mismo POST, mismos campos. El
  alcance y el label se configuran del lado del server.
- **La resolución de impresoras.** `resolveCuentaPrinter` y
  `resolveFiscalPrinter` no se tocan: el filtro corre después, sobre el
  resultado.
- **La semántica de `failed`.** Con el alcance bien partido un agente sólo
  reporta lo suyo, así que `failed` vuelve a significar «esta impresora no
  respondió» — que es lo que la spec 33 quiso decir.

## Riesgo

La key sigue siendo un secreto compartido dentro del negocio hasta que se rote;
esto no lo empeora, pero ahora son dos copias en dos máquinas. Rotar una key
tiene que poder hacerse sin voltear al otro agente — sale gratis con las filas
separadas.

## Verificación

1. `pnpm typecheck` + `pnpm test` en verde.
2. Migración aplicada al cloud, y **el agente de golf sigue imprimiendo sin que
   nadie toque esa PC** — es la condición de éxito de todo esto.
3. Con dos keys y alcances disjuntos: cada agente recibe sólo sus trabajos, y
   ninguno reporta `failed` sobre papel del otro.
4. Con una sola key y `printer_scope` null: idéntico a hoy.
5. Bajar un agente y ver que Configuración → Local lo marca sin conexión
   mientras el otro sigue en verde.
