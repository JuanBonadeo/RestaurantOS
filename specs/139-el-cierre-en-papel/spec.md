# 139 · El cierre en papel, y la rendición que no se saltea

**Issue:** [#210](https://github.com/gachetponzellini/RestaurantOS-app/issues/210) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** **parte A implementada y verificada en vivo** (2026-09-01, migración
`0056` aplicada al cloud). La parte B —el papel— espera la foto del ticket que
el local usa hoy.

**Input:** Juan, 2026-09-01: *"hay que hacer la spec para la impresión del ticket
al cierre del turno, y la rendición debería de ser obligatoria y manual. Primero
me gustaría pedirles una foto de cómo son los tickets, así copiamos el formato;
mientras tanto armá lo más detallado posible"*.

**Depende de**: [`130`](../130-cerrar-caja/spec.md) (cerrar caja: la RPC, el
modal, el reparto por dueño), [`07`](../../../../wiki/specs/07-caja-rendicion-mozos/spec.md)
(la rendición y `caja_user_assignments`), [`084`](../084-factura-impresa-comandera-fiscal/spec.md)
(comandera por caja, sin fallback al negocio), [`080`](../080-cuenta-impresa-para-el-cliente/spec.md)
(la familia `print_jobs`), [`124`](../124-print-agents-por-alcance/spec.md)
(varios agentes, alcance por IP), [`33`/`35`](../../../../wiki/specs/33-impresion-instantanea-y-aviso-fallo/)
(fallo de impresión y reimpresión), [`34`](../../../../wiki/specs/34-mail-cierre-de-turno/spec.md)
(el resumen por email, que es **otra cosa** — ver D7).

---

## Por qué

Hoy el cierre del día termina en una pantalla que se apaga. La 130 lo dejó en un
solo botón —rendís, contás, retirás— pero cuando el modal se cierra no queda
**nada en la mano**: ni el papel que el encargado mete en el sobre con la plata,
ni el que el mozo firma cuando entrega, ni el que el dueño encuentra a la mañana
al lado de la caja. El sistema tiene toda la información y la deja adentro.

Es exactamente el hueco que el wiki viene arrastrando como deuda desde la
primera versión de caja: *«Imprimir resumen del corte (Fase 2)»*
([`features/caja.md` · Decisiones abiertas](../../../../wiki/features/caja.md)).
Y no es un capricho de papel: el sobre con la recaudación viaja, la plata la
cuenta otra persona a la mañana, y la constancia de *quién cerró, con qué
diferencia y qué mozo no entregó* hoy sólo existe en una tabla que nadie del
local sabe abrir.

Del otro lado está la rendición, que hoy **es opcional dos veces**:

1. **No bloquea el cierre.** Fue una decisión explícita de la 130 (D6: *«un mozo
   sin rendir no bloquea, se puede haber ido»*). En la práctica eso significa
   que la manera más rápida de cerrar la caja a la 1 de la mañana es no rendir a
   nadie: el reparto por dueño explica la diferencia, el arqueo cuadra, y la
   plata de Nacho queda flotando en una columna que al día siguiente ya no
   aparece en ninguna pantalla del cierre.
2. **Se registra sola.** El input de «efectivo que entrega» arranca vacío y, si
   se deja vacío, se rinde **el monto esperado exacto**
   ([`cerrar-caja-modal.tsx:518`](../../src/components/admin/local/cerrar-caja-modal.tsx)):
   `entregado === "" ? efectivoCents`. Apretar «Registrar rendición» sin tocar
   nada da siempre diferencia $0. Una conciliación que se autocompleta no
   concilia: es un sello.

### Lo que dice la base hoy (cloud, 2026-09-01)

Antes de escribir una línea, los números que condicionan las decisiones:

| | `golf-jcr` | `kcc` | `demo` |
|---|---|---|---|
| Cortes de caja registrados | 3 | 0 | 2 |
| Rendiciones de mozo (`mozo_rendiciones`) | **0** | **0** | **0** |
| Asignaciones caja↔usuario | **0** | **0** | **0** |
| Comandera fiscal por caja | — | `192.168.10.210` | — |
| Comandera de control (negocio) | `192.168.100.210` | `192.168.10.210` | — |

