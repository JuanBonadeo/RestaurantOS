# 154 · Ver el ticket en pantalla, sin gastar papel

**Issue:** [#231](https://github.com/gachetponzellini/RestaurantOS-app/issues/231) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** 📋 propuesta (2026-09-03) — sin implementar

**Input:** Juan, 2026-09-03, cerrando una jornada de nueve specs: *"habría que
hacer algo con la impresión de las comandas para que en la demo se pueda probar
igualmente"*.

**Depende de**: [`051`](../051-print-agent-render-server/spec.md) (el render vive
en el server y ya produce `content_plain` — esta spec no lo inventa, lo muestra),
[`035`](../035-reimpresion-y-fallos-de-impresion/spec.md) (el tab Comandas y su
botón Reimprimir, donde entra el nuevo).

---

## Por qué

**Las comanderas están en Golf.** En `demo` no hay agente ni impresora, así que
todo lo que toca papel se verifica a ciegas — y el 2026-09-03 se tocó mucho: la
spec 145 le agregó el nombre del menú a la comanda, la 139-B estrenó el papel del
cierre, y el fix de los tickets del cliente cambió qué se imprime y con qué
interlineado. Los tres sobre el mismo `ticket.ts`.

De los **cuatro** papeles que produce el sistema —comanda de cocina, cuenta de
mesa, control de delivery, cierre de caja— **sólo la comanda tiene tests de
paridad byte-a-byte** contra fixtures congelados. Los otros tres salieron sin que
nadie viera cómo quedan.

Y el costo de esa ceguera ya se pagó el mismo día: el primer intento de achicar
el control de pedido bajó la lista de ítems de `tall` a `sm` y anunció «−26 % de
papel». Era falso —el avance lo fija `ESC 3`, que se emite una vez por documento—
y **una preview lo habría mostrado en dos segundos**: mismo largo, letra más
chica.

### Lo que ya está y nadie usa

Desde la spec 051 el server pre-renderiza el ticket entero. `GET /api/print-agent`
devuelve, por cada trabajo:

    content_escpos_b64   los bytes que la térmica imprime
    content_plain        el MISMO ticket, en texto

`content_plain` existe hace meses y **sólo aparece en tests**. No hay una sola
pantalla que lo muestre. La feature no es renderizar: es enseñar lo que ya se
renderiza.

### Lo que habilita el diseño barato

El `GET` es **de sólo lectura**. Verificado: no hay un `update`, `insert` ni
`upsert` en todo el handler — el heartbeat y el acuse son el `POST`, separados.
Llamarlo para mirar no toca el estado de las comandas ni le roba trabajo al
agente real.

## Las decisiones

**D1 · La preview sale del MISMO camino que el papel, o no sirve.** Una preview
que arma su propio payload es una segunda implementación que va a divergir, y el
día que diverja va a mentir justo cuando más se la necesita. Se consume el
`content_plain` que produce el endpoint del agente, no una copia.

**D2 · Fase 1: la action llama al endpoint; el refactor queda para después.** El
armado del payload vive inline en `route.ts`, un archivo de 1322 líneas. Extraerlo
a un módulo compartido es lo correcto a largo plazo y es lo que haría la fase 2 —
pero hoy ese archivo lo están tocando varias specs a la vez, y un refactor grande
ahí es pedir un conflicto. La fase 1 es una server action que hace un `fetch`
interno al propio `GET` con la credencial del negocio (que ya vive en
`print_agent_credentials`, server-side) y devuelve el `content_plain`. Feo por
dentro, fiel por construcción, y reversible.

**D3 · Se dibuja el papel, no el texto.** Monoespaciada, ancho fijo de 24
columnas (`COLS.sm`), fondo claro y borde de ticket. Los renglones `tall`/`xl` se
muestran más grandes, porque **la mitad de los bugs de esta jornada fueron de
tamaño y de interlineado** — un `<pre>` plano los hace invisibles. El
`content_plain` no trae el tamaño por línea, así que la action devuelve también
las `Line[]` (que ya son datos estructurados) y la UI las dibuja.

**D4 · Entra por el tab Comandas, al lado de «Reimprimir».** Es donde el
encargado ya va cuando algo con el papel salió mal, y donde la spec 035 puso
Reimprimir y el estado del agente. No es una pantalla nueva.

**D5 · Sirve en producción, no sólo en el demo.** El pedido nace de no poder
probar en `demo`, pero el mismo botón en Golf contesta *«¿por qué salió así?»* sin
caminar hasta la comandera ni gastar un ticket — y deja ver el papel de una
comanda vieja, que la impresora ya no tiene.

**D6 · Los cuatro papeles, no sólo la comanda.** El pedido dice «comandas», pero
los tres que no tienen paridad byte-a-byte son justamente los otros: cuenta,
control y cierre. Cubrirlos es donde está el valor; la comanda es la que menos lo
necesita.

**D7 · No se simula la impresora.** Nada de emular ESC/POS a imagen, ni un agente
virtual que «imprima» a un archivo. Eso es un proyecto y lo que hace falta es
mirar el papel antes de gastarlo.

## Alcance

- **`src/lib/print/preview-actions.ts` (nuevo)** — server action
  `previewTicket(kind, id, slug)`, gateada por el mismo permiso que Reimprimir.
  Resuelve la credencial del negocio y trae el trabajo del `GET`.
- **`src/components/admin/local/ticket-preview-modal.tsx` (nuevo)** — el papel
  dibujado (D3), con botón para copiar el texto.
- **`comandas-kanban.tsx` / el tab Comandas** — el botón «Ver ticket» (D4).
- **Sin migración.** Todo el dato existe.

## Qué NO entra

- **El refactor del armado del payload** (D2) — fase 2, cuando `route.ts` se
  calme.
- **Emular la impresora** (D7).
- **Imprimir desde la preview.** Reimprimir ya existe y es otro gesto, con otro
  permiso.
- **Previsualizar antes de enviar la comanda.** Interesante, pero el ticket sólo
  existe cuando la comanda existe; adelantarlo es armar un payload falso, que es
  exactamente lo que D1 prohíbe.

## Escenarios de aceptación

1. **Dado** el tab Comandas con una comanda emitida, **cuando** se toca «Ver
   ticket», **entonces** aparece el papel como va a salir, al ancho real.
2. **Dado** un ticket con renglones de doble alto, **entonces** se ven más
   grandes que los normales — el tamaño y el interlineado son visibles.
3. **Dado** un menú del día en la comanda, **entonces** la preview muestra
   «MENU EJECUTIVO» arriba del plato, igual que el papel (spec 145).
4. **Dado** un negocio **sin** agente configurado (el caso de `demo`),
   **entonces** la preview funciona igual: no depende de que haya una impresora.
5. **Dado** el papel del cierre, **entonces** se ve en su ancho condensado (42
   col), distinto del de la comanda.
6. **Dado** que alguien mira una preview, **entonces** el agente real no pierde
   ese trabajo ni cambia de estado (el `GET` es de sólo lectura).

## Verificación

Pendiente — sin implementar.

Al implementar, la prueba de fuego es el escenario 4: `demo` no tiene agente, y es
el negocio donde esto tiene que servir. Después, comparar la preview de una
comanda de Golf contra el papel real que sale de su comandera — si difieren, D1 se
rompió en algún lado.

    node scripts/magic-link.mjs sofia@demo.test "/demo/admin/operacion?tab=comandas"
