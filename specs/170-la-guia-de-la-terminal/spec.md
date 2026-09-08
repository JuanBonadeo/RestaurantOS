# 170 · La guía de la terminal, antes que la del mozo

**Issue:** [#258](https://github.com/gachetponzellini/RestaurantOS-app/issues/258) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ implementada y verificada en vivo (2026-09-07)

**Input:** Juan, 2026-09-07, sobre el D9 de la spec 169 (*«el contenido del mozo
es otra spec»*): *"yo armaría una guía para la terminal, antes que la del mozo"*.

**Depende de**: [`140`](../140-los-mozos-en-la-compu-del-salon/spec.md) (el rol
`terminal` y su matriz), [`134`](../134-guia-del-encargado/spec.md) (la forma de
la guía), [`169`](../169-la-guia-no-se-lee-sola/spec.md) (`Tema.roles`, el
recorrido y el progreso).

---

## Por qué la terminal y no el mozo

No es sólo una cuestión de orden: son dos trabajos de tamaño distinto, y el
chico es además el urgente.

**1 · La terminal ya está adentro del panel.** Ve cuatro pestañas de Operación
—`salon`, `reservas`, `comandas`, `fichaje`
([`local-shell.tsx:135`](../../src/components/admin/local/local-shell.tsx))— que
son **las mismas pantallas que la guía del encargado ya documenta**, con sus
frases literales ya extraídas. Escribir la del mozo es documentar `/mozo`: otra
app, cuatro pantallas pensadas para un teléfono, cero reuso.

**2 · En la Etapa 1 de golf-house, la terminal ES el mozo.** La spec 140 se
escribió porque *«los mozos no van a tener su propio móvil, van a manejar todo de
una computadora en común»*. La guía del mozo describiría una superficie que en el
piloto no va a usar nadie todavía.

**3 · Es el rol con más pólvora y menos supervisión.** La terminal anula mesas,
traslada consumos, reparte el salón y fía — y lo hace desde **una cuenta
compartida por todo el salón**. El audit log dice `terminal`, no quién.

## Lo que hay que enseñarle, y que hoy no está escrito en ningún lado

Tres cosas que no son "cómo se usa un botón" y que si nadie las dice, cuestan
plata:

**A · La plata va a la mesa, no a quien tipeó.** Es el D5 de la spec 140:
*«si la mesa tiene `mozo_id`, gana la mesa»*. La consecuencia operativa es que
**repartir el salón al empezar el turno no es una prolijidad: es lo que hace que
la rendición de cada mozo exista**. Una mesa sin mozo asignado, cobrada desde la
terminal, no es de nadie.

**B · La venta rápida de mostrador no la rinde nadie.** No tiene mesa, así que su
plata se atribuye a `loaded_by` —la terminal— y la terminal **no aparece en las
rendiciones pendientes** (esa query lista `role in ('mozo','encargado')`). La
propia spec 140 lo dejó anotado: *«si la terminal cobra en efectivo una venta de
barra, esa plata está en el cajón y nadie la rinde»*. Es correcto —es el mismo
caso que el operador de caja— pero el que está parado ahí tiene que saberlo.

**C · Su tope de descuento es 10 %, no 25 %.** `canApplyDiscount` le da
`DESCUENTO_BAJO_PCT`, el del mozo, no el del encargado
([`can.ts:101`](../../src/lib/permissions/can.ts)). Y **fía pero no cobra una
cuenta corriente**: registrar la cobranza metería un ingreso en una caja que ese
rol no puede ni mirar.

## El problema técnico que aparece con dos guías

El chip `?` de cada pantalla lleva un slug fijo: el de la tab
(`TEMA_POR_TAB`, `salon → "mesas"`). Con contenido por rol, **la misma pantalla
tiene dos temas** y el chip apunta a uno solo. Hoy, además, `/ayuda/[tema]`
renderiza cualquier slug: la 169 sacó los temas del encargado del índice del
salón, pero la URL sigue abierta.

## Las decisiones

**D1 · Seis temas, cortos.** «Esta compu es de todos» · el salón · la cocina ·
reservas · fichar · «lo que desde acá no se puede». El recorrido de la terminal
son esos seis, en ese orden.

**D2 · El primero no es una pantalla: es la cuenta compartida.** Arranca por A y
por C de arriba —la plata es de la mesa, el registro dice «terminal», tu tope es
10 %— porque es lo único que no se puede deducir mirando el panel, y es lo que
decide si la rendición del turno tiene sentido.

**D3 · El último es lo que NO se puede.** Caja, rendición, pedidos de la web,
cobrar una cuenta corriente, descuentos de más del 10 %. Con el nombre de quién
sí puede. Un límite que se descubre chocando en hora pico es una llamada
telefónica; un límite escrito es media línea leída una vez.

**D4 · Las frases se reusan, el criterio no.** Los literales de pantalla ya están
extraídos en los temas del encargado (spec 134 · D4) y se copian tal cual — misma
pantalla, mismo cartel. Lo que se reescribe es **qué puede hacer el que lee**: la
guía del encargado dice «anular sólo lo podés hacer vos o el dueño», y desde la
terminal eso es falso.

**D5 · `Tema.equivaleA` resuelve el chip.** Un tema declara qué tema de otro rol
documenta la misma pantalla (`terminal-salon` → `equivaleA: "mesas"`). El chip
sigue pasando el slug de la tab y la resolución la hace el layout, que es el
único que sabe el rol. Cero cambios en los diez sitios donde está el chip.

**D6 · `/ayuda/[tema]` deja de servir temas ajenos.** Un slug que no es del rol
que mira redirige al índice. Es la contracara de la 169: sacarlo del índice y
dejar la URL abierta no es filtrar, es esconder.

**D7 · Sin capturas nuevas.** Las de la spec 134 son de las mismas pantallas y el
recorte del rol no cambia el pixel. Cuando el índice de la terminal esté probado
en el local se verá si alguna hace falta.

**D8 · La guía del mozo sigue pendiente.** No se toca `/mozo`. Cuando golf-house
pase a la Etapa 2 y los mozos tengan móvil, esa es su spec.

---

## Alcance

| Qué | Dónde |
|---|---|
| `Tema.equivaleA` + `temaDeRol(slug, rol)` + equivalencias por rol | `src/lib/ayuda/contenido.ts`, `recorrido.ts` |
| Los seis temas de la terminal, `roles: ["terminal"]` | `src/lib/ayuda/contenido.ts` |
| El chip resuelve al tema del rol que mira | `ayuda-progreso.tsx`, `ayuda-chip.tsx`, `layout.tsx` |
| `/ayuda/[tema]` redirige si el tema no es del rol | `ayuda/[tema]/page.tsx` |
| `temaSiguiente` navega dentro de los temas del rol | `contenido.ts`, `ayuda/[tema]/page.tsx` |

## Qué NO entra

- **La guía del mozo** (`/mozo`) — D8.
- Capturas y videos nuevos — D7.
- Tocar la matriz de `sections.ts` o cualquier permiso: esta spec **documenta**
  lo que la 140 decidió, no lo cambia.
- El tema «Me apareció un cartel»: los carteles del encargado son de pantallas
  que la terminal no ve. Se reevalúa con el local.

## Escenarios de aceptación

1. **La terminal entra a Ayuda.** Ve sus seis temas y el recorrido «1 de 6». No
   ve «La caja», «La rendición de los mozos» ni «Cobrar una cuenta».
2. **El chip `?` de la tab Salón.** Desde la terminal abre `terminal-salon`;
   desde el encargado, `mesas`. Mismo componente, mismo `tema="mesas"`.
3. **URL ajena.** La terminal escribe `/admin/ayuda/caja` y cae en el índice, no
   en el tema del encargado.
4. **El tope.** El tema de la terminal dice 10 %, y el del encargado sigue
   diciendo 25 %. Los dos salen de `can.ts`, ninguno tipeado a mano.
5. **El encargado no ve nada nuevo.** Su índice sigue teniendo veinte temas y su
   recorrido nueve.
6. **El punto del chip** aparece sobre el tema de la terminal sin leer, y se
   apaga cuando la terminal termina SU recorrido de seis.

## Verificación

```bash
node scripts/magic-link.mjs terminal@demo.test "/demo/admin/ayuda"
```

Y con `sofia@demo.test` para comprobar que su guía quedó igual.