Tres cosas que salen de ahí y que la spec asume:

- **La rendición nunca se usó.** Cero filas en los tres negocios. Esto no es
  «endurecer una función existente»: es estrenarla, y por eso la Parte A tiene
  que entrar con la salida de emergencia de la D1 desde el día 1.
- **`caja_user_assignments` está vacía en todos lados.** La D3 se apoya en una
  tabla que hoy nadie llenó — sin cargarla, el encargado se rinde a sí mismo
  todas las noches. Cargar las asignaciones es parte del rollout, no un extra.
- **Ninguna caja de golf tiene comandera fiscal.** La única térmica configurada
  del local es la `control_printer_ip` del negocio (`.210`, contra `.211–.214`
  que son cocina, parrilla, fritera y postres). Es la del mostrador, y es la que
  recibe el papel (D12).

MaxiRest —que es contra lo que compite esto— rendía por empleado **× forma de
cobro** (`mxren`) al cerrar el turno, con estado *pendiente / rendida /
validada* (`mxrenest`), e imprimía. También fallaba todos los días
([`logs-pain-points.md` · patrón 3](../../../../raw/maxirest/logs-pain-points.md)):
*«se produjeron errores al procesar rendiciones — error de sintaxis»*, con el
turno cerrando igual y las rendiciones quedando mal generadas. O sea: el
concepto es el que el local ya conoce; lo que hay que hacer mejor es que **no se
pueda cerrar el turno con la rendición rota o salteada**.

---

## Las decisiones

### Parte A · La rendición

**D1 · Obligatorio es *decidir*, no cobrar.** Ningún mozo con cobros en el
período llega al cierre sin resolver: o **rindió**, o quedó declarado **«no
entregó»** con motivo. Lo segundo no es una puerta trasera — es el registro
explícito de una deuda, con nombre, monto y responsable, que después sale
impresa en el papel del cierre y en el mail del dueño.

Es la única forma de que «obligatoria» no termine trabando el local: si el mozo
se fue, el sistema no puede exigir plata que no está, pero sí puede exigir que
alguien **firme que no está**. Es el `mxrenest` de MaxiRest (0 pendiente / 1
rendida) traído a mano.

`mozo_rendiciones` gana `estado text not null default 'rendida'` con check
`('rendida','no_entrego')`.

**D2 · Manual: el monto entregado se tipea, siempre.** Se va el
`entregado === "" ? efectivoCents`. El campo arranca vacío, el placeholder es
`0` (hoy es el monto esperado, que es una invitación a copiar), y el botón
«Registrar rendición» queda deshabilitado hasta que haya un número.

El esperado **sigue a la vista** —el encargado necesita cantarle al mozo cuánto
le tiene que dar— así que esto no es conteo ciego; es sólo que el número que
queda escrito sea el que se contó y no el que el sistema calculó.

**D3 · El operador de la caja no rinde.** Hoy `getRendicionesPendientesTodosLosMozos`
barre `role in ('mozo','encargado')`
([`queries.ts:533`](../../src/lib/caja/queries.ts)) y el reparto de la 130 le
**resta al cajón** todo lo que esos usuarios cobraron en efectivo. Para un mozo
con billetera personal está bien. Para el que está parado en la caja está mal:
esa plata ya está adentro del cajón, y el modal muestra menos efectivo del que
hay. Se vio en la verificación de la 130 —Sofía, encargada, con $113.800 «sin
rendir»— y con la rendición obligatoria dejaría de ser un renglón raro para
pasar a ser un bloqueo diario.

Criterio: **rinde el que no está asignado a esa caja** (`caja_user_assignments`,
spec 07). Si la caja no tiene ningún operador asignado, el modal lo avisa —
*«nadie figura como operador de esta caja: todos los que cobraron van a tener que
rendir»*— con link a la pantalla de asignaciones. El aviso es el que hace que se
configure; no hay adivinanza silenciosa.

**D4 · Rinde el que cobró, no el que tiene efectivo.** El reparto por dueño
filtra `efectivo_cents > 0` ([`reparto-efectivo.ts`](../../src/lib/caja/reparto-efectivo.ts)),
y para pintar el cajón está bien. La **obligación** se evalúa sobre
`pagos_count > 0`: el mozo que hizo toda la noche con tarjeta también cierra su
período y entrega sus tickets. Es lo que hacía `mxren` (una fila por empleado ×
forma de cobro) y es lo que evita que su período quede abierto arrastrando
cobros viejos a la rendición de mañana.

