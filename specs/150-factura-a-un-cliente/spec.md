# 150 · Factura A a una entidad fiscal guardada

**Issue:** [#226](https://github.com/gachetponzellini/RestaurantOS-app/issues/226) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ implementado (2026-09-03) — modelo (`0062`) + dominio + buscador en
los puntos de cobro + alta desde el cobro + ABM en Facturación

**Input:** Juan, 2026-09-03: *"lo de la factura B automática ya lo hicimos, ahora
faltaría lo de dejarle hacer una factura A a un cliente"*.

Cierra el punto 3 del [ingest de la encargada](../../../wiki/sources/2026-09-03-audios-encargada-golf.md)
—*"no tengo la base de datos de clientes del MaxiRest […] así es de la manera que
nosotros podemos hacer las facturas"*— y la deuda que la spec 147 dejó escrita en
su D4: la B se emite sola, la A sigue explícita porque **necesita datos que nadie
tipeó**.

**Depende de**: [`053`](../053-condicion-iva-receptor/spec.md) (los datos del
receptor y su validación), [`147`](../147-cobrar-una-mesa-emite-el-comprobante/spec.md)
(la B automática, que deja a la A como el único caso a mano),
[`067`](../067-plano-nombre-cliente-y-buscador/spec.md) (el buscador de clientes
que se reusa).

---

## Por qué

### Las dos mitades ya existen, y no se tocan

**Emitir una Factura A funciona.** `ComprobanteFields` (spec 053) pide tipo, CUIT,
razón social y condición de IVA, valida los 11 dígitos con
`comprobanteEsValido` y lo montan los cuatro puntos de cobro.

**Buscar un cliente también funciona.** `CustomerSearchField` es un campo con
sugerencias que ya se usa al abrir mesa, en el walk-in, al cargar un pedido y al
reservar.

Lo que no existe es el puente. Tres agujeros concretos:

| Dónde | Qué falta |
|---|---|
| `customers` | columnas: `id, business_id, phone, name, email, created_at, user_id`. **Sin CUIT, razón social ni condición de IVA** — no hay dónde guardar el dato fiscal |
| `invoices` | guarda `cuit_receptor` y `razon_social_receptor` **sueltos**, sin `customer_id`: ninguna factura queda vinculada a un cliente |
| `ComprobanteFields` | no tiene buscador — se tipea todo desde cero, siempre |

### Qué significa eso en la práctica

Para facturarle al sanatorio a fin de mes hay que tipear un **CUIT de 11 dígitos
a mano**, más la razón social, más la condición de IVA. Todos los meses, el mismo
cliente. En un comprobante fiscal, donde el CUIT equivocado no se corrige con un
undo sino con una nota de crédito.

Y es un caso real y repetido: en MaxiRest llevaban **~4.000 facturas A** entre sus
dos puntos de venta, sobre una cartera de **410 clientes con CUIT** (`mxcli`, backup
23/12/2025). Los dos usos que la encargada describió —el evento empresarial y la
facturación mensual a los médicos— son los dos a CUIT.

## Las decisiones

**D1 · Los datos fiscales viven en su propia tabla, no colgados de `customers`.**
La primera versión de esta spec los agregaba como columnas del cliente. Los datos
reales del backup dicen que no:

- **Son poblaciones casi disjuntas.** De los 410 clientes con CUIT de Golf, sólo
  **7** coinciden con los 298 `customers` ya importados. El 98 % de quienes reciben
  factura no comen en el salón.
- **`customers.phone` es la identidad de esa tabla, y ellos no la tienen.** Es NOT
  NULL + UNIQUE, y `upsertCustomerByPhone` lo dice con todas las letras: *«sin
  teléfono no hay cliente: el nombre solo no identifica a nadie»*. De los 410 con
  CUIT, **20 tienen teléfono**. Meterlos ahí obligaba a inventarle un placeholder a
  390 filas — romper a mano la invariante que el código defiende a propósito.
- **Ensuciaba cuatro pantallas.** El buscador de clientes se usa al abrir mesa, en
  el walk-in, al cargar un pedido y al reservar: sumarle 410 razones sociales
  empeora los cuatro flujos para servir a uno.

Un comensal y un receptor de factura son cosas distintas, y la clave natural lo
confirma: **al comensal lo identifica el teléfono, al receptor el CUIT.** Cuando
son la misma persona —los 7 casos— se enlazan con `fiscal_entities.customer_id`.

**D2 · El buscador aparece sólo cuando el tipo es A.** En B no hay a quién
buscar: el receptor es consumidor final y el campo sería ruido en el camino más
transitado. `ComprobanteFields` ya conoce el tipo elegido, así que el buscador es
condicional dentro del componente que los cuatro flujos comparten — una sola
implementación, cuatro pantallas.

**D3 · Elegir la entidad completa los campos, pero no los congela.** Los tres
inputs siguen editables después de elegir: puede haber que corregir una razón
social sobre la marcha, y bloquearlos obligaría a salir del cobro para arreglar
una letra. Lo que se emite es lo que está en el formulario.

**D4 · Un CUIT nuevo crea la entidad; uno que ya existe no se pisa.** Si se tipea
un CUIT que no está, al emitir se crea la `fiscal_entity` con lo que se cargó y la
próxima factura ya la encuentra. Si el CUIT **ya existe** y lo tipeado difiere, la
factura sale con lo tipeado pero **la entidad queda como estaba**: un dato fiscal
que cambia es más probable que sea un error de tipeo del apuro que un dato nuevo, y
pisarlo en silencio arrastra el error a todas las facturas siguientes. Corregir una
entidad ya cargada se hace en su pantalla, con la cabeza fría.

**D5 · La factura queda vinculada: `invoices.fiscal_entity_id`.** Sin eso no se puede
responder «qué le facturamos a este cliente», que es justo lo que la encargada
necesita para la liquidación mensual del sanatorio. Es nullable: las facturas B a
consumidor final no tienen receptor identificado, y las 14 que ya existen tampoco.

**D6 · La A sigue siendo explícita.** La spec 147 automatizó la B; la A no se
automatiza y la razón no cambia: el sistema no puede adivinar **a quién** se le
factura. Elegir a quién se le emite es la decisión, y la toma una persona.

**D7 · El import desde MaxiRest entra, y es fast-follow inmediato.** Esta
decisión decía lo contrario —«son un puñado de clientes, que los cargue a mano»—
hasta que se abrió el backup. La tabla **`mxcli` existe y tiene los datos
completos**: `cuit`, `razon`, `tipo_iva`, `dni`, domicilio y contacto. En el
backup de Golf (23/12/2025) hay **2.786 clientes, 410 con CUIT** (378 distintos:
hay 30 duplicados a resolver), y el `tipo_iva` mapea la condición casi perfecto —
399 son tipo `2` y 396 de esos tienen CUIT. En KCC son 782 y 62.

El import deduplica por **`(business_id, cuit)`**, que es el unique de la tabla
nueva — y hace falta, porque el backup trae **30 CUIT repetidos** en esas 410 filas.
Esto es justamente lo que el modelo de la 0061 no podía hacer: ahí la clave hubiera
sido el teléfono, que 390 de los 410 no tienen.

Cargar 410 clientes fiscales a mano no es una opción, así que el importador deja
de ser opcional. **Sigue sin entrar en esta spec** —el modelo y el flujo tienen
que existir antes de tener dónde importar— pero es lo que sigue, no un «si hace
falta». Detalle del relevamiento en
[`wiki/negocio/maxirest-clientes-mxcli.md`](../../../wiki/negocio/maxirest-clientes-mxcli.md).

## Alcance

- ~~**Migración**~~ ✅ **hecha** — `0062_entidades_fiscales.sql`, aplicada al cloud
  el 2026-09-03 y verificada. Crea **`fiscal_entities`** (ver D1) con
  `unique (business_id, cuit)` como clave natural, CHECK de CUIT normalizado a 11
  dígitos y de `condicion_iva in (1,4,5,6)`, domicilio y contacto opcionales,
  `customer_id` nullable para enlazar al comensal cuando son la misma persona, y
  `external_ref` para que un re-import sepa qué ya trajo. `invoices` suma
  `fiscal_entity_id` **on delete set null**. RLS propia, calcada de `customers`
  menos el `user_id = auth.uid()`: sólo `authenticated` y miembros del negocio.
  La `0061`, que colgaba los campos de `customers`, **se revierte entera** en la
  misma migración (se aplicó el mismo día, con 0 filas escritas y sin código que
  la leyera).

- **`src/lib/afip/fiscal-entities.ts` (nuevo)** — el módulo de dominio:
  `buscarEntidadesFiscales(slug, query)` (por razón social y por CUIT, tolerando
  que se tipee con guiones), `crearEntidadFiscal`, `actualizarEntidadFiscal` y el
  `resolverEntidadParaFactura` del D4 (busca por `(business_id, cuit)`, crea si no
  está, devuelve la existente si está). Validación Zod y gate de permisos en el
  borde, como todo el resto.
- **`src/components/billing/comprobante-fields.tsx`** — el buscador condicional
  (D2) y el `fiscalEntityId` elegido dentro de `ComprobanteState`, para que
  `comprobanteToInvoiceInput` lo pase. Es el componente que comparten los cuatro
  puntos de cobro: una implementación, cuatro pantallas.
- **`src/lib/afip/emit-invoice.ts`** — persiste `fiscal_entity_id` en la factura
  (D5) y dispara el `resolverEntidadParaFactura` del D4.
- **Alta desde el cobro** — si el CUIT no está cargado, la entidad se crea sin
  abandonar la pantalla. Sin esto, la primera factura a un receptor nuevo sigue
  siendo la de hoy.
- **Pantalla de entidades fiscales** — el ABM vive en la sección **Facturación**,
  que es donde se factura y a la que el encargado ya entra con `full` (#139); no en
  la ficha del cliente, que es otra cosa. Lista + búsqueda + editar, y las facturas
  de cada entidad (que el `fiscal_entity_id` recién ahora hace posible).
- **Permisos** — `canGestionarEntidadesFiscales` en `can.ts`. El encargado factura,
  así que entra; el mozo no. Se decide al implementar si editar una entidad ya
  cargada pide un techo más alto que crearla.

## Qué NO entra

- **Importador desde MaxiRest** (D7). Queda afuera de esta spec porque necesita
  el modelo de datos primero, pero es el fast-follow inmediato: son 410 clientes
  con CUIT en Golf y 62 en KCC, y salen de `mxcli`, no de un Excel a mano.
  → escrito como [spec 152](../152-importar-los-receptores-de-maxirest/spec.md)
  ([#228](https://github.com/gachetponzellini/RestaurantOS-app/issues/228)),
  2026-09-03.
- **Emitir A automáticamente** (D6).
- **Pisar datos fiscales ya cargados desde el cobro** (D4).
- **Validar el CUIT contra el padrón de ARCA.** El gateway ya rechaza un CUIT
  inexistente al emitir; consultar el padrón antes es otra integración y otra
  decisión.
- **Domicilio fiscal del receptor.** No lo pide el flujo actual ni lo exige la
  emisión que hoy funciona; se agrega el día que ARCA lo requiera para algún
  tipo de comprobante que golf-house emita.

## Escenarios de aceptación

1. **Dado** el cobro con Factura A elegida, **entonces** aparece el buscador de
   entidades fiscales; con Factura B **no** aparece.
2. **Dado** una entidad guardada, **cuando** se la elige, **entonces** CUIT, razón
   social y condición de IVA quedan completos y la factura se emite sin tipear
   nada.
3. **Dado** esa entidad elegida, **cuando** se corrige la razón social a mano,
   **entonces** la factura sale con lo corregido (D3) y **la entidad no cambia**
   (D4).
4. **Dado** un CUIT que no está cargado, **cuando** se emite, **entonces** la
   entidad se crea y la próxima factura a ese CUIT ya la encuentra.
5. **Dado** un CUIT tipeado **con guiones**, **entonces** matchea contra la
   entidad guardada igual — el CHECK de la tabla exige 11 dígitos, así que la
   normalización tiene que pasar antes de la query, no después.
6. **Dado** un comprobante emitido, **cuando** se abre la entidad en Facturación,
   **entonces** la factura aparece en su lista.
7. **Dado** un cobro con Factura B, **entonces** todo funciona exactamente como
   hoy — incluida la emisión automática de la spec 147.
8. **Dado** un receptor **sin teléfono ni cliente asociado** (el caso normal: 390
   de los 410 de Golf), **entonces** se crea, se busca y se factura igual. Ésta es
   la que el modelo viejo no podía cumplir.
9. **Dado** un comensal que además factura (los 7 casos), **cuando** se enlaza su
   `customer_id`, **entonces** la entidad sigue funcionando igual y borrar el
   cliente **no** la borra (`on delete set null`).

## Qué se construyó

| Archivo | Qué hace |
|---|---|
| `src/lib/afip/cuit.ts` | `normalizarCuit` / `esCuitValido` / `formatCuit`. Puro y sin `server-only` a propósito: la misma normalización corre en el buscador y antes de cada query. |
| `src/lib/afip/fiscal-entities.ts` | Dominio `server-only`: `buscarEntidadPorCuit`, `buscarEntidades`, `resolverEntidadParaFactura` (D4), `listFiscalEntities`, `getFiscalEntity`. |
| `src/lib/afip/fiscal-entities-actions.ts` | La puerta autenticada: `buscarEntidadesFiscales`, `crearEntidadFiscal`, `actualizarEntidadFiscal`. Zod + `canGestionarEntidadesFiscales`. |
| `src/components/billing/fiscal-entity-search-field.tsx` | El buscador + el alta desde el cobro. |
| `src/components/billing/comprobante-fields.tsx` | `fiscalEntityId` en `ComprobanteState`; el buscador condicional (D2). |
| `src/components/billing/facturacion-section.tsx` | Lo mismo en el cobro de mesa (mozo y encargado). |
| `src/lib/afip/emit-core.ts` | Persiste `fiscal_entity_id` (D5) y dispara el alta diferida (D4). |
| `facturacion/entidades/` + `entidades/[id]/` | El ABM: lista, búsqueda, editar, y las facturas de cada entidad. |

**Dos decisiones tomadas al implementar:**

- **El dominio va en dos archivos, no en uno.** La spec pedía un solo
  `fiscal-entities.ts` con firmas por `slug`, pero `emitInvoiceCore` lo importa y
  ese archivo es `server-only`: si el dominio fuera `"use server"`, cada export
  sería un endpoint público que crea entidades fiscales. Mismo razonamiento que la
  spec 147 · D2. El dominio se importa; los actions se exponen.
- **El `fiscalEntityId` del cliente es una pista, no la verdad.** Llega del
  navegador, así que el servidor lo acepta sólo si la entidad es del negocio **y**
  su CUIT es el que se emite; si no cierra, manda la clave natural
  `(business_id, cuit)`. Sin eso se podía colgar una factura a la entidad ajena
  que se quisiera.
- **Sin razón social no se crea la entidad.** El CHECK de la tabla la rebotaría
  igual (`length(trim(razon_social)) > 0`), y una fila sin nombre no se puede
  reconocer en la lista. La emisión no se bloquea: el CUIT y la razón social
  viajan en la propia factura, que es el dato fiscal que vale.

## Verificación

**Tests** — `pnpm typecheck` limpio y **2153 tests en verde** (205 archivos). Los
`*.integration.test.ts` quedan fuera: sin stack local fallan con `fetch failed`,
ruido conocido.

- `fiscal-entities.test.ts` (11): D4 —CUIT existente con datos distintos **no se
  pisa**—, CUIT nuevo → crea, CUIT con guiones → matchea, CUIT incompleto y sin
  razón social → no crea nada, y la carrera contra el unique.
- `comprobante-fields.test.tsx` (5) y `facturacion-section.test.tsx`: el buscador
  no aparece en B y sí en A, elegir completa los tres campos, `fiscalEntityId`
  viaja a `emitInvoice`, y corregir el CUIT a mano suelta el vínculo.
- `can.test.ts`: encargado y admin sí, mozo/terminal/personal no.

**En vivo** — `demo`, gateway en sandbox, con **Sofía (encargada)** por magic
link. No le faltó permiso en ninguna pantalla nueva.

| # | Escenario | |
|---|---|---|
| 1 | El buscador aparece sólo con Factura A | ✅ |
| 2 | Elegir la entidad completa CUIT + razón social + condición | ✅ |
| 5 | CUIT tipeado `30-50023730` matchea la guardada como `30500237305` | ✅ |
| 8 | Receptor **sin teléfono ni cliente**: se crea, se busca y se factura | ✅ |
| 7 | Factura B: todo igual que hoy, `fiscal_entity_id` NULL | ✅ |
| — | D4 en vivo: mismo CUIT + razón social distinta → avisa y **no pisa** (`updated_at` intacto) | ✅ |
| — | ABM: lista, búsqueda, editar (razón social + domicilio), facturas de la entidad | ✅ |
| 4 / 6 | `fiscal_entity_id` en una A emitida y esa factura en la lista de la entidad | ⚠️ ver abajo |

### Hallazgo: la auto-emisión de la 147 tapa la Factura A explícita

Con `afip_auto_emit = true`, **la Factura A elegida en el cobro nunca se emite**.
El orden es `registrarPago` → (dentro) `autoEmitInvoiceForOrder` emite la B → y
recién después el sheet llama a `facturar()`, que choca con el guard de la spec
100 («esta orden ya tiene la Factura B … autorizada»). Lo mismo en el cobro de
mesa: `FacturacionSection` sólo se monta con la orden cerrada, que es justo
cuando la B automática ya salió.

No es de esta spec —cambiar *cuándo* dispara la auto-emisión es territorio de la
147, y «emitir A automáticamente» está explícitamente fuera de alcance— y **no
afecta a golf-house**: `golf-jcr` tiene el flag en `false`. Es `demo` el que lo
tiene prendido. Merece spec propia: hoy, en un negocio con auto-emisión, pedir
una A obliga a anular la B con su nota de crédito.

Por eso los escenarios 4 y 6 quedaron sin verificar de punta a punta en el
navegador: hacerlo pedía apagar `afip_auto_emit` en `demo`, y el cambio de config
quedó bloqueado. El vínculo en sí está cubierto por los tests del dominio y por
el escenario 7 (la B automática guardó `fiscal_entity_id` NULL, como debe).

---

**Nota de nomenclatura:** el directorio se llama `150-factura-a-un-cliente` porque
nació con el modelo viejo (los campos colgados de `customers`). Se conserva para no
romper los links del issue y de los commits; el modelo real es `fiscal_entities`.
