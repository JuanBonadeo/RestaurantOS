# 174 · El producto que no existe

**Issue:** [#281](https://github.com/gachetponzellini/RestaurantOS-app/issues/281) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** 🚧 en curso

**Depende de**: [`069`](../069-precio-por-item-con-motivo/spec.md) (el gate de rol y
el patrón «el precio lo fija el encargado, con registro»),
[`068`](../068-cliente-y-buscador-unificados/spec.md) y
[`066`](../066-teclado-operacion/spec.md) (el buscador y la lista
de resultados compartidos por los tres panales de carga),
`09` (el pedido flash, que ya escribe renglones con `product_id = null`).

---

## Por qué

MaxiRest tiene un botón que dice **«No existe»**. La encargada de Golf lo contó
en los audios del 2026-09-03, y lo usa todas las semanas:

> *«Si yo quiero crear un artículo que no existe […] creamos un "no existe", con
> la cantidad (siempre es uno), el nombre de lo que necesitemos […] o cuando le
> facturo al sanatorio o al parque la comida que retiran los médicos […] a fin de
> mes creo un "no existe" y pongo "menú" y el importe.»*

El brain lo cerró como **«ya existe, es el pedido flash»**. Es parecido y no es lo
mismo: el flash (`crearPedidoFlash`) arma una **orden entera de un renglón** para
facturar algo suelto. Lo que falta es el otro uso, el de todos los días: **un
renglón adentro de una cuenta que ya tiene cosas**. La torta que trajo el cliente
y se cobra el cubierto, el pescado del día que nadie cargó, el plato que el chef
improvisó, el ajuste pactado con el socio.

La [spec 069](../069-precio-por-item-con-motivo/spec.md) atacó el mismo dolor por
el otro lado, y su propio texto lo dice: *«Producto fuera de carta. El pescado del
día que no está cargado […]. Hoy el encargado carga "lo más parecido" y el ticket
miente.»* La 069 arregló **el precio**; el nombre sigue mintiendo. El ticket
imprime «Milanesa napolitana» cuando lo que salió de la cocina fue otra cosa, y el
cliente lee eso.

## Qué es

Un **renglón con nombre y precio tipeados en el momento**, sin producto de
catálogo detrás:

- **no va a cocina** — sin sector, sin comanda, sin papel. Es plata, no es un
  plato que alguien tenga que hacer;
- **sí va al ticket del cliente**, a la cuenta, al total y a la factura;
- **no toca el catálogo** — no se da de alta nada, no aparece en la carta online;
- no descuenta stock ni entra a ingeniería de menú: no tiene receta ni costo.

## Decisiones (Juan, 2026-09-09)

| | Resuelto |
|---|---|
| **Quién** | **Encargado / admin**. Gate nuevo `canCargarItemLibre(role)`, hermano de `canOverrideItemPrice` — el que tipea nombre y precio a mano está fijando plata. El mozo lo ve en la cuenta y lo cobra; no lo puede crear. |
| **Dónde** | Los **tres** panales de carga: la mesa (`pedir-client`, que es el sidebar del salón **y** la pantalla del mozo), el pedido sin mesa (`cargar-pedido-sheet`, para llevar/delivery) y la venta rápida de mostrador (`venta-rapida-panel`). Más el pedido que ya existe, que entra por el mismo `enviarComanda` (spec 125). |
| **Cómo se llega** | **Aparece como un producto en el buscador**, no como un botón aparte. Se elige con Enter como cualquier otro renglón y el flujo por teclado no cambia. |
| **Cuándo aparece** | Buscando «no existe» (y sus sinónimos), y —sobre todo— **cuando la búsqueda no encuentra nada**: ahí la lista ofrece cargar lo tipeado como producto que no existe, con el texto ya puesto como nombre. Sin búsqueda no ensucia el catálogo. |
| **Cantidad** | Editable, default **1** (que es lo que ella siempre usa). |
| **Precio** | Entero ≥ 0. Sin tope, igual que el override de la 069: el control es el rol, no un límite duro. |
| **Motivo** | **No** lleva. A diferencia de la 069 —donde el motivo explica por qué un producto conocido se cobró distinto— acá el nombre **es** la explicación: «Torta del cliente», «Menú sanatorio agosto». |

## Modelo de datos: cero migraciones

`order_items.product_id` es **nullable** desde la `0020`, y el pedido flash ya
escribe renglones así. El renglón libre se guarda:

| Columna | Valor |
|---|---|
| `product_id` | `null` |
| `product_name` | lo tipeado |
| `unit_price_cents` / `subtotal_cents` | lo tipeado × cantidad |
| `station_id` | `null` |
| `kitchen_status` | `'delivered'` |
| `loaded_by` | quién lo cargó |

`kitchen_status = 'delivered'` no es una excepción nueva: es la regla que ya
aplican `enviarComanda` y `routeOrderToCocina` desde el issue #189 —*«lo que no va
a cocina no espera a cocina»*—. El trigger `fn_stock_descuento_on_order_item` no
matchea ningún producto y devuelve `new` sin tocar nada. `routeOrderToCocina` ya
contempla `product_id: null` → sector null → sin comanda. El ticket de la cuenta
(`cuenta-ticket.ts`) imprime `product_name` y nunca mira el producto.

## Requisitos funcionales

- **FR-001** — Un renglón libre se define por `kind: "free"` + `name` (1–80) +
  `unit_price_cents` (entero ≥ 0) + `quantity` (1–99). Opcionalmente `notes`.
- **FR-002** — El **checkout público no lo puede expresar**. Vive en los schemas
  de staff (`StaffOrderItemInput`, `VentaMostradorInput`), nunca en
  `OrderItemInput` — misma defensa que la 069 hace con `price_override_cents`:
  si viviera en el schema público, un carrito armado a mano podría inventarse
  una línea con el precio que quiera.
- **FR-003** — `enviarComanda` acepta renglones libres y los inserta con la tabla
  de arriba. **No** generan comanda ni entran en ningún bucket de sector.
- **FR-004** — `persistOrder` acepta renglones libres **sólo** cuando el caller
  lo habilita explícitamente (`options.allowFreeLines`), que es lo que hacen
  `cargarPedidoStaff` y `venderMostrador` después de chequear el rol.
- **FR-005** — Rol distinto de encargado/admin → la action rechaza con
  *«Solo un encargado puede cargar un artículo que no está en la carta.»* El gate
  corre server-side, no sólo escondiendo la UI.
- **FR-006** — El renglón libre respeta la idempotencia de la spec 42:
  viaja con su `client_line_key` y un reenvío no lo duplica.
- **FR-007** — En el buscador de los tres panales aparece una fila «no existe»
  cuando el texto tipeado no devuelve resultados, o cuando lo tipeado matchea
  «no existe» / «artículo libre» / «suelto». Elegirla abre el modal con el texto
  ya cargado como nombre.
- **FR-008** — El renglón libre se anula como cualquier otro ítem
  (`cancelarItem`) y se cobra como cualquier otro renglón.

## Fuera de alcance

- **Editar** un renglón libre ya enviado (nombre / precio). Se anula y se carga
  de nuevo — la misma regla de la spec 125 para lo pagado.
- Que el mozo lo cargue.
- Guardarlo como producto del catálogo («dar de alta esto que acabo de tipear»).
- Adicionales / modificadores sobre un renglón libre.
- Sector: un renglón libre nunca rutea a cocina. Si algún día hace falta un
  «fuera de carta que sí se cocina», es otra spec (y probablemente sea un
  producto de verdad con `show_online = false`).

## Verificación

Con el rol real de **Sofía** (encargada, `sofia@demo.test`) en el negocio `demo`:

1. Mesa abierta con productos → buscar «torta del cliente» → no hay resultados →
   la fila «no existe» → nombre + $3.500 → enviar. La cuenta suma $3.500, **no
   sale ninguna comanda nueva** y el ticket dice «Torta del cliente».
2. Entrar como **Pedro** (mozo) a la misma mesa: la fila no aparece, y una
   llamada directa a `enviarComanda` con la línea libre se rechaza.
3. Venta rápida de mostrador con un renglón libre de $10.000 → cobra y cierra.
4. Cargar pedido para llevar con un renglón libre + un producto real → el
   producto marcha a cocina, el libre no.
