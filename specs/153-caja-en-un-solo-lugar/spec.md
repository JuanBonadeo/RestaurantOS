# 153 · Caja en un solo lugar

**Issue:** [#229](https://github.com/gachetponzellini/RestaurantOS-app/issues/229) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ implementada (2026-09-03)

**Input:** Juan, 2026-09-03: *"habría que unificar las vistas de cajas y cierres
de caja, siendo todo algo más un todo, también si podés la vista que se abre
cuando tocás Cajas yo la mejoraría, y el tema de los filtros de las fechas
también se puede mejorar"*.

**Diseño:** [canvas](https://claude.ai/code/artifact/8f354390-33bd-4496-af53-d1ea06e76256)
— cuatro artboards, mockups estáticos contra el sistema visual real.

**Toca**: [`149`](../149-el-cierre-de-caja-se-puede-volver-a-mirar/spec.md) (los
cierres, que se mudan), [`070`](../070-libro-de-movimientos/spec.md) (el libro,
que también), [`007`](../../openspec/changes/07-caja-rendicion-mozos/) (la
sección Cajas), [`140`](../140-los-mozos-en-la-compu-del-salon/spec.md) (la
matriz de secciones que esta spec modifica).

---

## Por qué

Caja está partida en **cuatro superficies que no se conocen entre sí**:

| Dónde | Qué es | Quién la ve |
|---|---|---|
| `/admin/operacion?tab=caja` | el período vivo | encargado + admin |
| `/admin/operacion/cierres` | el historial (spec 149) | encargado + admin |
| `/admin/operacion/movimientos` | el libro (spec 070) | encargado + admin |
| `/admin/cajas` | la config | **sólo admin** |

Tres cuelgan de Operación —entre Mesas, Comandas y Fichaje— y la cuarta es un
ítem propio del menú lateral
([`admin-sidebar.tsx:114`](../../src/components/admin/admin-sidebar.tsx)).
Ninguna presenta a las otras: el board de caja tiene un link suelto a
«Ver movimientos», la sección Cajas tiene otro, y los cierres —que se hicieron
hoy— cuelgan de un texto en el header de una tarjeta.

Es crecimiento por acumulación: cada spec agregó su superficie donde le quedaba
cómodo. Cuatro specs, cuatro lugares.

## La división: dos puertas, no una

**La decisión la puso Juan y es mejor que colapsar todo en un lugar.** Ante la
pregunta de si Caja iba adentro de Operación o como sección propia:

> *"es que ya tiene btn primario en el menu de la izquierda, yo creo que habría
> que hacer las dos, una para ver los movimientos de la caja abierta, y la del
> menu izq que tenga todo"*.

**D1 · Se parte por para qué se entra, no por dónde está.**

- **Operación → tab Caja** = *la caja abierta*. Lo que está pasando ahora:
  cuánto hay, qué se movió, cerrar. Es donde la encargada vive durante el turno
  y no tiene que irse a ningún lado para operar.
- **Menú → Caja** = *todo*. Las cajas con su estado, el historial de cierres y
  el libro, bajo un sub-nav.

Colapsar las cuatro en una sola pantalla habría mezclado dos modos distintos: el
de la 1 de la mañana con una mesa esperando, y el del martes al mediodía
revisando qué pasó. El tab pierde el sub-nav (es una sola cosa) y gana un link a
la sección.

**D2 · La sección absorbe las dos rutas que hoy cuelgan de Operación.**
`/admin/operacion/cierres` y `/admin/operacion/movimientos` se mudan a
`/admin/caja/cierres` y `/admin/caja/movimientos`. Los links viejos redirigen:
la spec 149 se implementó hoy y sus URLs pueden estar en un historial o pegadas
en una issue.

## Las decisiones

**D3 · La vista de Cajas deja de ser una lista de config.** Hoy muestra nombre,
renombrar y pausar — de una caja llamada «Caja Principal» no se aprende **nada**.
Pasa a mostrar, por caja: cuánto hay adentro ahora, el último cierre con su
número y su diferencia, y quién la opera. Todo eso **ya existe en la base**
(`getCajaLiveStats`, `caja_cortes`, `caja_user_assignments`) y no está junto en
ningún lado. Las acciones de config se mantienen, en un menú.

El caso que esto resuelve solo: una caja **sin operadores asignados** hoy no
avisa nada, y el que cobre ahí va a terminar rindiéndose a sí mismo
(spec 139 · D3). En la vista nueva se ve de un vistazo.

**D4 · El filtro de fechas: granularidad + stepper.** Los dos
`<input type="date">` se reemplazan por **Día · Mes · Año** y un stepper
`‹ etiqueta ›`. El 90 % de las veces se quiere «ayer» o «el mes pasado», y hoy
eso son cuatro toques en dos calendarios.

La etiqueta se nombra sola: «Hoy» / «Ayer» / `lun 31/8` · «Este mes» / `Agosto` /
`Diciembre 2025` (el año sólo cuando no es el corriente) · `2026`. La flecha de
adelante se apaga en el presente: no hay cierres mañana.

**D5 · El día es operativo, de 6 AM a 6 AM.** Decisión de Juan. Un restaurante
cierra a la 1 de la mañana: con el día de calendario **el cierre de anoche cae en
«Hoy»** y el turno queda partido en dos. Con el día operativo el turno entero
—los cobros de la noche y el corte que los cierra— cae en un solo día, que es
como ya lo cuenta el ticket de la comanda
([`ticket.ts:136`](../../src/lib/print/ticket.ts)).

Ojo con el alcance: esto define **qué entra en cada filtro**, no cambia ningún
cálculo de plata. La ventana de un corte sigue siendo
`(corte anterior, este corte]` (spec 149 · D2), que no tiene nada que ver con
esto.

**D6 · La encargada entra a la sección y puede configurar.** Decisión de Juan.

⚠️ **Esto revierte una decisión escrita, con su porqué anotado en el código.**
[`sections.ts`](../../src/lib/permissions/sections.ts) tiene `cajas: encargado =
none` y explica:

> *cortes/sangría → se hacen en Operación (`operacion?tab=caja`), no en la
> sección Cajas (que es config de caja, admin). Por eso `cajas` = none p/
> encargado.*

El argumento era correcto **mientras la sección fuera sólo config**. Deja de
serlo con D1/D2: negarle al encargado el historial de cierres y el libro porque
comparten ruta con el botón de crear caja es negarle su propio trabajo — y es
exactamente el trabajo que la spec 149 le acaba de dar.

Lo que **sí** cambia de verdad, y por eso se dice: la encargada gana **pausar una
caja**, y una caja pausada no aparece para cobrar. Es el único poder nuevo que no
es de sólo mirar. Conversado y aceptado.

**D7 · El `terminal` no entra.** La compu compartida del salón sigue sin ver
caja, ni el tab ni la sección (spec 140 · D2). Esta spec no la toca — y conviene
recordar que [el libro hoy sí se le escapa](https://github.com/gachetponzellini/RestaurantOS-app/issues/228),
porque usa `canSee("operacion")`; al mudarse a la sección Caja eso se arregla de
paso, pero el arreglo es de esa issue, no de ésta.

## Alcance

- **Sin migración.** No hay dato nuevo: todo lo que la vista de Cajas muestra ya
  se calcula.
- **`src/lib/permissions/sections.ts`** — `cajas: encargado = "full"`, y el
  comentario que explicaba lo contrario se **actualiza** (no se borra: la razón
  vieja explica por qué la celda decía otra cosa).
- **Rutas** — `src/app/[business_slug]/admin/(authed)/caja/` con `page.tsx` (las
  cajas), `cierres/`, `cierres/[corteId]/` y `movimientos/`. Las tres rutas
  actuales bajo `operacion/` redirigen permanentemente.
- **`src/components/admin/caja/caja-shell.tsx`** — el sub-nav de la sección.
- **`src/components/admin/caja/filtro-fechas.tsx`** — el control nuevo, y
  **`src/lib/caja/rango-fechas.ts`** con la lógica pura: granularidad + ancla →
  `{from, to}` en día operativo, y la etiqueta. Es lo único con tests propios.
- **La vista de Cajas** — reescrita sobre `getCajasConEstado` + stats + los
  operadores asignados.
- **El tab de Operación** — pierde el link suelto a movimientos y gana uno a la
  sección.

## Qué NO entra

- **Mover el tab Caja fuera de Operación** (D1).
- **Tocar el cálculo del efectivo esperado, el cierre o la rendición.** Esta spec
  mueve pantallas y cambia un filtro; la plata no se toca.
- **El comportamiento del libro** (spec 070). Cambia de ruta, no de qué hace.
- **Aplicar el día operativo al resto del panel.** Reportes y el mail de cierre
  (spec 34) tienen su propia definición de día; unificarlas es otra spec y toca
  números que hoy alguien mira.
- **Que el `terminal` vea algo de caja** (D7).

## Escenarios de aceptación

1. **Dado** un encargado, **cuando** abre «Caja» en el menú, **entonces** entra —
   hoy no puede (D6).
2. **Dado** que está en la sección, **entonces** ve las tres sub-vistas y puede
   pasar entre ellas sin volver a Operación.
3. **Dado** el tab Caja de Operación, **entonces** sigue mostrando **sólo** el
   período vivo, con su selector de caja y el botón de cerrar.
4. **Dado** un link viejo a `/admin/operacion/cierres`, **cuando** se abre,
   **entonces** redirige a `/admin/caja/cierres` sin 404.
5. **Dado** el filtro en «Día» sobre el presente, **entonces** dice «Hoy» y la
   flecha de adelante está deshabilitada.
6. **Dado** un cierre registrado a las 01:14, **cuando** el filtro está en «Día»
   y se retrocede uno, **entonces** ese cierre aparece — cae en el día operativo
   anterior, junto con los cobros de esa noche (D5).
7. **Dado** el filtro en «Mes» sobre un mes de otro año, **entonces** la etiqueta
   incluye el año.
8. **Dado** una caja sin operadores asignados, **entonces** la vista de Cajas lo
   señala (D3).
9. **Dado** un `terminal`, **cuando** navega a `/admin/caja` a mano, **entonces**
   no entra (D7).
10. **Dado** una caja de **otro** negocio, **entonces** no aparece ni se puede
    abrir por URL.

## D10 · Los dos desgloses se cruzan (2026-09-03)

Juan, mirando la caja viva: *"en la parte que dice cobrado por origen que muestre
cobrado por método […] y abajo donde ahora dice cobros por método que diga cobros
por origen, y que diferencie de cada origen cuánto debería haber cobrado de cada
método"*.

**Los dos desgloses que había no se podían leer juntos.** La pantalla decía
«Salón $ 206.500» y «Efectivo $ 228.500» sin ninguna forma de saber **cuánto del
salón fue en efectivo** — que es justo lo que explica el arqueo: un delivery
cobrado con tarjeta no pone un peso en el cajón, uno en efectivo sí.

- Los bloques **se intercambian**: arriba «Cobrado por método» con su barra,
  abajo «Cobros por origen».
- El de origen suma el **cruce**: total del origen + barra apilada por método +
  el monto de cada método escrito. El gráfico da la proporción de un vistazo, el
  número es el que se usa para cuadrar.
- Un color por método, **el mismo en las dos mitades** de la pantalla
  (`METHOD_COLOR`): así un origen se compara con otro sin leer las etiquetas.
- El cambio aplica a las **tres** superficies que mostraban estos bloques: la
  caja viva, el modal de cierre y el resumen archivado.

**Dato nuevo:** `ventas_por_origen_y_metodo` en `CajaLiveStats`, de la función
pura `cruzarOrigenYMetodo`. Sin migración: se calcula de los mismos `payments`.

Sus tests fijan lo que importa: **cada fila cierra con el total de su origen y
cada columna con el total de su método**. Si el cruce derivara, las dos mitades
de la pantalla mostrarían plata distinta para los mismos cobros.

## D11 · Cobrado por empleado (2026-09-03)

Juan: *"la rendición por empleado podría ser más estético ese componente"*. Era
una tabla de cuatro columnas con el nombre repetido en blanco y el total del
mozo **entre paréntesis, pegado al último monto** — dos números en una celda,
sin rótulo. Ahora es una tarjeta por persona: nombre, total, y los métodos con
el **mismo punto de color** que las barras de arriba.

Arreglando lo estético aparecieron dos cosas que no eran estéticas:

**Sumaba con propina.** Usaba `amount_cents` pelado, así que este bloque mostraba
más plata que el desglose por método de la misma pantalla, para los mismos
cobros. Va neto, como todo el resto (spec 098).

**Se llamaba «Rendición» y listaba tarjeta** — justo lo que la spec 151 sacó de
la rendición. Acá se sigue mostrando (es la caja, y ver lo que cobró cada uno es
el punto) pero el bloque pasa a llamarse **«Cobrado por empleado»**, y una línea
«Efectivo a rendir» dice cuál de esos números se le va a pedir. Sin mozo no lleva
esa línea: no hay a quién pedírselo.

La agregación se mudó a `agruparCobrosPorMozo` en `liquidacion-mozo.ts`, con
tests: neto de propina, «a rendir» sólo efectivo, el cobro sin mozo que no se
pierde, y el orden por lo cobrado.

## Verificación

`pnpm typecheck` en 0 errores y **2223 tests unitarios en verde** (los 21
`*.integration.test.ts` fallan por falta del stack local, sin aserciones rotas).
`rango-fechas.test.ts` aporta 26: los bordes del día operativo (05:59 y 06:01
caen en días distintos), las etiquetas en las tres granularidades, el cruce de
fin de mes y de año, y que la basura en la URL caiga en el período corriente.

**Verificado en vivo en `demo`, con los dos roles.**

Como **Sofía (encargada)** en `/demo/admin/caja` — que hasta hoy no podía abrir:

| | Caja Principal | Caja Bar |
|---|---|---|
| Adentro ahora | $ 280.500 | $ 0 |
| Último cierre | jue 13/8 · 16:09 | lun 31/8 · 11:00 |
| Cerró con | −$ 3.800 · «Faltó plata» | $ 0 · «Cerró justo» |
| La operan | Pedro Mozo | **«Nadie asignado»** |

La Caja Bar salió avisando *«El que cobre acá va a tener que rendirse a sí
mismo»* — el caso de D3, con datos reales y sin que nadie lo buscara.

El filtro: `?gran=mes&fecha=2026-08` etiqueta **«Agosto»** y trae los dos cortes
de agosto. El redirect de `/admin/operacion/cierres?caja=abc` llega a
`/admin/caja/cierres?caja=abc` **con el filtro puesto**.

Como **`terminal`**: navegar a `/demo/admin/caja` rebota a `/admin/operacion`, y
«Caja» no aparece en su menú (D7).

### Ajustes posteriores (2026-09-03)

**D8 · «Ver ahora» abre esa caja, y no la pisa.** El link de cada caja lleva
`?caja=<id>`, que la página de Operación pasa como prop hasta el board
(`resolverCajaActiva`, pura y **resuelta en el render**, no en un effect: así no
hay parpadeo mostrando la caja equivocada, que en una pantalla de plata molesta
más que en otra).

**No persiste la elección**, y es deliberado. La preferencia por máquina es
sobre dónde ese puesto **cobra**; mirar la caja del bar desde la compu del salón
no tiene por qué cambiarle el default de cobro después. Elegirla en el selector
sí lo hace — eso sigue siendo `elegirCaja`.

**D9 · Un cierre sin número muestra su fecha, no un guión.** Los cortes
anteriores a la spec 139 no tienen `numero` y no se retro-numeran. Un «—» grande
no dice nada: en ese caso el dato que identifica al cierre es **cuándo** fue, así
que la fecha sube al renglón principal.

### Nota sobre los cortes de `demo`

Los dos son anteriores a la spec 139, así que no tienen `numero` y la columna
«Último cierre» muestra «—». Es correcto: no se retro-numeran.

## Riesgo

**El día operativo es una definición nueva de «día» en un producto que ya tiene
otras.** El mail de cierre de turno (spec 34) y los reportes usan el día de
calendario en la TZ del negocio. Después de esta spec, «ayer» puede significar
dos cosas distintas según la pantalla.

Se acepta a propósito —acá el día operativo es el correcto, y unificar el resto
toca números que alguien ya mira todos los días— pero queda anotado: si aparece
una diferencia entre el mail y la pantalla, **es esto**.
