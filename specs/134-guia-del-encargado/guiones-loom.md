# Guiones de los Loom · guía del encargado

Para grabar los ocho videos de **Operación**. Uno por tema, en este orden.

## Antes de grabar, cinco reglas

1. **Entrá al negocio `demo`, nunca a uno real.** Los videos quedan publicados y
   muestran nombres de clientes, montos y teléfonos.
   ```bash
   node scripts/magic-link.mjs sofia@demo.test "/demo/admin/operacion"
   ```
2. **Grabá como Sofía (encargada), no como admin.** Con el rol de dueño vas a
   mostrar botones que el encargado no tiene, y a nadie le va a coincidir la
   pantalla con el video.
3. **Ventana a 1440 px de ancho.** Más grande y el texto queda ilegible en el
   celular; más chico y el panel cambia de layout.
4. **Máximo 2 minutos.** Si no entra, el tema está pidiendo dos videos, no uno más
   largo.
5. **No leas el guion.** Es el orden de lo que mostrás, no un libreto: si se lee,
   se nota y se hace largo.

## Después de grabar

Pegá el link de compartir de Loom en el tema, en `src/lib/ayuda/contenido.ts`:

```ts
video: {
  url: "https://www.loom.com/share/xxxxxxxx",
  titulo: "Cerrar la caja con diferencia",
  duracion: "1:40",
},
```

El embed se arma solo. **El video no reemplaza los pasos escritos** — van abajo,
completos, siempre: un video no se busca con Cmd+F, no se mira con el salón lleno
sin auriculares, y el asistente de la guía no lo lee.

> Un video cuesta más de mantener que un párrafo: cuando cambia una pantalla, el
> texto se arregla en un minuto y el video hay que regrabarlo. Por eso son ocho y
> no diecinueve — y por eso conviene grabarlos recién cuando la pantalla esté
> quieta.

---

## 1 · `caja` — La caja: movimientos y cierre

**Lo que tiene que quedar:** que podés cerrar con hasta $5.000 de diferencia, que
toda diferencia pide motivo escrito, y que las propinas no están en el número.

1. Entrás a Operación, pestaña **Caja**. Señalás los dos números de arriba y decís
   por qué **no** coinciden: uno es lo que tiene que haber en el cajón, el otro es
   la venta del turno con todos los métodos.
2. **Sangría**: mostrás el formulario y que el motivo tiene asterisco rojo.
3. **Cerrar caja**: contás el cajón y aparece «Te falta».
4. Escribís el motivo y mostrás la casilla **Retirar todo el efectivo**, con la
   diferencia entre dejar la plata y llevarla.
5. Cerrás diciendo qué pasa si la diferencia se pasa de $5.000.

## 2 · `mesas` — El salón

**Lo que tiene que quedar:** anular mesa y anular cobro son cosas distintas.

1. El plano: los colores, la referencia de abajo, el reloj de cada mesa.
2. Abrís una mesa libre y le cargás algo.
3. **Pasar a cobro** desde la mesa (sin cobrar — eso es el video 3).
4. **Trasladar mesa** a una libre.
5. **Anular mesa** con motivo. Decís claro: *si ya se cobró, esto no es lo que
   buscás*.

## 3 · `cobrar` — Cobrar una cuenta

**Lo que tiene que quedar:** mirar la caja antes de confirmar, el tope de 25 %, y
no tocar «Cobrar» dos veces.

1. Abrís el cobro y señalás **primero** la caja donde va a quedar.
2. Mesa completa vs. sub-cuentas.
3. Propina.
4. Descuento: subís hasta pasarte y mostrás **«Excede tu autorización»** en rojo.
   Lo bajás y ponés el motivo.
5. Cobrás con Tarjeta para que se vea el **recargo ya calculado**.
6. Cerrás con la regla del doble clic: si se queda pensando, refrescar y mirar.

## 4 · `comandas` — La cocina y las comanderas

**Lo que tiene que quedar:** qué hacer cuando una comanda no salió.

1. Las tres columnas y la **saturación por sector**.
2. Una comanda fallida y **«Ver solo las fallidas»**.
3. Reimprimir, avisando que primero hay que chequear si el papel ya salió.
4. Mostrás el cartel **«Agente de impresión sin conexión (sin señal)»** y explicás
   que es la PC del local, no el sistema.

## 5 · `pedidos` — Los pedidos de la web

**Lo que tiene que quedar:** «No marchó» en rojo es lo más urgente de la pantalla.

1. Las cinco columnas y el contador de la pestaña.
2. Confirmar un pedido nuevo.
3. Un **Programado** y dónde vive.
4. Uno en **«No marchó»**: qué pasó y por qué conviene mirar Comandas antes de
   marcharlo de nuevo.
5. Editar y cobrar desde el detalle.

## 6 · `reservas` — Reservas

⚠️ **Van dos videos, uno por modo.** Grabá el del modo de golf-house primero, y el
otro sólo si hace falta. Mostrar el modo equivocado es peor que no tener video.

1. El día y cómo se cambia de fecha.
2. Tomar una por teléfono.
3. Una solicitud de la web: **Confirmar** y **Rechazar** con motivo, diciendo que
   el motivo le llega al cliente.
4. Editar antes de decidir.
5. Sentar, y **No vino**.
6. *(sólo en flexible)* El servicio lleno y **«Confirmá para reservar igual»**.

## 7 · `rendicion` — La rendición de los mozos

**Lo que tiene que quedar:** rendir no cambia el total, y sin rendiciones no cierra
la caja.

1. Quién debe cuánto.
2. Tomar una entrega que coincide.
3. Una que no coincide: el motivo.
4. **«Marcar como no entregó»** y que queda como deuda a la vista.
5. **Últimas rendiciones** como el lugar donde mirar después.

## 8 · `fichaje` — Fichaje y asistencia

El más corto: 40 segundos alcanzan.

1. Asistencia del día, **Ya salieron**, **Sin fichar**.
2. Alguien fichando con su PIN.
3. Que el PIN es de cada uno, y que **«Sin fichar»** a mitad del turno suele ser un
   olvido: preguntá antes de dar por ausente a nadie.