**D5 · Bloquea la RPC, no sólo la pantalla.** `cerrar_caja_tx` levanta
`UNRENDERED_MOZOS:<n>` igual que hoy levanta `OPEN_TABLE_ORDERS:<n>`, y la
server action traduce con nombres y montos. La guarda vive en los dos lados por
la misma carrera de la 130: entre que el modal lista y el encargado aprieta, un
mozo puede cobrar la 14. Sólo aplica cuando `p_barrer_salon` (la caja principal):
**el bar cierra en plena cena y no le pide rendiciones a nadie** (D9 de la 130).

**D6 · La diferencia de rendición no consume el techo del encargado.**
`canAcceptCajaDifference` ([`can.ts:112`](../../src/lib/permissions/can.ts),
$5.000) es del **arqueo**: mide si el encargado puede dar por buena una
diferencia de caja. Un faltante de rendición no es eso — es una deuda con
nombre, que no se «acepta», se cobra. Aplicarle el techo trabaría el cierre a la
1 de la mañana esperando que atienda el admin, que es exactamente el escenario
que la D1 evita.

A cambio, deja de ser invisible: `no_entrego` (o diferencia ≥ el mismo umbral de
$5.000) dispara **notificación interna al admin** (spec 27) y sale impreso
arriba en el papel.

### Parte B · El papel

**D7 · El papel es del cierre; el mail es del día.** El resumen por email (spec
34) compone el **día operativo** del local con corte 6 AM y va a los dueños. El
ticket compone **el período de una caja**, entre corte y corte, y sale donde se
está cerrando. Son dos objetos distintos con dos audiencias distintas: no se
comparte la composición ni se intenta que los números coincidan (no van a
coincidir, y está bien — el bar puede haber cerrado tres veces en el día).

**D8 · Se imprime solo, al cerrar.** Sin botón «imprimir»: el papel es parte del
cierre, no una acción aparte que alguien se olvida. La reimpresión existe desde
el historial de cortes y sale marcada `*** REIMPRESION ***`, igual que la cuenta
(080) y la factura (084), con el mismo `reprint_requested_at`.

**D9 · Snapshot congelado en `caja_cortes.resumen jsonb`.** El papel dice
exactamente lo que el encargado vio al cerrar. La alternativa —reconstruir el
período cuando el agente hace el poll— se descarta por dos motivos concretos:
`getCajaLiveStats` calcula **el período abierto** (desde el último corte), que
después de cerrar ya es el nuevo; y una corrección de pago posterior (spec 070)
cambiaría retroactivamente un papel que alguien ya firmó. El snapshot lo escribe
la server action, que **ya calculó** esas stats para validar la diferencia: no
hay cálculo nuevo, sólo se persiste el que había.

**D10 · La fila del papel se inserta dentro de `cerrar_caja_tx`.** Encolar es un
`insert` en `print_jobs` — el agente hace *pull*, no hay I/O externo — así que
entra en la misma transacción que el corte, el retiro y el barrido del salón. Un
cierre sin su papel pendiente sería un cierre sin constancia, y el modo de falla
(el proceso muere entre la RPC y el insert) es justo el peor: la plata retirada
y ningún papel.

**D11 · El agente del local no se toca.** `kind='cierre'` viaja por la
maquinaria que ya existe: el GET arma `content_escpos_b64` + `content_plain`, el
agente imprime lo que le llega, el POST confirma por `comanda_id` y
`handlePrintJobReport` lo resuelve contra `print_jobs`
([`route.ts:759`](../../src/app/api/print-agent/route.ts)). **Ni un `.exe`
recompilado en el local** — que con las PCs de golf, por TeamViewer, no es un
detalle menor.

**D12 · El papel sale por la comandera de control.** Decisión de Juan
(2026-09-01): *"el papel debería de imprimirse en la comandera de control"*.
`businesses.control_printer_ip` — la del mostrador, la misma que escupe el
control que se lleva el repartidor. **Sin columnas nuevas y sin cadena de
fallbacks**: es la única térmica que los dos locales reales tienen configurada
hoy (golf `192.168.100.210`, kcc `192.168.10.210`, contra `.211–.214` que son
cocina, parrilla, fritera y postres), así que el día 1 imprime sin que nadie
configure nada.

