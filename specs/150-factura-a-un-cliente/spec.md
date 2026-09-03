# 150 · Factura A a un cliente guardado

**Issue:** [#226](https://github.com/gachetponzellini/RestaurantOS-app/issues/226) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** 🟡 parcial (2026-09-03) — **el modelo está aplicado** (migración `0061`,
al cloud, verificada); el flujo de UI sigue pendiente

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

**D1 · Los datos fiscales viven en el cliente.** `customers` suma `cuit`,
`razon_social` y `condicion_iva`, los tres **nullable**: el 97 % de los clientes
son consumidores finales que nunca van a tener CUIT, y obligarlos rompería el
alta desde la carta, el chatbot y el walk-in. Un cliente con CUIT es un cliente
normal que además se puede facturar.

**D2 · El buscador aparece sólo cuando el tipo es A.** En B no hay a quién
buscar: el receptor es consumidor final y el campo sería ruido en el camino más
transitado. `ComprobanteFields` ya conoce el tipo elegido, así que el buscador es
condicional dentro del componente que los cuatro flujos comparten — una sola
implementación, cuatro pantallas.

**D3 · Elegir el cliente completa los campos, pero no los congela.** Los tres
inputs siguen editables después de elegir: puede haber que corregir una razón
social sobre la marcha, y bloquearlos obligaría a salir del cobro para arreglar
una letra. Lo que se emite es lo que está en el formulario.

**D4 · Se guarda en el cliente sólo lo que estaba vacío.** Si el cliente elegido
no tenía CUIT y se tipea uno, queda guardado y la próxima factura ya lo trae. Si
**tenía** uno distinto, **no se pisa**: un CUIT que cambia es más probable que sea
un error de tipeo del apuro que un dato nuevo, y pisarlo en silencio arrastra el
error a todas las facturas siguientes. Corregir un dato fiscal ya cargado se hace
en la ficha del cliente, con la pantalla quieta.

**D5 · La factura queda vinculada: `invoices.customer_id`.** Sin eso no se puede
responder «qué le facturamos a este cliente», que es justo lo que la encargada
necesita para la liquidación mensual del sanatorio. Es nullable: las facturas B a
consumidor final no tienen cliente, y las 14 que ya existen tampoco.

**D6 · La A sigue siendo explícita.** La spec 147 automatizó la B; la A no se
automatiza y la razón no cambia: el sistema no puede adivinar **a quién** se le
factura. Elegir el cliente es la decisión, y la toma una persona.

**D7 · El import desde MaxiRest entra, y es fast-follow inmediato.** Esta
decisión decía lo contrario —«son un puñado de clientes, que los cargue a mano»—
hasta que se abrió el backup. La tabla **`mxcli` existe y tiene los datos
completos**: `cuit`, `razon`, `tipo_iva`, `dni`, domicilio y contacto. En el
backup de Golf (23/12/2025) hay **2.786 clientes, 410 con CUIT** (378 distintos:
hay 30 duplicados a resolver), y el `tipo_iva` mapea la condición casi perfecto —
399 son tipo `2` y 396 de esos tienen CUIT. En KCC son 782 y 62.

**Y hay una trampa esperándolo:** `customers` tiene `UNIQUE (business_id, phone)`,
pero de los 410 clientes con CUIT de Golf **sólo 20 tienen teléfono**. Un import
que use el teléfono como clave choca contra ese unique apenas encuentre el segundo
cliente sin número. La clave de deduplicación del import tiene que ser el **CUIT**,
no el teléfono — y hay que decidir qué `phone` se les pone a los 390 que no lo
tienen, porque la columna es `NOT NULL`.

Cargar 410 clientes fiscales a mano no es una opción, así que el importador deja
de ser opcional. **Sigue sin entrar en esta spec** —el modelo y el flujo tienen
que existir antes de tener dónde importar— pero es lo que sigue, no un «si hace
falta». Detalle del relevamiento en
[`wiki/negocio/maxirest-clientes-mxcli.md`](../../../wiki/negocio/maxirest-clientes-mxcli.md).

## Alcance

