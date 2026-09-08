# 169 · La guía no se lee sola

**Issue:** [#255](https://github.com/gachetponzellini/RestaurantOS-app/issues/255) ·
**Milestone:** Post-demo · Growth & hardening ·
**Estado:** ✅ implementada y verificada en vivo (2026-09-07)

**Input:** Juan, 2026-09-07: *"la guía quedó muy con el LLM al que se le puede
preguntar, yo lo que haría es que al entrar un usuario por primera vez que lo
meta ahí de entrada, y que lo haga leer todo de alguna manera, en un futuro
vamos a tener que hacer una guía para cada rol"*.

**Depende de**: [`134`](../134-guia-del-encargado/spec.md) (la guía y sus veinte
temas), [`135`](../135-asistente-de-la-guia/spec.md) (la caja de preguntas),
[`142`](../142-entrar-es-lo-mas-dificil/spec.md) (la bienvenida, que ya manda a
la guía), [`140`](../140-los-mozos-en-la-compu-del-salon/spec.md) (el rol
`terminal`).

---

## Por qué

### La primera mitad del pedido ya está construida

Cuando alguien termina la bienvenida no vuelve al panel: lo mandamos a la guía.
Está en
[`welcome-form.tsx:117`](../../src/components/admin/welcome/welcome-form.tsx),
y es el D4 de la spec 142 — *"recién creó su contraseña: lo que necesita no es el
panel vacío sino saber qué hacer con él"*.

Así que el pedido de arriba se parte en dos, y sólo la segunda mitad es trabajo:
**meterlo ahí ya está; hacerlo leer, no.**

### Lo que ve el que llega

Cae en `/admin/ayuda`, que hoy es, de arriba hacia abajo:

1. el título y una bajada,
2. **la caja de preguntas del asistente**
   ([`page.tsx:50`](<../../src/app/[business_slug]/admin/(authed)/ayuda/page.tsx>)),
3. veinte tarjetas en cuatro grupos.

Nada le dice por dónde empezar, nada registra que empezó, y nada se entera de si
volvió. Es una biblioteca, y lo que hace falta el primer día es una clase: una
puerta, un orden, y un final.

El resultado previsible es el que ya conocemos de cualquier centro de ayuda: mira
la pantalla tres segundos, no sabe cuál de las veinte le toca, y se va al panel a
aprender a los tropezones — que es exactamente lo que la spec 134 quiso evitar.

### El asistente está bien, pero no en la puerta

La caja de preguntas contesta muy bien **al que sabe qué preguntar**. El de
primer ingreso no lo sabe: no tiene todavía las palabras del sistema.

Es el mismo argumento que la propia spec 134 usó en su D3 para no poner buscador
— *"buscar exige saber la palabra, y el que más necesita la guía es justamente el
que no la sabe"*. Una caja de preguntas es un buscador con mejores modales: le
cabe el mismo argumento. No hay que sacarla; hay que sacarla **de la puerta**.

### Y por la puerta ya entran roles a los que la guía no les habla

`sections.ts` abre `ayuda` a `mozo` y `terminal`, y lo dice con todas las letras:

> *"Spec 142 · D4: se abre para el salón, porque al terminar la bienvenida se los
> manda acá a aprender el sistema. **OJO** — el contenido de hoy está escrito para
> el encargado (spec 134); la guía del mozo es su propia spec. Esto abre la
> puerta, no la llena."*
> — [`sections.ts:216`](../../src/lib/permissions/sections.ts)

O sea: la guía por rol no es del futuro, es una deuda abierta **de hoy**. Un mozo
que termina la bienvenida cae en un índice cuyo primer tema es «Caja» y donde se
le imprimen en pantalla los topes del encargado — 25 % de descuento, $5.000 de
diferencia de caja — que no son los suyos. La spec 134 lo había decidido al revés
en su D11 (*"solo el encargado"*); la 142 abrió la puerta sin poder llenarla.

---

## Las decisiones

**D1 · El primer ingreso no cae en el índice: cae en el primer tema.** La
bienvenida deja al usuario en `/admin/ayuda/<primer tema de su recorrido>`, con
un encabezado que dice qué es esto y cuánto dura: *"Arrancá por acá · 1 de 9"*.
Un índice es para volver, no para empezar.

**D2 · El recorrido es el turno, no los veinte temas.** Sólo el grupo
**Operación** — los nueve trabajos del turno, en el orden en que el turno pasa.
Catálogo, «lo demás» y «si algo falla» quedan en el índice, para cuando aparezcan.
Nadie lee veinte capítulos el primer día: el que "lee" veinte apretó *siguiente*
veinte veces, y eso es peor que no leer porque nos deja creyendo que leyó.

**D3 · No bloquea.** Se sale del recorrido cuando se quiera, con un «salir»
visible en pantalla, y nunca se lo vuelve a encerrar. Golf-house entra en
go-live con el salón lleno: una pared entre la persona y el panel el primer día
se saltea igual, y encima nos miente.

**D4 · Lo que reemplaza a la pared es el pendiente que no se apaga.** Mientras el
recorrido esté a medias, el ítem **Ayuda** del sidebar muestra lo que falta
(«Ayuda · 5 de 9») y el chip `?` de una pantalla cuyo tema todavía no leyó lleva
un punto. Sin modales, sin popups, sin tour con flechitas encima de la pantalla:
una barra que no se completó pide sola que la completen. Se apaga cuando termina
el recorrido, y no vuelve.

**D5 · «Leído» es que llegó al final y lo dijo.** Lo marca el botón que ya existe
al pie del tema —«Seguir con: …»,
[`[tema]/page.tsx:236`](<../../src/app/[business_slug]/admin/(authed)/ayuda/[tema]/page.tsx>)—
que además de navegar registra. Nada de scroll-spy ni de temporizadores: si
abrió, miró el título y se fue, **no leyó**, y es mejor que el sistema no se
mienta a sí mismo con una métrica que sabe falsa.

**D6 · El progreso es del par (usuario, negocio) y vive en una tabla.** No en
`user_metadata` — que es del auth, es global y no está scopeado por negocio.
La misma persona puede ser encargada en House y mozo en Golf, y son dos
recorridos distintos que no se comparten. Tabla nueva con RLS por `business_id`,
como todo el resto (principio 6).

**D7 · El asistente baja del primer lugar.** Sigue en el índice, pero **debajo de
Operación**: el que ya conoce el sistema y está trabado en el mostrador
scrollea medio segundo; el que llega por primera vez ve primero el orden, que es
lo que necesita. Y en el recorrido no aparece: ahí no hay que preguntar, hay
que leer.

**D8 · `Tema.roles` — el seam de las guías por rol.** Se agrega el campo al tipo
`Tema`; el índice, el recorrido y el contexto que se le pasa al asistente filtran
por el rol real del que mira. Hoy los veinte temas quedan `["admin",
"encargado"]`, que es lo que efectivamente son.

> Efecto inmediato en el mozo y en la terminal: **dejan de ver la guía del
> encargado** y ven, en su lugar, una guía corta que dice que la suya se está
> escribiendo. Es un paso atrás aparente y una mejora real: hoy leen topes de
> autorización que no son suyos. Si preferís lo contrario —que sigan viendo la
> del encargado hasta que exista la propia— es una línea, y va acá.

**D9 · El contenido del mozo es otra spec.** Su app es `/mozo`: otras pantallas,
otros pasos, otras palabras. No es un capítulo de ésta — lo mismo que ya decía el
D11 de la 134.

---

## Alcance

| Qué | Dónde |
|---|---|
| Tabla `ayuda_lecturas` (`business_id`, `user_id`, `tema`, `leido_at`) + RLS | migración nueva |
| `Tema.roles` + `recorridoDe(rol)` + `progresoDe(...)` | `src/lib/ayuda/contenido.ts` |
| Marcar leído (server action, upsert por columna de negocio) | `src/lib/ayuda/actions.ts` |
| Encabezado del recorrido («1 de 9», «salir») y el botón que marca | `ayuda/[tema]/page.tsx` |
| Índice filtrado por rol + asistente debajo de Operación | `ayuda/page.tsx`, `asistente.tsx` |
| Destino del primer ingreso: primer tema del recorrido | `welcome-form.tsx:117` |
| Contador en el ítem del sidebar + punto en el chip `?` | `shell/`, `ayuda-chip.tsx` |

## Qué NO entra

- **El contenido de la guía del mozo y de la terminal** — spec aparte (D9).
- **Una guía del admin**: ve la del encargado, que es la que le sirve.
- Videos nuevos, capturas nuevas, y reescribir un solo paso de los que ya están.
- Cualquier forma de puntaje, insignias o «completaste el 80 %» — es una guía de
  trabajo, no un curso.
- Recordatorios por mail o WhatsApp de que le falta leer.

## Escenarios de aceptación

1. **Primer ingreso de una encargada.** Termina la bienvenida → cae en el primer
   tema del recorrido, con «1 de 9» y un «salir» visible. No ve el índice.
2. **Lo completa.** Nueve «siguiente» → pantalla de cierre, el contador del
   sidebar desaparece y no vuelve en los logins siguientes.
3. **Lo abandona en el 3.** Sale al panel; el sidebar dice «Ayuda · 3 de 9» y el
   chip `?` de Caja —que no leyó— tiene punto. Vuelve a Ayuda y retoma en el 4,
   no en el 1.
4. **Segundo login.** Entra derecho a lo suyo. La guía no lo intercepta nunca más.
5. **Un mozo termina la bienvenida.** No cae en «Caja»: ve la guía de su rol —
   hoy, la nota de que se está escribiendo. En ninguna pantalla se le imprime el
   tope de descuento ni el de diferencia de caja del encargado.
6. **La misma persona en dos negocios.** Leyó todo en House; entra a Golf y su
   recorrido de Golf está en cero.

## Verificación

En vivo, con el rol real y magic link (nunca `service_role`):

```bash
node scripts/magic-link.mjs sofia@demo.test "/demo/admin/ayuda"
```

Sofía es encargada: es el rol del recorrido. Para el escenario 5, `pedro@demo.test`
(mozo). El primer ingreso se prueba limpiando `welcomed_at` del usuario de prueba,
no creando usuarios nuevos en la nube compartida.