Rompe a propósito la regla de la factura (084 · D3: comandera por caja, sin
fallback al negocio), y el motivo es que acá no aplica: el papel del cierre no
sale «donde está parado el que cobra» sino donde está el mostrador, que es
donde se arma el sobre. Si más adelante un local con dos puestos necesita
separarlas, se agrega `cajas.cierre_printer_ip` como override — aditivo, sin
tocar nada de esto.

Si el negocio no tiene `control_printer_ip` (o está apagada), no imprime y el
modal lo dice (D16).

**D13 · El papel del cierre caduca a las 12 h.** La cuenta y la factura esperan
indefinidamente a que alguien configure la impresora, y está bien: son de una
mesa que existe. Un cierre que sale tres días después es basura que alguien va a
confundir con el de anoche. El GET filtra `emitted_at > now() - 12h` para
`kind='cierre'`; el job queda en la tabla (el CHECK de `status` sólo admite
`pendiente|impreso`, no se toca) y la reimpresión manual sigue disponible desde
el historial.

**D14 · Número de cierre correlativo por caja.** `caja_cortes.numero int`,
asignado dentro de la RPC bajo el lock que ya toma sobre `cajas`
(`select … for update`), con backfill por `row_number() over (partition by
caja_id order by created_at)`. Un papel que se firma y se archiva necesita un
identificador que se pueda cantar por teléfono: «el cierre 412 de la principal».
Un UUID no lo es.

**D15 · Un papel por mozo, además del del turno.** `kind='rendicion'`, encolado
al registrar cada rendición: el mozo se lleva su comprobante (esperado,
entregado, diferencia, desglose por método) y el encargado se queda con el del
turno. Es el papel que MaxiRest imprimía por empleado y el que hoy se reemplaza
con un «ya está» verbal. Si la foto muestra que en el local no lo usan, sale de
alcance sin tocar nada más: es un `kind` independiente.

**D16 · El papel nunca frena el cierre.** Si la caja no tiene comandera
configurada, la caja **cierra igual** y el modal lo dice: *«Caja cerrada. El
ticket no salió: falta configurar la comandera de esta caja»*, con link a
Ajustes. El fallo de impresión posterior ya está cubierto por la maquinaria de
la spec 33 (`print_failed_at` + `notifyPrintFailed`).

---

## El papel (draft — esto es lo que la foto va a corregir)

Ancho útil **24 columnas** (58 mm), que es lo que ya usan comanda, cuenta y
factura ([`ticket.ts:34`](../../src/lib/print/ticket.ts): `COLS.sm = 24`,
`RULE` = 24 guiones). Montos como los imprime `money()`: sin símbolo y sin
separador de miles, porque la térmica es ASCII.

```
      GOLF RESTAURANTE
   Av. Del Golf 1234
      341 555-0000
------------------------
     CIERRE DE CAJA
      Caja Principal
        CIERRE #412
------------------------
Desde   31/08 18:04
Hasta   01/09 01:22
Cerro:  Sofia Perez
------------------------
VENTAS
Total          312400.00
23 cobros
Propinas        18700.00
------------------------
POR METODO
Efectivo       198000.00
Tarjeta         84400.00
Transferencia   30000.00
------------------------
POR ORIGEN
Salon          250000.00
Delivery        42400.00
Take away       20000.00
------------------------
RENDICIONES
Nacho Diaz
  esperado      71200.00
  entrego       71200.00
Caro Vega
  esperado      43200.00
  entrego       40000.00
  dif           -3200.00
  Adelanto de sueldo
Juan Perez
  *** NO ENTREGO ***
  adeuda        12500.00
  Se fue temprano
------------------------
ARQUEO
Apertura        20000.00
+ Efectivo     198000.00
+ Ingresos      10000.00
- Sangrias      30000.00
= Esperado     198000.00
Contado        197500.00
DIFERENCIA       -500.00
Vuelto mal dado
------------------------
CONTEO
10000 x 15    150000.00
 2000 x 20     40000.00
  500 x 15      7500.00
------------------------
Retiro         197500.00
Queda en caja       0.00
------------------------
Mesas liberadas: 12
Mozos limpiados:  6
------------------------


Firma: ________________


       Gracias!
```