- ~~**Migración**~~ ✅ **hecha** — `0061_datos_fiscales_del_cliente.sql`, aplicada
  al cloud el 2026-09-03. `customers` suma `cuit text` (con CHECK de **11 dígitos
  normalizados**, sin guiones: MaxiRest los trae como `30-50023730-5`),
  `razon_social text` y `condicion_iva smallint` (CHECK `in (1,4,5,6)`, los códigos
  ARCA RG 5616 que ya usa `invoices.condicion_iva_receptor` — **no** los internos de
  MaxiRest). `invoices` suma `customer_id uuid references customers(id) **on delete
  set null**`: depurar la lista de clientes no puede borrar un comprobante fiscal.
  Índices parciales en `(business_id, cuit)` y en `customer_id`. Sin cambios de RLS:
  la policy de `customers` ya es `is_business_member() OR is_platform_admin() OR
  user_id = auth.uid()`, sólo `authenticated`, así que el CUIT no queda expuesto.
- **`src/lib/admin/customers-actions.ts`** — `ClienteMatch` suma los datos
  fiscales; `buscarClientes` gana un modo que prioriza/filtra los que tienen
  CUIT, para que en el flujo de facturación no haya que scrollear entre 298
  contactos de delivery. La escritura del D4 va en su propia action, con su gate.
- **`src/components/billing/comprobante-fields.tsx`** — el buscador condicional
  (D2) y el `customerId` elegido dentro de `ComprobanteState`, para que
  `comprobanteToInvoiceInput` lo pase.
- **`src/lib/afip/emit-invoice.ts`** — persiste `customer_id` en la factura (D5) y
  dispara el guardado del D4.
- **Ficha del cliente** (`customer-detail.tsx`) — los datos fiscales se ven y se
  editan ahí, que es el único lugar donde se corrigen (D4), más la lista de sus
  comprobantes, que el `customer_id` recién ahora hace posible.
- **Alta de cliente desde el cobro** — si el que va a pagar con CUIT no está
  cargado, tiene que poder crearse sin abandonar el cobro. Sin esto, la primera
  factura a un cliente nuevo sigue siendo la de hoy.

## Qué NO entra

- **Importador desde MaxiRest** (D7). Queda afuera de esta spec porque necesita
  el modelo de datos primero, pero es el fast-follow inmediato: son 410 clientes
  con CUIT en Golf y 62 en KCC, y salen de `mxcli`, no de un Excel a mano.
- **Emitir A automáticamente** (D6).
- **Pisar datos fiscales ya cargados desde el cobro** (D4).
- **Validar el CUIT contra el padrón de ARCA.** El gateway ya rechaza un CUIT
  inexistente al emitir; consultar el padrón antes es otra integración y otra
  decisión.
- **Domicilio fiscal del receptor.** No lo pide el flujo actual ni lo exige la
  emisión que hoy funciona; se agrega el día que ARCA lo requiera para algún
  tipo de comprobante que golf-house emita.

## Escenarios de aceptación

1. **Dado** el cobro con Factura A elegida, **entonces** aparece un buscador de
   clientes; en Factura B **no** aparece.
2. **Dado** un cliente con CUIT guardado, **cuando** se lo elige, **entonces**
   CUIT, razón social y condición de IVA quedan completos y la factura se emite
   sin tipear nada.
3. **Dado** ese cliente elegido, **cuando** se corrige la razón social a mano,
   **entonces** la factura sale con lo corregido (D3) y **el cliente no cambia**
   (D4).
4. **Dado** un cliente sin datos fiscales, **cuando** se tipea el CUIT y se
   emite, **entonces** queda guardado en el cliente y la próxima factura lo trae.
5. **Dado** que el cliente no existe, **cuando** se lo crea desde el cobro,
   **entonces** la factura sale a su nombre sin salir de la pantalla.
6. **Dado** un comprobante emitido a un cliente, **cuando** se abre su ficha,
   **entonces** aparece en su lista de facturas.
7. **Dado** un cobro con Factura B, **entonces** todo funciona exactamente como
   hoy — incluida la emisión automática de la spec 147.
8. **Dado** un cliente sin CUIT, **cuando** se lo busca desde el flujo de
   facturación, **entonces** no compite con los que sí lo tienen (D2 · alcance).

## Verificación

Pendiente — sin implementar.

Al implementar: tests del guardado condicional del D4 (vacío → guarda; distinto →
no pisa), de que el buscador no aparece en B, y de que `customer_id` viaja a la
factura. El verify en vivo va en `demo` con el gateway en sandbox, donde el CAE
vuelve y se puede ver la A completa:

    node scripts/magic-link.mjs sofia@demo.test "/demo/admin/operacion"

Sofía, encargada: es quien cobra y factura las mesas. La edición de datos
fiscales en la ficha del cliente se verifica también con ella — si le falta
permiso ahí, es un hallazgo de esta spec, no un supuesto.
