# 120 · Cargar pedido: siempre ahora, y notas con nombre

**Issue:** [#184](https://github.com/gachetponzellini/RestaurantOS-app/issues/184) ·
**Milestone:** Post-demo · Growth & hardening

## Por qué

Dos cosas de la hoja de cargar pedido, pedidas por Juan.

**El paso «¿Para cuándo?» sobra hoy.** El local arranca mandando todo al
momento; que la carga te pregunte por una función que todavía no usan es un paso
más en hora pico, y el default correcto ya es «ahora».

**Las notas no decían de quién eran.** «Notas del pedido» y «Entregar» no
distinguen la que va al ticket de control de la que sale arriba de la comanda.
Las descripciones ya lo explicaban bien; los títulos no.

## Qué se construye

### FR-001 · El pedido sale siempre ahora

`MOSTRAR_PROGRAMADO = false` esconde la sección entera. Con `when` en `"now"`,
`isScheduled` queda siempre en `false`, así que el pie muestra los dos botones de
siempre («Cargar y enviar a cocina» / «Sólo cargar») y ⌘Enter confirma marchando.

**No se toca el motor de programados**: los slots, la validación de lead en
`persistOrder`, el cron que marcha solo y la bandeja «Próximos» quedan como
están — un pedido programado que ya exista sigue funcionando igual. Esto sólo
esconde la puerta de entrada desde la carga del personal.

La constante va tipada `boolean` a propósito: sin eso TypeScript estrecha a
`false` y marca como muerto todo el bloque, que es justamente el que hay que
poder revivir.

### FR-002 · Las notas dicen a quién van

| Antes | Ahora |
|---|---|
| Notas del pedido (opcional) | **Nota para el pedido** (opcional) |
| Entregar (opcional) | **Nota para cocina** (opcional) |

Las descripciones de abajo no cambian: siguen diciendo que una va en el ticket de
control con los datos de la entrega y la otra sale como «ENTREGAR …» arriba de la
comanda.

## Verificación

1. `pnpm typecheck` + `pnpm test` en verde.
2. En vivo: abrir «Cargar pedido» → no aparece «¿Para cuándo?»; confirmar deja el
   pedido con la comanda en cocina, como antes.
3. Poner `MOSTRAR_PROGRAMADO = true` devuelve el paso intacto.
