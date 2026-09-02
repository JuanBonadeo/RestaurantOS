# 134 · La guía del encargado, adentro del panel

**Issue:** [RestaurantOS-Brain#35](https://github.com/gachetponzellini/RestaurantOS-Brain/issues/35) ·
**Milestone:** sin asignar — Sprint 07 venció el 14-ago y no hay uno posterior ·
**Estado:** implementada · v3 enfoca en Operación y Catálogo (2026-09-02)

**Input:** Juan, 2026-08-31: *"vamos a armar una parecida pero para el encargado,
que sea lo mas simple posible, con un formato parecido"*, sobre la guía del
vendedor de CEPRO — y después *"faltaría una parte de pedidos, y lo de regla de
oro lo sacaría"*.

**Referencia:** `cepro-brain/specs/017-guia-vendedor/spec.md` y su implementación
en `cepro-panel` (`app/(app)/ayuda/`, `lib/ayuda/contenido.ts`). De ahí sale la
forma; el contenido no se comparte una línea.

## Por qué

Golf-house migra de **MaxiRest** con go-live a ~2 semanas. El encargado no es un
usuario nuevo del panel: es un usuario nuevo de cualquier cosa que no sea el POS
que viene usando hace años. Y el panel hoy **no explica nada en ningún lado**: el
único texto de ayuda que existe en todo `src/` es
[`atajos-help.tsx`](../../src/components/admin/local/atajos-help.tsx), que lista
atajos de teclado.

Hay una diferencia honesta con la spec 017 de CEPRO y conviene decirla acá
arriba: **aquella se escribió sobre 302 pedidos medidos en producción**, con
nombre y apellido de quién había abandonado. Nosotros no tenemos ese dato porque
todavía no hay piloto corriendo. Esta guía es **preventiva**, y eso cambia una
sola cosa: el índice sale de lo que el código puede hacerle al encargado, no de
lo que ya lo trabó. El primer día real de golf-house es lo que va a reordenarlo.

Tres cosas que sí sabemos, y que son el argumento:

**1 · El día del encargado es una sola pantalla.** `/admin/operacion` con siete
tabs ([`local-shell.tsx:84`](../../src/components/admin/local/local-shell.tsx)):
`salon` · `reservas` · `comandas` · `pedidos` · `caja` · `rendicion` · `fichaje`.
No hay que enseñarle a navegar un panel: hay que enseñarle siete trabajos.

**2 · El encargado es el único rol con techo.** El mozo no decide y el admin
puede todo; el encargado vive justo en el borde, y el borde son dos números
puestos por nosotros en [`can.ts`](../../src/lib/permissions/can.ts):
descuento hasta **25 %** (`DESCUENTO_MEDIO_PCT`) y diferencia de caja hasta
**$5.000** (`DIFERENCIA_CAJA_OK_CENTS`). Por encima, escala a admin. Nadie se lo
dijo nunca, y es exactamente el momento en que un encargado llama por teléfono.

> ⚠️ Esos dos números son *"los defaults que pre-llenamos nosotros — **pendiente
> validación cliente**"*, palabras del propio `can.ts`. La guía los va a imprimir
> en pantalla. Si vuelven distintos de la matriz firmada, hay **dos** lugares que
> cambiar. Se anota en RNF-3.

**3 · Las pantallas que más le importan se acaban de mover.** Cerrar caja es de
la [spec 130](../130-cerrar-caja/spec.md); confirmar reservas, de la
[131](../131-confirmar-la-reserva/spec.md) y la
[132](../132-la-decision-por-whatsapp/spec.md); editar y cobrar un pedido online,
de la [125](../125-editar-el-pedido-online/spec.md) y la
[126](../126-cobrar-el-pedido-online/spec.md). Son cambios de las últimas
semanas: llegamos al go-live con lo más nuevo del producto sin una línea escrita.

## Las decisiones

**D1 · La guía vive adentro del panel.** No un PDF en Drive ni un video: un
manual que hay que ir a buscar no se lee. Ruta `/[business_slug]/admin/ayuda`.

**D2 · Organizada por tarea.** Acá la tarea coincide con la tab, que es la
suerte de este caso: un tema por trabajo del turno, en el orden en que el turno
pasa. Nunca "Módulo de caja".

**D3 · Todo desplegado: sin acordeones y sin buscador.** Buscar exige saber la
palabra, y el que más necesita la guía es el que no la sabe. El scroll es gratis.

**D4 · Las frases se toman del código, no se reescriben.** El encargado tiene que
poder encontrar en la guía la frase exacta que está leyendo en la pantalla. Si se
cambia un cartel, se cambia acá.

**D5 · Vocabulario del local.** Se usan las palabras del glosario del negocio —
comanda, comandera, arqueo, rendición, fichar, cuenta, mesa. **Prohibido**:
kanban, estado, payload, RLS, server action, spec, tab, modo estricto/flexible.

**D6 · La legibilidad es el requisito, no un detalle.** Cuerpo 18 px (el panel
usa 14), contraste ≥ 7:1, 60–70 caracteres por línea, todo lo clickeable ≥ 48 px.
Se lee en un celular de 375 px sin zoom y sin scroll horizontal.

**D7 · El chip `?` al lado del título de cada tab.** Es lo que hace que la guía
exista: nadie se acuerda de que hay un menú "Ayuda" justo cuando está trabado. El
chip lleva al tema **de esa tab**, no al índice.

**D8 · El contenido es un dato tipado, no MDX.** El repo no tiene MDX y no se
agrega una dependencia para esto. Un solo archivo, escrito de una sentada.

**D9 · Sin videos y sin script de capturas.** CEPRO gastó tres clips y 477 líneas
de puppeteer en eso. Acá la v1 va con capturas a mano y solo donde el texto no
alcanza. Si el piloto muestra que hacen falta, se agregan después.

**D10 · No hay tema "reglas de oro".** Decidido por Juan. Una lista de
prohibiciones al final se lee una vez y no se vuelve; el aviso sirve cuando está
en el paso donde uno se equivoca. Los tres peligros reales —cobrar dos veces,
aceptar una diferencia que no cierra, anular sin motivo— van como
`aviso: 'peligro'` **adentro** de su paso.

**D11 · Solo el encargado.** Admin, mozo, cocina y platform admin quedan afuera.
El mozo tiene su propia app y merece su propia guía, no un capítulo de ésta.

**D12 · Reservas se escribe para los dos modos.** El modo es por negocio —
`mode: 'estricto' | 'flexible'` en la config de reservas
([`types.ts:82`](../../src/lib/reservations/types.ts), spec 059)— y cambia tanto
lo que el encargado ve que un texto común no serviría. El tema muestra **solo el
modo del negocio en el que estás parado**: se lee de la config, no se ponen los
dos con un "si tu local usa…". Es la única parte del contenido que no es la
misma para todos los negocios.

## Los temas

Tres pasadas el mismo fin de semana. **v1**: seis temas. **v2**: dieciséis, para que
hablara de todo el panel. **v3**, pedido de Juan: *"que enfoques la guía para usar el
sistema en la parte de operación, y catálogo, que sea bien visual"*.

La v2 trataba las dieciséis pantallas como iguales, y no lo son: el encargado **vive**
en Operación y **mantiene** Catálogo; el resto lo abre cada tanto. La v3 acomoda la guía
a eso.

**D16 · Dos grupos son el centro, y se nota.** El índice arranca con **Operación** —una
pestaña, un tema— y sigue con **Catálogo**. Los dos van ilustrados pantalla por pantalla;
«Lo demás del panel» se queda en texto. No es que el resto importe menos: es que ahí no
se aprende mirando, se lee una vez y se resuelve.

**D17 · Catálogo se abre en cuatro temas.** «Productos e inventario» es una pantalla con
siete pestañas, pero adentro hay cuatro trabajos que no se parecen: mantener la carta
(`carta`), armar el combo (`menu-del-dia`), contar lo que hay (`stock`) y mirar cuánto
deja cada plato (`costeo`). Con un solo tema había que leer sobre food cost para
encontrar cómo se marca un producto agotado.

**D18 · Una captura por pantalla, del negocio `demo`.** Quince, con los círculos
numerados como dato. Un test exige que **todo tema de Operación y Catálogo tenga al menos
una**: el pedido «bien visual» deja de depender de que alguien se acuerde.

**D20 · El ancho de lectura es del TEXTO, no del contenedor.** Durante tres versiones
el `max-w-[68ch]` estaba puesto en el bloque que envuelve todo, así que también achicaba
las capturas: una pantalla de 1160 px entraba en 490 y no se leía un rótulo. Ahora la
**página** es ancha (1180 px) y el límite de 60-70 caracteres se le pone a cada párrafo y
cada título. La captura llega hasta 1160 px —su ancho nativo, estirarla más sería
agrandar píxeles— y el índice pasa a **dos columnas** desde `lg`: con diecinueve temas,
una sola tira obliga a scrollear la guía entera para ver qué hay.

**D19 · La captura se abre a pantalla completa.** Tocándola se abre a resolución completa
sobre fondo oscuro, con Esc, la X o clic afuera para cerrar; tocar la propia imagen no
cierra, para poder hacer zoom con los dedos. Los círculos son porcentajes, así que caen
bien en todos los tamaños sin recalcular nada.

| Grupo | Temas |
|---|---|
| **Operación** | `caja` · `mesas` · `cobrar` · `comandas` · `pedidos` · `reservas` · `rendicion` · `fichaje` |
| **Catálogo** | `carta` · `menu-del-dia` · `stock` · `costeo` |
| **Lo demás del panel** | `salones` · `proveedores` · `facturacion` · `clientes` · `promociones` · `conversaciones` |
| **Si algo falla** | `carteles` |

`carteles` sigue siendo catálogo, sin numerar, y creció a 37 entradas.

Sigue afuera lo que el encargado **no puede ver** (`dashboard`, `cajas` como config,
`reportes`, `rrhh`, `configuracion`).

### Lo que las capturas corrigieron

Sacar las quince capturas obligó a mirar pantallas que hasta ahí sólo se habían leído en
el código, y aparecieron tres cosas que el texto decía mal:

- **Stock tiene cuatro sub-pestañas**, no dos: Bebidas, Cocina, Bar y Merma. La v2
  hablaba de «stock de bar y stock de cocina» y se olvidaba de Bebidas, que es la más
  grande (137 productos en `demo`).
- **El cartel de la comandera caída** es *"Agente de impresión sin conexión (sin señal)"*,
  no *"sin conexión"* a secas, que era lo que la guía mandaba a buscar con Cmd+F.
- **Los métodos de pago muestran recargo** ya calculado —«Tarjeta +10% · $26.400» sobre
  una cuenta de $24.000—. No estaba escrito en ningún lado y es lo que el encargado le
  dice al cliente antes de cobrar.

## Alcance

```
src/app/[business_slug]/admin/(authed)/ayuda/page.tsx        índice de tarjetas
src/app/[business_slug]/admin/(authed)/ayuda/[tema]/page.tsx un tema por página
src/app/[business_slug]/admin/(authed)/ayuda/estilos.ts      las constantes de D6
src/lib/ayuda/contenido.ts                                    todo el texto, tipado
src/components/admin/ayuda-chip.tsx                           el "?" de D7
public/ayuda/*.png                                            capturas, las que hagan falta
```

**Tipos** (`contenido.ts`):

```ts
type Aviso  = { tono: 'ojo' | 'peligro'; texto: string }
type Marca  = { n: number; x: number; y: number }   // % del ancho/alto, no px
type Paso   = { titulo; texto; imagen?; alt?; marcas?; aviso?; verTambien? }
type Tema   = { slug; titulo; resumen; icono; tipo?: 'pasos' | 'catalogo'; pasos: Paso[] }
```

Sin `video` — D9. Las marcas van como **dato y no quemadas en el PNG**: la
explicación tiene que vivir en el texto (adentro de la imagen no se lee a 375 px)
y volver a sacar una captura no puede obligar a abrir un editor.

**Contenido, lo que cada tema tiene que cubrir de verdad:**

- **`caja`** — abrir con el fondo, cargar un movimiento, el arqueo, y el cierre de
  la [spec 130](../130-cerrar-caja/spec.md) completo: el conteo, la diferencia, y
  qué pasa cuando pasa los **$5.000** que puede aceptar solo. Ese último paso
  lleva `aviso: peligro`.
- **`mesas`** — abrir mesa, pasar de mesa, cerrar, y anular mesa o producto **con
  motivo**. La anulación lleva `aviso: peligro`.
- **`cobrar`** — cobro, propina, descuento hasta el **25 %** y qué hacer arriba de
  eso, y anular un cobro ya hecho. "Un cobro hecho no se hace de nuevo" va acá,
  como aviso del paso, no como regla suelta (D10).
- **`pedidos`** — los pedidos online: el contador de nuevos, aceptar, editar
  (spec 125), cobrar (126), los dos horarios (127) y la observación de la tanda
  (128). Es el tema que Juan pidió agregar.
- **`reservas`** — el libro del modo que use el negocio (D12), confirmar y
  rechazar una solicitud, editar antes de decidir (spec 132), el cupo —**duro para
  el cliente, blando para el encargado**— y el no-show.
- **`carteles`** — uno a uno, con la frase literal (D4) y qué hacer. Se arma
  **leyendo los archivos**, no de memoria: los errores de `caja`, los de cobro,
  los de reserva sin cupo, el fallo de impresión (spec 33 del brain) y el aviso
  de print-agent caído.

**Navegación:** ítem **Ayuda** al pie de
[`admin-sidebar.tsx`](../../src/components/admin/admin-sidebar.tsx) y de
[`admin-mobile-nav.tsx`](../../src/components/admin/admin-mobile-nav.tsx), fuera
del bloque de módulos, visible para admin y encargado. Tema inexistente →
`notFound()`.

## Qué NO entra

| Qué | Por qué |
|---|---|
| Videos y script de capturas | D9. CEPRO gastó 3 clips + 477 líneas de puppeteer; acá se decide después del piloto. |
| Hoja imprimible A4 | CEPRO la necesita porque cubre el caso "no puedo entrar al panel" de un vendedor que está en la calle. El encargado está parado frente a la pantalla. Si el primer turno la pide, es una v1.1 barata. |
| Guía del mozo | D11. La app del mozo es otra y merece su propia spec. |
| Guía de admin / dueño | Config, analítica y facturación no las toca el encargado. |
| Buscador y tour de bienvenida | D3. Los spotlights se cierran sin leer y no vuelven. |
| Guía sin login | Vive detrás de `(authed)`. El caso "no puedo entrar" no lo cubre la guía. |
| Mover los topes de `can.ts` a config por negocio | Ya está previsto en el propio archivo (`business_settings.permissions`). No es de esta spec. |

## Escenarios de aceptación

1. Un encargado que nunca entró **cierra una caja con diferencia** siguiendo solo
   `/admin/ayuda`, sin llamar a nadie. Se cronometra y se anota dónde se traba: lo
   que aparezca ahí **es** el backlog de la v1.1.
2. Las frases de `carteles` se pueden buscar con Cmd+F **contra el fuente** (D4).
   Se verifica leyendo los archivos, no de memoria.
3. Los topes que imprime la guía —25 % y $5.000— coinciden con `can.ts` el día que
   se escribe.
4. En un negocio en `estricto` el tema `reservas` muestra el libro estricto; en
   uno en `flexible`, el flexible. Nunca los dos, nunca un "depende" (D12).
5. En un celular de 375 px: sin scroll horizontal y sin zoom para leer.
6. Las seis pantallas del encargado tienen el chip `?` y cada uno abre su tema.
7. Ninguna captura muestra datos de un cliente real: se usan las de `demo`.
8. `pnpm typecheck` y `pnpm test` en verde. Checklist pre-entrega de `qa-brain`.

## Tasks

Tres, no una por tema: el contenido entero es **un solo archivo** y partirlo
serían tres PRs peleándose por las mismas líneas.

| # | Qué | Depende de |
|---|---|---|
| 1 | El código: rutas `/ayuda` y `/ayuda/[tema]`, tipos de `contenido.ts`, `estilos.ts`, ítem del sidebar y el `<AyudaChip>` en las seis pantallas | — |
| 2 | Los seis temas escritos, con los carteles leídos del fuente y reservas mode-aware | 1 |
| 3 | Capturas de `demo` donde el texto no alcance + verify en vivo como Sofía (`sofia@demo.test`), que es el rol real de esta guía | 2 |

## Requisitos no funcionales

- **RNF-1** — Sin dependencias nuevas.
- **RNF-2** — La estructura se puede mergear **vacía**: el código no depende de que
  el contenido esté escrito. Un tema sin pasos se muestra "En preparación" y no se
  abre.
- **RNF-3** — La guía envejece con la pantalla. Entran al checklist de `qa-brain`
  dos líneas: *"si tocaste una pantalla del encargado, actualizá su tema en
  `/ayuda`"* y *"si movés un tope de `can.ts`, movelo también en `contenido.ts`"*.
  Sin eso la guía se pudre en dos sprints y miente en el peor momento.
