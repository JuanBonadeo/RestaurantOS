# 135 · El asistente de la guía

**Issue:** [RestaurantOS-Brain#36](https://github.com/gachetponzellini/RestaurantOS-Brain/issues/36) ·
**Estado:** implementada y verificada en vivo (2026-09-02)

**Input:** Juan, 2026-09-02: *"me gustaría armar ahora un llm, de asistente que pueda
ayudar al encargado si tiene alguna duda, que use de contexto todo lo que tiene la guía,
que sea algo básico pero útil"*.

**Depende de**: [`134-guia-del-encargado`](../134-guia-del-encargado/spec.md) — sin la
guía escrita no hay contexto, y toda la calidad del asistente sale de ahí.

## Por qué

La guía tiene diecinueve temas y 35 carteles, y está bien organizada. Pero sigue
exigiendo saber **dónde** buscar, y el encargado con el salón lleno no piensa "esto es
del tema Caja": piensa *"me falta plata en la caja, ¿qué hago?"*. Preguntar es más rápido
que navegar, y la pregunta que hace es literalmente el título del problema.

## Las decisiones

**D1 · La guía entera va en el prompt. Sin RAG.** Son ~40 KB de texto ya curado, ya
verificado contra el código y ya escrito en el idioma del encargado: entra cómodo. Un
recuperador que trae "los tres pasos más parecidos" es exactamente el que se olvida del
`[PELIGRO]` que estaba dos pasos más abajo — y en esta guía los avisos son la mitad del
valor. Mandar todo es más simple, más barato con prompt caching, y **no pierde nada**.

> Si algún día la guía no entra (arriba de ~150 KB, y hay un test que avisa), se
> reemplaza por recuperación **por tema**: traer el tema entero, nunca fragmentos
> sueltos. Eso conserva la propiedad que importa: los avisos viajan con su paso.

**D2 · El contexto se arma desde `TEMAS`, no de un markdown aparte.** Una copia se
desactualiza, y un asistente que cita una guía vieja es peor que uno que no sabe. La
fuente es la misma que se pinta en pantalla.

**D3 · Tres reglas duras, que no son de estilo sino de seguridad del producto.**

1. **Sólo la guía.** El encargado pregunta sobre plata, permisos y anulaciones. Un
   asistente que completa con "lo que suele pasar en un restaurante" va a inventar un
   tope de descuento, y eso es peor que no tenerlo: se le cree.
2. **No fabricar frases de pantalla.** Las frases entre comillas de la guía son
   literales del código y el encargado las usa para reconocer un cartel; una inventada
   lo manda a buscar algo que no existe.
3. **Decir que no sabe** y derivar. Es la respuesta correcta más seguido de lo que
   parece, y es la que mantiene el resto creíble.

**D4 · Sin herramientas y sin acceso a datos.** No consulta la caja del día ni las
mesas. Eso es otra superficie —permisos, RLS, plata en un prompt— y no es lo que se
pidió. El asistente lee la guía y nada más.

**D5 · Mode-aware, como la guía.** El contexto se arma con el modo de reservas del
negocio. Al escribir el contexto apareció que dos entradas de `carteles` eran del modo
flexible y se le mostraban igual a un local `estricto`: se agregó `soloModo` por entrada,
que arregla **también** la guía en pantalla.

**D6 · Los temas citados se validan contra los que existen.** El modelo cita `[caja]`;
si alucina un identificador, no se pinta el link — si no, la ayuda tendría un 404 adentro.

**D7 · Va arriba del índice, no en un botón flotante.** Preguntar tiene que ser lo
primero que se ve al entrar a Ayuda. Con tres ejemplos reales de mostrador, que arrancan
la conversación sin obligar a escribir y de paso enseñan qué clase de cosas contesta.

## Alcance

```
src/lib/ayuda/asistente.ts        contexto + system prompt + parseo de la respuesta
src/lib/ayuda/actions.ts          la server action (ChatAnthropic, prompt caching)
…/ayuda/asistente.tsx             la caja de preguntas
```

Reusa el `ChatAnthropic` y la `ANTHROPIC_API_KEY` que ya usa el chatbot de reservas. Sin
dependencias nuevas. `AYUDA_MODEL` pisa el modelo; 700 tokens de respuesta, que para una
duda de mostrador sobra y acota el gasto.

Permisos: mismo círculo que la guía —admin y encargado—, chequeado **en la action** y no
sólo en la página, porque una server action se puede llamar directo.

## Qué NO entra

| Qué | Por qué |
|---|---|
| Herramientas / datos del negocio | D4. Es otra spec, con permisos y RLS. |
| Streaming de la respuesta | Con 700 tokens la espera es corta; sumar streaming es complejidad sin premio. |
| Historial persistido | Vive en la pantalla. Nadie vuelve a leer lo que preguntó ayer. |
| Feedback (👍/👎) | Útil, pero necesita dónde guardarlo y quién lo mire. Cuando haya piloto. |

## Verificación

Verificado en vivo en `demo` como **Sofía (encargada)**, manejando Chrome por CDP:

1. *"Me falta plata en la caja, ¿qué hago?"* → explicó el tramo hasta $5.000, citó el
   cartel textual *"La diferencia excede tu autorización. Pedile al admin que cierre la
   caja."*, agregó el aviso de no tocar el conteo, y linkeó al tema de caja.
2. *"¿Cuánto tengo que aportar de monotributo y cómo cambio el logo del ticket?"* →
   *"Eso no está en la guía. Para el monotributo consultá con tu contador. Para cambiar
   el logo del ticket, preguntale al dueño o a quien configure el sistema."* Sin links,
   porque no citó ningún tema. **Es el caso que decide si el asistente sirve.**

Los tests cubren lo que sí se puede testear sin el modelo: que el contexto tenga los
diecinueve temas, que los `[PELIGRO]` viajen con su paso, que traiga un solo modo, que el
prompt tenga las tres reglas, y que un identificador inventado no se pinte.
