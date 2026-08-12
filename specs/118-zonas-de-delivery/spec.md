# Feature Specification: Zonas de delivery por negocio

**Issue**: [#181](https://github.com/gachetponzellini/RestaurantOS-app/issues/181) · **Milestone**: Post-demo · Growth & hardening

**Feature Branch**: `118-zonas-de-delivery`

**Created**: 2026-08-12

**Status**: 🟢 Listo para implementar — D1-D5 cerradas con Juan (2026-08-12, §Decisiones).

**Input**: Pedido de Juan — *"que se pueda configurar desde qué direcciones pueden pedir deliverys, por negocio, que sea un mapa donde se pueda armar un polígono, y que cuando ingresen la dirección se fije si cae adentro o afuera."*

## Contexto y problema

**El delivery hoy no tiene borde.** Un cliente a 40km escribe su dirección en el checkout, paga, y el pedido entra a cocina como cualquier otro. El local se entera cuando el repartidor mira el ticket — con la comida hecha y, si pagó con MP, con la plata adentro.

La dirección es texto libre y nada más: `delivery_address: z.string().max(200)` ([schema.ts:71](../../src/lib/orders/schema.ts#L71)), sin estructura, sin punto, sin validación. La única "configuración de envío" que existe es plana y global al negocio — `delivery_fee_cents` y `estimated_delivery_minutes` en Ajustes › Negocio ([business-actions.ts:74](../../src/lib/admin/business-actions.ts#L74)): cuánto sale y cuánto tarda, nunca **hasta dónde**.

## Hallazgos del relevamiento

1. **Las columnas de geo ya existen y están muertas.** `businesses.lat/lng`, `customer_addresses.lat/lng` y `orders.delivery_lat/lng` están en el baseline como `numeric(10,7)` (≈1cm de precisión) y **no las lee ni las escribe una sola línea de `src/`**. No hay nada que migrar: hay todo que poblar. El feature encaja en el schema que alguien dejó preparado y nunca usó.

2. **El chatbot queda cubierto solo.** [agent.ts:144](../../src/lib/chatbot/agent.ts#L144) tiene instrucción explícita de **nunca** pedir dirección: arma el carrito y manda el link al checkout web, donde "cargás dirección y forma de pago". Validando en el checkout, WhatsApp hereda la validación sin tocar el agente. (Aparte: `get_delivery_info` ya dice atender *"hasta dónde llevan"* — [tools-metadata.ts:92](../../src/lib/chatbot/tools-metadata.ts#L92) — y hoy no tiene con qué responderlo. Queda como mejora, no como requisito.)

3. **Son tres las superficies que capturan una dirección**, y no quieren la misma dureza:
   - checkout público ([checkout-form.tsx](../../src/components/checkout/checkout-form.tsx)) — el cliente,
   - «Cargar pedido» de operación ([cargar-pedido-sheet.tsx](../../src/components/admin/cargar-pedido-sheet.tsx)) — el encargado tomando un pedido por teléfono,
   - direcciones guardadas ([addresses.ts](../../src/lib/customers/addresses.ts)) — el cliente repetido.

4. **Las direcciones guardadas se deduplican por string exacto.** [persist-order.ts:612](../../src/lib/orders/persist-order.ts#L612) busca `.eq("street", street)` y si no está, inserta. Nunca escribe `lat`/`lng`. Toda la base de direcciones existente va a llegar sin punto.

5. **PostGIS está disponible pero no instalado** (3.3.7 en el proyecto `tjfufswzsxfujcpoxapx`, `installed_version: null`). Instalarlo es una decisión, no un default — ver D2.

## Decisiones

**D1 — El pin manda; no hay geocoder.** El cliente ubica su casa arrastrando un pin sobre el mapa; no traducimos texto → coordenadas. Un geocoder barato se equivoca en la altura y genera **falsos negativos**, que en esta feature significan venta rechazada; y el bueno (Google Places) es una cuenta con billing y una key más que administrar para resolver algo que el cliente resuelve en dos segundos. La dirección escrita sigue existiendo tal cual está hoy — es lo que lee el repartidor — y el punto es lo que se valida. La lectura del punto queda detrás de un módulo propio para que enchufar autocompletado después no toque ni el motor ni el checkout, igual que el adapter de WhatsApp de la [spec 037](../037-proveedor-whatsapp-swappable-gupshup/spec.md).

**D2 — Punto-en-polígono en TypeScript, no en PostGIS.** Son 3-5 polígonos por negocio y la cuenta es ray casting, ~25 líneas. En TS es lógica pura y testeable (TDD, como manda el repo para reglas de negocio) y **corre igual en las dos puntas**: en el cliente da veredicto instantáneo mientras el pin se mueve, en el server es la autoridad. PostGIS obligaría a ir a la base para cada arrastre del pin, mete tipos `geometry` en `pnpm db:types` y suma una extensión al proyecto por una función que cabe en una pantalla.

**D3 — Duro para el cliente, blando para el encargado.** Afuera de zona, el checkout público **no deja confirmar** el pedido de delivery (ofrece retiro). El encargado cargando un pedido por teléfono ve el aviso y **puede seguir igual**: si el dueño decide llevarle a un cliente de siempre que vive tres cuadras afuera, el software no se lo discute. Es el mismo criterio del cupo en reservas modo flexible ([spec 077](../077-reservas-cupo-real/spec.md)) y del principio *el local manda*.

**D4 — Cero zonas = delivery sin límite.** El negocio que no dibujó ninguna zona se comporta **exactamente como hoy**: sin mapa, sin pin obligatorio, sin veredicto. La feature es opt-in por negocio y el deploy no puede cambiarle el checkout a nadie que no la haya configurado.

**D5 — v1 es sólo cobertura.** Adentro/afuera y nada más. La tabla nace con `fee_cents` y `min_order_cents` en `NULL` (= "usá el del negocio") para que cobrar distinto por zona sea después una feature de UI y de `totals-recompute`, no una migración. Eso toca plata y va con su `design.md` propio — ver §Fuera de alcance.

## Modelo de datos

```sql
create table delivery_zones (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses(id) on delete cascade,
  name            text not null,                    -- "Centro", "Zona norte"
  color           text not null default '#2563eb',  -- para distinguirlas en el mapa
  polygon         jsonb not null,                   -- [[lng, lat], ...] sin repetir el cierre
  priority        integer not null default 0,       -- desempate cuando dos zonas se solapan
  fee_cents       bigint,                           -- NULL = businesses.delivery_fee_cents (D5)
  min_order_cents bigint,                           -- NULL = businesses.min_order_cents (D5)
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);
```

Y en `orders`, el registro de qué se decidió al confirmar:

```sql
alter table orders
  add column delivery_zone_id uuid references delivery_zones(id) on delete set null;
```

El orden `[lng, lat]` es el de GeoJSON — contraintuitivo pero es la convención, y evita traducir si alguna vez esto sale o entra como GeoJSON. Se documenta en el tipo.

**RLS.** `SELECT` para `anon` y `authenticated` sin filtro de dueño: el checkout público necesita las zonas para dibujar el mapa y decidir, y un polígono de reparto no es un secreto. `INSERT/UPDATE/DELETE` sólo manager/owner del `business_id`, con el mismo patrón que el catálogo en la migración `0019`. El criterio de "nada sensible en tablas de lectura pública" se cumple por construcción: un polígono, un nombre y un color. La exposición es deliberada.

## Requirements *(mandatory)*

### Fase A — El motor y los datos (nada visible)

- **FR-001**: Migración con la tabla `delivery_zones`, la columna `orders.delivery_zone_id`, sus índices (`business_id` parcial por `is_active`) y las policies de RLS. `pnpm db:types` después — vía MCP, que el CLI local está roto.
- **FR-002**: `pointInPolygon(point, ring)` en `src/lib/delivery/geo.ts` — ray casting, sin dependencias. El anillo se cierra implícitamente (no se exige que el último vértice repita el primero). Vértice exacto y punto sobre la arista cuentan como **adentro**: en el borde conviene el falso positivo, no el falso negativo.
- **FR-003**: `resolveZone(point, zones)` devuelve la zona activa que contiene al punto, o `null`. Con solapamiento gana **mayor `priority`**, y a igual prioridad la más vieja (`created_at`). En v1 el veredicto no depende de cuál gane —estar en alguna alcanza—, pero la función ya devuelve la ganadora porque es lo que va a cobrar en la fase D.
- **FR-004**: `parsePolygon()` valida al escribir: mínimo 3 vértices, máximo 200, `lat ∈ [-90,90]`, `lng ∈ [-180,180]`, y normaliza quitando el vértice de cierre si vino repetido. Los `numeric` de Postgres pueden volver como string por PostgREST: se parsean defensivamente en el borde, nunca se asume `number`.
- **FR-005**: Tests unitarios primero (TDD): adentro, afuera, sobre el vértice, sobre la arista, polígono cóncavo (una "L", donde el bounding box miente), punto en el "hueco" de la L, solapamiento con prioridades, lista vacía → `null`.

### Fase B — El admin dibuja (Ajustes › Envío)

- **FR-006**: El mapa va en la sección **Envío que ya existe** — Ajustes › Negocio, [business-profile-form.tsx:302](../../src/components/admin/settings/business-profile-form.tsx#L302), la `SettingsSection` con ícono `Truck` que hoy tiene Costo de envío, Pedido mínimo y Tiempo estimado. No se crea sección nueva: el lugar donde se dice *cuánto sale llevar* es el mismo donde se dice *hasta dónde*. La descripción de la sección se amplía. Leaflet entra con `next/dynamic` + `ssr: false` para no engordar el bundle del panel, que ya tiene deuda ([spec 108](../108-bundle-del-panel/spec.md)).
- **FR-007**: **Un solo mapa hace las dos cosas, en orden.** Si `businesses.lat/lng` está en `null` —hoy, en todos los negocios— el mapa arranca pidiendo marcar dónde está el local y no deja dibujar hasta que haya punto: sin él no sabe dónde abrir. Marcado eso, las zonas se dibujan encima. **No** va un segundo mapa al lado del campo `address` de la sección Contacto: es la misma dirección en coordenadas, pero dos mapas en una pantalla son dos montajes de Leaflet y un modelo mental partido.
- **FR-007b**: `lat` y `lng` del local son **dos campos más del Zod de `business-profile-form`** ([:40](../../src/components/admin/settings/business-profile-form.tsx#L40)) y se guardan con el botón Guardar que ya existe — las cuatro `SettingsSection` viven dentro de un mismo `<form>`. Las **zonas no**: van por server action propia, por zona, al cerrar el polígono. Meterlas en el form obligaría al submit del perfil a diffear polígonos contra la base.
- **FR-008**: Dibujar una zona: click agrega vértice, arrastrar un vértice lo mueve, y se cierra al tocar el primero (o con un botón «Cerrar zona» — el doble click en mobile no existe). Nombre y color por zona. Editar y borrar zonas existentes. Sin `leaflet-draw`: es una dependencia grande y desactualizada para ~150 líneas propias.
- **FR-009**: Lista de zonas al lado del mapa con activar/desactivar. Desactivar ≠ borrar: una zona apagada no cubre, pero no se pierde el dibujo.
- **FR-010**: Server action de guardado que revalida con `parsePolygon` (FR-004) y chequea permisos con `can.ts`. El cliente nunca es fuente de verdad del polígono.

### Fase C — El cliente valida (checkout)

- **FR-011**: Con el negocio en modo delivery **y con al menos una zona activa**, el checkout muestra el mapa debajo del campo de dirección, centrado en el local, con las zonas pintadas y un pin arrastrable. Sin zonas activas, el checkout es idéntico al de hoy (D4).
- **FR-012**: El veredicto es inmediato al mover el pin (el motor corre en el cliente): adentro, la confirmación sigue habilitada; afuera, se bloquea el submit de delivery con un mensaje que **ofrece retiro** y deja el mapa a la vista. Nunca un callejón sin salida: un falso negativo es una venta perdida.
- **FR-013**: `createOrder` **revalida en el server** — lee las zonas del negocio, corre `resolveZone` y rechaza el delivery fuera de cobertura con error de campo. Sin esto, el bloqueo del cliente es decorativo.
- **FR-014**: Al confirmar se persisten `orders.delivery_lat`, `delivery_lng` y `delivery_zone_id`, y la dirección guardada del cliente estrena `customer_addresses.lat/lng`.
- **FR-015**: Direcciones guardadas — al elegir una que ya tiene punto, se revalida contra las zonas actuales (la zona pudo cambiar desde el pedido anterior) y el pin aparece donde estaba. Las viejas sin punto piden ubicar el pin una vez: **backfill perezoso**, sin migración de datos ni geocoding masivo.
- **FR-016**: «Cargar pedido» de operación muestra el mismo mapa y el mismo veredicto, pero **advierte sin bloquear** (D3), y guarda igual el punto y la zona (`null` si quedó afuera).

## Fuera de alcance

- **Cobro por zona** (`fee_cents`/`min_order_cents` distintos por polígono) — la columna nace, la UI y el cálculo no. Toca plata: `persist-order` y `totals-recompute` tendrían que resolver el fee desde la zona server-side, y eso va con `design.md` propio.
- **Geocoding / autocompletado de direcciones** (D1).
- **Distancia real o ruteo** — un polígono es cobertura, no tiempo de viaje.
- **Polígonos con agujeros o multi-polígono** — varias zonas simples cubren el caso; el hueco de una zona se dibuja con dos.
- **Zona en la comanda del repartidor** y **repartidor asignado** ([#124](https://github.com/gachetponzellini/RestaurantOS-app/issues/124)) — separado.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| La key de tiles va en `NEXT_PUBLIC_` → queda expuesta en el bundle | Restringir por dominio/referrer en el proveedor. **No es opcional**: sin restringir, cualquiera consume la cuota. |
| El proveedor de tiles se cae o agota cuota | El mapa degrada a fondo gris con los polígonos igual dibujados; el veredicto **no depende de los tiles**, sale del motor local. |
| Polígono auto-intersectado dibujado a mano | El ray casting da resultados raros pero no rompe. Se acepta: es un dibujo del admin sobre su propio mapa y lo ve al instante. |
| El cliente pone el pin mal a propósito para entrar en zona | La dirección escrita sigue siendo lo que ve el local antes de despachar. Mismo riesgo que hoy, ni más ni menos. |
| Un negocio dibuja mal la zona y se corta ventas sin darse cuenta | El admin ve el polígono pintado sobre el mapa al guardar; y `delivery_zone_id` en `orders` deja la traza para auditarlo. |

## Verificación

1. `pnpm typecheck` + `pnpm test` en verde.
2. Tests de FR-005 escritos antes que `geo.ts`.
3. En vivo con el **rol real** (encargado/owner, nunca service_role):
   - Ajustes › Negocio › Envío → marcar el local → Guardar → dibujar una zona → recargar y que sigan los dos.
   - Checkout público con una dirección adentro → confirma. Mover el pin afuera → se bloquea y ofrece retiro.
   - Forzar el submit fuera de zona salteando el cliente → el server lo rechaza (FR-013).
   - Confirmar un pedido y verificar `delivery_lat/lng/zone_id` en la fila de `orders`.
   - Un negocio **sin zonas** → checkout idéntico al de hoy (D4).
4. Checklist [qa-brain · web](https://github.com/gachetponzellini/qa-brain/blob/main/tipos/web.md) antes de dar por cerrado.
