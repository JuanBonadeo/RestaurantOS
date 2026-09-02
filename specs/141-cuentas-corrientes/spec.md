# 141 · Cuentas corrientes (fiado)

**Issue:** [#213](https://github.com/gachetponzellini/RestaurantOS-app/issues/213) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** **propuesta** — approval gate: sin código hasta el OK de Juan.

**Input:** Juan, 2026-09-02: *"vamos a tener que reemplazar la parte que habíamos
hecho el plano de pedidos de mostrador, para hacer el sistema de cuentas
corrientes, que sea lo más simple posible y funcional, capaz habría que sacar los
clientes que hay en el maxirest del bar"*.

**Depende de**: [`067`](../067-plano-nombre-cliente-y-buscador/spec.md) (el plano
que se reemplaza), [`058`](../058-venta-rapida-mostrador/spec.md) (venta de
mostrador), [`070`](../070-caja-correccion-de-lineas-y-libro/spec.md) (corrección
y anulación de pagos), [`07`](../../../../wiki/specs/07-caja-rendicion-mozos/spec.md)
(rendición del mozo).

---

## Por qué

El plano **«Pedidos de Mostrador»** de golf-jcr —60 mesas falsas `M1`…`M60`,
armado el 2026-07-30— es un workaround para representar *"la gente que abre una
cuenta y capaz la paga un día después… pero que no ocupan mesas"*.

**No se usó.** Al 2026-09-02 el plano tiene **una sola orden en toda su vida**:
la `#12` del 2026-08-11, un walk-in **cancelado de $0** sobre `M1`. Sesenta mesas,
una prueba.

Y no podía funcionar, porque **el saldo no existe en ninguna parte**. La mesa
guarda quién está consumiendo *ahora*; en cuanto se cobra, se libera y el vínculo
se pierde. Un sistema de fiado necesita exactamente lo contrario: que la deuda
sobreviva al cierre de la mesa y se pueda leer por cliente, no por mesa.

**MaxiRest sí lo modela**, y de la forma que conviene copiar. En `mxfor`, CTA CTE
es una **forma de cobro** (`tipo='C'`) con **`suma_caj = 0`** — cobra el ticket
pero **no suma a la caja**. En el backup de KCC (2026-07-20) se usó en **105
tickets por $2.334.245,10** entre el 2026-01-09 y el 2026-07-16, **todos con
`recibo = 0`** (o sea: nada saldado, el saldo sólo crece), y son **2 clientes** —
`DEGREGORIO` y `MARTIN`, los dueños. `mxcli` tiene `bloq_cred` y `tope_cred`, y
**ninguno de los 782 clientes tiene tope cargado**: el control real nunca fue el
límite de crédito.

## Lo que ya está construido

- **El padrón de clientes existe.** `customers` (UNIQUE `business_id, phone`),
  con panel propio en `/admin/clientes` — listado con búsqueda, segmentos y ficha
  por cliente (`listCustomers`, `src/lib/admin/customers-query.ts`). golf-jcr
  tiene **298** clientes cargados.
- **El cobro ya está unificado.** `CobroForm` recibe `allowedMethods`
  ([`cobro-form.tsx:72`](../../src/components/billing/cobro-form.tsx)) y no sabe
  qué está cobrando — sirve igual para mesa, pedido sin mesa y mostrador.
- **El pago entra por una sola puerta transaccional**: la RPC
  `registrar_pago_tx` (migración `0007`, ampliada en `0041`), con lock de la
  orden, guarda anti-duplicado e idempotencia por `request_id`.
- **La caja no se rompe sola.** `calculateExpectedCash` suma **únicamente**
  `method === 'cash'` ([`expected-cash.ts:34`](../../src/lib/caja/expected-cash.ts)),
  así que un método nuevo **no infla el arqueo**. Lo mismo la rendición:
  `liquidacion-mozo.ts:37` manda a efectivo sólo el `cash`.
- **La cobranza tiene dónde entrar**: `registrarIngreso`
  ([`caja/actions.ts:447`](../../src/lib/caja/actions.ts)) ya registra plata que
  entra al cajón sin ser una venta.
- **La anulación y la corrección de pagos ya existen** (spec 070,
  `corregir_pago_tx` / `caja_audit_log`).

---

## Decisiones

### D1 · Es una forma de cobro, no una cuenta abierta

El ticket **se cierra en el momento** con método «Cuenta corriente»: la mesa se
libera, la comanda salió, la factura se emite igual y la orden queda `closed` /
`paid`. Lo que queda vivo es el **saldo del cliente**.

La alternativa —dejar la orden `open` hasta que paguen, que es lo que simulaba el
plano— arrastra una orden abierta por días adentro del arqueo diario, del cierre
de caja, de la rendición del mozo y de los reportes. Se descartó: el problema es
de **cobranza**, no de operación de salón.

### D2 · Sólo clientes habilitados, y sin tope

Flag `credit_enabled` en la ficha del cliente. El que no está habilitado **no
aparece** en el buscador del cobro. **Sin límite de monto**: el control es el gate
de rol + el saldo a la vista, no un número. Es lo que MaxiRest modela (`tope_cred`)
y nunca usó.

### D3 · El fiado es venta, pero **no** es plata cobrada

La consecuencia que hay que escribir antes de codear: hoy
`getCajaLiveStats` suma **todos** los métodos en `total_ventas_cents`
([`queries.ts:344`](../../src/lib/caja/queries.ts)), y el panel del arqueo muestra
ese número como **«Cobrado»**. Si el fiado entra ahí, el encargado lee «Cobrado
$180.000» cuando en la caja hay $150.000, y el turno cierra con una diferencia
que nadie puede explicar — el mismo bug de la propina que arregló la spec 098.

Regla: **`cuenta_corriente` se excluye de «Cobrado» y se muestra como una línea
propia, «Fiado del período»**. El arqueo (`expected_cash`) no se toca: ya ignora
todo lo que no sea `cash`.

### D4 · El saldo se **deriva**, no se lleva en un libro paralelo

Sin tabla de asientos. El saldo de un cliente es:

```
saldo = Σ payments(method='cuenta_corriente', credit_customer_id = X, no anulados)
      − Σ customer_credit_settlements(customer_id = X, no anuladas)
```

Por qué así y no con un `customer_account_entries`: el cargo **ya es** una fila de
`payments`, y esa fila hereda gratis la idempotencia de `registrar_pago_tx`, la
corrección de monto de la spec 070 y su `caja_audit_log`. Un libro aparte obliga a
mantener dos filas en sync en cada anulación y en cada corrección — y la única
forma de que un saldo mienta es que tenga dos fuentes.

### D5 · La cobranza del saldo entra a la caja como `ingreso`, sólo si es efectivo

`customer_credit_settlements` guarda su propio `method`. Si es `cash`, la action
crea además un `caja_movimientos` de tipo `ingreso` (reason
`Cobro cuenta corriente · <cliente>`) y lo linkea — así el arqueo espera esa plata.
Si es transferencia o tarjeta, queda sólo en el libro del cliente: es
exactamente el tratamiento que el sistema ya le da a esos métodos en el cajón.

### D6 · El mozo no fía

`cuenta_corriente` se ofrece a **encargado, admin y terminal**. El mozo cobra, no
decide a quién se le fía. Se implementa con el `allowedMethods` que `CobroForm` ya
tiene, más el gate en el server.

---

## Modelo de datos — migración `0059`

Aditiva, sin backfill, sin cambio de significado de ninguna columna existente.

```sql
-- 1 · el método nuevo
alter table payments drop constraint payments_method_check;
alter table payments add constraint payments_method_check
  check (method = any (array['cash','card_manual','mp_link','mp_qr',
                             'transfer','other','cuenta_corriente']));

-- 2 · a quién se le fió (null en todo pago que no sea fiado)
alter table payments add column credit_customer_id uuid references customers(id);
alter table payments add constraint payments_credit_customer_coherente
  check ((method = 'cuenta_corriente') = (credit_customer_id is not null));
create index payments_credit_customer_idx
  on payments (credit_customer_id, created_at desc) where credit_customer_id is not null;

-- 3 · quién puede fiar
alter table customers add column credit_enabled boolean not null default false;

-- 4 · la cobranza del saldo
create table customer_credit_settlements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  method text not null check (method in ('cash','transfer','card_manual','other')),
  caja_id uuid references cajas(id),
  caja_movimiento_id uuid references caja_movimientos(id),
  notes text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references users(id),
  cancelled_reason text
);
```

⚠️ **El check `payments_credit_customer_coherente` es el que hace que el saldo no
pueda mentir**: no existe un fiado sin dueño ni un cobro normal con dueño.

**Lo que rompe el compilador (y está bien que rompa):** `PaymentMethod` gana un
valor, así que TypeScript exige tocar los 5 literales
`Record<PaymentMethod, number>` (`caja/queries.ts:37`,
`caja/liquidacion-mozo.ts:16`, `reports/shift-summary-loader.ts:25` y sus dos
tests), `PAYMENT_METHOD_LABELS` + `METHOD_ORDER`
(`reports/shift-summary.ts:17`) y el array `METHODS` de `cobro-form.tsx:98`.
Ninguno se puede olvidar en silencio.

---

## Los flujos

### US1 · Habilitar a un cliente

Encargado o admin, desde `/admin/clientes/[id]`: switch **«Cuenta corriente»**.
Con el switch en on, la ficha muestra el **saldo** y el **libro** (consumos +
cobranzas, orden cronológico). Si el cliente no existe todavía, se da de alta
desde el mismo cobro (nombre + teléfono, que es la clave única).

### US2 · Fiar una cuenta

En el cobro (mesa, pedido sin mesa o mostrador), método **«Cuenta corriente»** →
buscador de cliente **habilitado**, obligatorio. Sin cliente no hay botón. Se
registra el pago por `registrar_pago_tx` con `credit_customer_id`, la orden se
cierra, la mesa se libera y la factura se emite como siempre.

**Sin propina y sin split parcial en v1**: el fiado cubre el 100 % de lo que
falta. Fiar la mitad y cobrar la otra mitad en efectivo es dividir la cuenta,
que ya existe.

### US3 · Ver quién debe

Panel **«Cuentas corrientes»** en Operación —el que reemplaza al plano—: lista de
clientes con saldo distinto de cero, ordenada por saldo, con el total fiado
arriba y buscador. Un tap abre la ficha del cliente.

### US4 · Cobrar el saldo

Desde la ficha: **«Registrar pago»** → monto (default: el saldo entero) + método
+ caja. Si es efectivo, entra a la caja como `ingreso`. El pago se puede **anular
con motivo**, igual que un movimiento de caja (spec 070); nunca se borra.

---

## Los clientes del MaxiRest del Golf

Decidido con Juan: el padrón sale del **MaxiRest del Golf**, no del de KCC (donde
CTA CTE son los dueños, no socios).

⚠️ **Bloqueante de datos:** el backup del Golf (`~/Downloads/Exp.rar`) **ya no
está en la máquina** — sólo quedó el de KCC. Hace falta que Juan lo vuelva a
pasar. Con eso, el import saca de `mxcli` los clientes que aparecen en
`mxctc` con `cod_for = '/'` (los que efectivamente fiaron), los cruza contra los
**298 `customers` que golf-jcr ya tiene** por teléfono normalizado para no
duplicar, y los da de alta con `credit_enabled = true`.

**El saldo histórico no se migra.** Arranca en cero y se arregla con un cobro o
una nota fuera del sistema: importar deuda de un sistema que nunca registró las
cobranzas (`recibo = 0` en el 100 % de las filas) es importar un número que
nadie puede auditar. Si el cliente quiere el saldo de arranque, se carga a mano
como consumo inicial — decisión de él, no del import.

---

## El plano de mostrador se borra

Las 60 mesas `M1`…`M60` y el plano «Pedidos de Mostrador» se eliminan de
golf-jcr. `orders.table_id` es **`ON DELETE SET NULL`**, y la única orden que
cuelga de ahí es la `#12` — cancelada, $0 —, así que no se pierde nada.
`floor_plans` no tiene `is_active`, y agregar una columna para esconder un plano
que nadie usa sería peor que borrarlo.

Cambio de **datos**, no de esquema: 1 delete de plano (cascade a las 60 mesas).

---

## Lo que NO entra

- Tope de crédito y bloqueo por mora (D2).
- Estado de cuenta por mail o WhatsApp al cliente.
- Fiado parcial / propina sobre fiado (US2).
- Import del saldo histórico.
- Cuenta corriente de **proveedores** — es el otro lado del mostrador y otro
  modelo.
- Que el cliente vea su saldo desde la carta pública.

---

## Tasks

| # | Task |
|---|---|
| T001 | Migración `0059` (método, `credit_customer_id`, `credit_enabled`, tabla de cobranzas) + RLS + `db:types` |
| T002 | `PaymentMethod` + los 5 `Record<>`, labels y orden — typecheck en verde |
| T003 | `saldoDeCliente()` / `libroDeCliente()` puros + tests (el corazón de D4) |
| T004 | `registrarPago` acepta `credit_customer_id`; gate de rol (D6) y validación de `credit_enabled` en el server |
| T005 | `registrar_pago_tx` pasa el nuevo campo |
| T006 | `CobroForm`: método «Cuenta corriente» + buscador de cliente habilitado |
| T007 | D3 — separar el fiado de «Cobrado» en `getCajaLiveStats` y en el panel del arqueo, con test |
| T008 | Ficha del cliente: switch, saldo, libro |
| T009 | `registrarCobranza` + `anularCobranza` (con el `ingreso` linkeado de D5) |
| T010 | Panel «Cuentas corrientes» en Operación |
| T011 | Borrar el plano «Pedidos de Mostrador» de golf-jcr |
| T012 | Import desde el MaxiRest del Golf (**bloqueado**: falta el backup) |
| T013 | Alta de `payment_method_configs` para golf-jcr + wiki (`features/cobros`, `features/caja`, `dominio/schema`) |
| T014 | Verify en vivo con el rol real (encargado) |