Y el de la rendición (D15), que es el que firma el mozo:

```
      GOLF RESTAURANTE
------------------------
       RENDICION
      Nacho Diaz
   01/09 01:14 - #412
------------------------
POR METODO
Efectivo        71200.00
Tarjeta         84400.00
------------------------
Propinas         6500.00
(no se rinden)
------------------------
A entregar      71200.00
Entrego         71200.00
DIFERENCIA          0.00
------------------------
Recibio: Sofia Perez


Firma: ________________
```

**Reglas de render que ya están resueltas y no se rediscuten**: `row()` con
label izquierda / valor derecha y salto si no entra, `wrap()` a `COLS`,
`toAscii()` (la térmica sin codepage imprime cualquier byte > 0x7e como basura),
y `sanitizeTicketText()` en el borde del endpoint para los textos de origen
externo — un motivo de diferencia lo tipea una persona, y un `ESC`/`GS` metido
ahí abre el cajón de la caja.

---

## Lo que define la foto (para pedírsela al local)

La mecánica de arriba (D7–D16) no depende de la foto. Lo que la foto define es
el **layout**: qué bloques, en qué orden, con qué rótulos y cuántas copias. Las
preguntas concretas a resolver con la imagen en la mano:

1. **Ancho del papel**: ¿58 mm (24 col, como todo lo nuestro) u 80 mm (48 col)?
   Si es 80, hay que ampliar `COLS` para este kind.
2. **Cuántas copias** salen hoy y **quién se queda con cada una** (sobre de la
   plata / encargado / administración).
3. **Encabezado**: ¿razón social + CUIT + domicilio fiscal, o alcanza con el
   nombre del local? (Ojo: si lleva datos fiscales, aplica el pendiente
   [#134](https://github.com/gachetponzellini/RestaurantOS-app/issues/134) —
   ingresos brutos e inicio de actividades no los tenemos en `businesses`.)
4. **Cómo llaman al papel**: ¿«cierre de turno», «cierre Z», «corte»? El rótulo
   va tal cual, en el idioma del local.
5. **Turno vs caja**: ¿el papel de hoy es por turno (mediodía / noche) o por
   caja? Nosotros no tenemos turnos (decisión vieja: caja continua con cortes),
   así que si el papel dice «turno tarde» hay que decidir el rótulo.
6. **Movimientos**: ¿totales de ingresos/sangrías, o línea por línea con motivo?
7. **Desglose por mozo**: ¿aparece? ¿con ventas totales o sólo con el efectivo a
   rendir? ¿con propinas?
8. **Ranking de ventas**: MaxiRest suele imprimir totales por rubro/categoría en
   el cierre. ¿Lo miran? (Si sí, es un bloque más y sale de
   `ventas_por_origen`/catálogo — hoy **no** está en el snapshot.)
9. **Cubiertos, mesas atendidas, ticket promedio**: ¿están en el papel?
10. **Anulaciones y cortesías**: ¿se listan en el cierre? (El mail ya las tiene
    con responsable, spec 34 · R4.)
11. **Firma**: ¿hay espacio de firma del encargado? ¿del que recibe el sobre?
12. **Numeración**: ¿el papel de hoy trae número de cierre? ¿correlativo por
    caja, por local, o por día?

> Mandarles también **este draft** junto con el pedido de la foto: es más fácil
> que marquen «esto sí, esto no, esto va arriba» sobre algo concreto que
> describir de memoria lo que imprimen.

---

## Alcance

**Incluye — Parte A (no depende de la foto):**
- Migración `0056`: `mozo_rendiciones.estado`. (`caja_cortes.numero` y
  `caja_cortes.resumen` entran con la parte B, que es quien los usa.)
- `cerrar_caja_tx`: guarda `UNRENDERED_MOZOS`, número de cierre, snapshot,
  insert del `print_job` del cierre.
- `registrarRendicionMozo`: `estado`, monto tipeado obligatorio, notificación al
  admin en `no_entrego` / diferencia ≥ $5.000.
- `getRendicionesPendientesTodosLosMozos` / reparto: excluir operadores de la
  caja (D3), obligación por `pagos_count` (D4).
- Modal de cierre: rendición sin precarga, estado «no entregó» con motivo, CTA
  bloqueado con el detalle de quién falta, aviso de «sin operadores asignados».

**Incluye — Parte B (layout sujeto a la foto):**
- `print_jobs`: `kind in ('cierre','rendicion')`, `corte_id` / `rendicion_id`,
  `target_check` extendido, único parcial por `corte_id`.
- Destino: `businesses.control_printer_ip`, sin columnas nuevas (D12).
- `src/lib/print/cierre-ticket.ts` + `rendicion-ticket.ts` (builders puros).
- GET del print-agent: los dos kinds nuevos, con la ventana de 12 h del cierre.
- Reimpresión desde el historial de cortes.
- Tests: builders con fixtures ASCII, resolución de impresora, bloqueo por
  rendición pendiente (integración), unicidad e idempotencia del job, ventana.

**No incluye:**
- Turnos como entidad (seguimos en caja continua con cortes).
- Ranking de ventas por rubro en el papel (queda para cuando la foto lo pida).
- Tocar el mail de cierre (spec 34) ni intentar que sus números coincidan (D7).
- Conteo ciego (el encargado necesita cantarle el monto al mozo).
- Fondo de cambio configurable (sigue afuera desde la 130, D2).
- Firma digital / captura de firma en pantalla: se firma el papel.

---

## Tasks

**A · La rendición obligatoria y manual** — ✅ hecha (2026-09-01).

1. [x] Migración `0056`: `mozo_rendiciones.estado` (`rendida` / `no_entrego`) +
   índice `(business_id, mozo_id, created_at desc)`. Aplicada al cloud por MCP y
   verificada ahí dentro de una transacción que revierte: con 1 pendiente la
   principal tira `UNRENDERED_MOZOS:1`, el bar cierra igual, y tras resolverlo
   cierra. (`caja_cortes.numero` y `resumen` quedaron para la parte B, que es
   quien los usa.)
2. [x] `cerrar_caja_tx`: guarda `UNRENDERED_MOZOS:<n>` bajo `p_barrer_salon`,
   con el período de cada mozo contado desde **su** última rendición.
3. [x] `mozosQueDebenRendir` (`deben-rendir.ts`, pura, 5 tests) +
   `getOperadoresDeCaja`; `getCierreCajaData` devuelve `deben_rendir` y
   `sin_operadores`, y el reparto ya no le resta al cajón lo que cobró el
   operador de la caja.
4. [x] `registrarRendicionMozo(…, estado)`: `no_entrego` fuerza $0 y exige
   motivo; `notifyRendicionPendiente` avisa al admin en `no_entrego` o faltante
   ≥ $5.000, con su vista en el feed (`rendicion.pendiente`).
5. [x] Modal de cierre: la lista sale de `deben_rendir`, sin precarga del monto,
   botón «No entregó» con motivo, CTA bloqueado con el detalle, y el aviso de
   caja sin operadores. La tab Rendición también tiene «No entregó».
6. [x] Tests: 5 unitarios del filtro, 10 del modal (bloqueo, sin autocompletar,
   «no entregó», sólo-tickets, sin operadores) y 4 de integración nuevos.
   ⚠️ Los `*.integration` no corren sin stack local (ruido conocido): la RPC se
   verificó contra el cloud.
7. [x] Verify en vivo en `demo` con el rol **encargado** real (Sofía, magic
   link, nunca service_role): «Falta 1 rendición para poder cerrar», el aviso de
   que nadie es operador de la caja, el botón de registrar **apagado hasta
   tipear** el monto, y la rendición de $113.800 quedando en `mozo_rendiciones`
   con `estado='rendida'`, diferencia $0 y la tab Rendición pasando de 1 a 0.

**B · El papel** — el esqueleto se puede armar; el layout se congela con la foto.

8. [ ] Migración de la parte B: kinds nuevos en `print_jobs`, `corte_id`,
   `rendicion_id`, `target_check`, único parcial; `caja_cortes.numero` (con
   backfill) y `caja_cortes.resumen jsonb`. Sin columnas de impresora (D12).
9. [ ] `cerrar_caja_tx`: número de cierre bajo el lock de `cajas`, `resumen`
   persistido (+ `mesas_liberadas` / `retiro_cents` agregados por la RPC) e
   insert del `print_job` del cierre.
10. [ ] `cierre-ticket.ts` + `rendicion-ticket.ts` con fixtures ASCII,
    incluyendo reimpresión y el caso «no entregó».
11. [ ] GET del print-agent: los dos kinds, destino `control_printer_ip`,
    ventana de 12 h, `sanitizeTicketText` en motivos y nombres.
12. [ ] Insert del job de rendición en `registrarRendicionMozo`.
13. [ ] Reimpresión desde el historial de cortes (`reprint_requested_at`).
14. [ ] `pnpm typecheck` + suite en verde.
15. [ ] Verify en vivo: cerrar una caja y confirmar el `print_job` encolado con
    su `content_plain` (imprimir de verdad requiere el agente del local).
16. [ ] Actualizar `wiki/features/caja.md` + `wiki/log.md`.

---

## Criterios de verificación

- **No se cierra** la caja principal con un mozo que cobró y no rindió: el modal
  dice quién y cuánto, y el CTA está apagado. La RPC lo rechaza igual si el
  cobro entra mientras el modal está abierto.
- **Sí se cierra** después de declarar «no entregó» con motivo — y ese mozo
  aparece en el papel, en el mail y en la notificación al admin.
- El **bar** cierra sin que nadie rinda, como hoy.
- Registrar una rendición **exige tipear** el monto: con el campo vacío el botón
  no se puede apretar, y el placeholder no sugiere el esperado.
- El encargado asignado a la caja **no aparece** en la lista de pendientes, y el
  reparto del modal deja de restarle al cajón su propio efectivo.
- Al cerrar queda **una** fila `print_jobs kind='cierre'` con el `corte_id`; una
  segunda no se puede crear (único parcial), la reimpresión sale marcada.
- El papel imprime **lo que se vio**: si después se corrige un pago del período
  cerrado (spec 070), la reimpresión sigue diciendo lo mismo.
- Sin comandera configurada: la caja cierra igual, el modal lo avisa, y el job
  queda pendiente hasta 12 h.
- El papel del cierre y el mail del día **no** tienen por qué dar el mismo
  número, y ninguna pantalla insinúa que deberían.

---

## Riesgos y preguntas abiertas

- **La foto puede cambiar el ancho.** Si el local imprime en 80 mm, `COLS` se
  vuelve un parámetro del builder en vez de una constante. Barato si se decide
  antes de escribir el render; caro después.
- **`caja_user_assignments` está vacía — verificado, no supuesto.** Cero filas
  en golf-jcr, kcc y demo. Sin cargarla, D3 no filtra a nadie y el encargado se
  rinde a sí mismo todas las noches. El aviso del modal es el mitigante; cargar
  las asignaciones (pantalla que ya existe, admin) es **parte del rollout de
  esta spec**, no un extra.
- **Estrenar la rendición con el cierre bloqueado es el riesgo grande.** Cero
  rendiciones registradas hasta hoy: la primera noche que esto entre, el
  encargado se va a encontrar con un botón apagado y una lista de gente que
  nunca rindió. El texto del bloqueo tiene que decir qué hacer, no sólo qué
  falta — y conviene avisarle a Andrés/Martín antes de deployarlo, no después.
- **La venta de mostrador se persiste como `dine_in`** y por eso cuenta como
  salón (130 · D11). El papel lo va a heredar: si el bloque «por origen» sale
  impreso, el mostrador aparece adentro de «Salón». Sigue sin arreglarse acá.
- **Rendición del encargado que también atiende mesas.** Un encargado asignado a
  la caja que además cobró una mesa con su billetera queda fuera de la
  obligación por D3. Es el caso que la asignación no distingue; se acepta a
  cambio de no bloquear el cierre todas las noches.
- **`no_entrego` no cobra la deuda.** Queda registrada y visible, pero no hay
  todavía una pantalla de «deudas de mozos» ni descuento en la liquidación. Si
  el local lo pide, es spec aparte.
