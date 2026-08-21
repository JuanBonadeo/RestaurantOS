# 126 · Cobrar el pedido online: la transferencia sin peaje y el link que no cobra

**Issue:** [#196](https://github.com/gachetponzellini/RestaurantOS-app/issues/196) ·
**Milestone:** Post-demo · Growth & hardening

**Input:** Juan, 2026-08-21: *"Para cerrar los pedidos en transferencia hay que
poner una nota si no no te deja. Cerrar con link de pago no se puede, lo cerré en
visa. Eso es para cobrar, hay que ver esos procesos"*.

## Por qué

Dos fricciones del mismo momento —cerrar un pedido online desde el board— que se
ven juntas y no tienen nada que ver entre sí.

### 1 · La transferencia cobraba peaje

`transfer` y `other` exigían nota (spec 062 · FR-004), con el argumento de dejar
el alias o la referencia para conciliar. Los pedidos reales de golf-jcr del
2026-08-20 muestran qué pasó de verdad:

| pedido | método | nota que quedó |
|---|---|---|
| #2 | transfer | `T` |
| #3 | transfer | `transfirio` |
| #5 | transfer | `T` |
| #6 | transfer | `T` |
| #9 | transfer | `T` |
| #10 | transfer | `a` |

El que cierra el pedido no tiene el comprobante de la transferencia delante: lo
mira el que concilia, al otro día, en el homebanking. Pedirle la referencia al
que aprieta el botón no produce auditoría, produce una letra. Es fricción con
costo cero de beneficio.

**`other` sí la sigue exigiendo**, y ahí el argumento se sostiene: «otro» no dice
nada por sí solo — la nota *es* el método (`cheque #1234`, `cortesía`).

### 2 · «Link de pago» no cierra nada

En el cobro del pedido, elegir «Link Mercado Pago» **no registra un cobro**:
llama a `iniciarPagoMp`, crea una preference nueva y se queda en *«Esperando
confirmación»* hasta que alguien pague **ese** link. `registrarPago` directamente
rechaza `mp_link`/`mp_qr` (*«Para MP, usá iniciarPagoMp»*).

El rastro del pedido #7 de anoche, en la base:

```
02:06:31  mp_link      $80.000   payment_status: pending   ← preference generada
02:07:01  card_manual  $88.000   payment_status: paid      ← se cerró con visa
```

Treinta segundos entre uno y otro. El pedido no cerraba, se cerró en visa —con
el +10% de recargo de la tarjeta, sobre una venta que no fue con tarjeta— y quedó
un pago `pending` colgado del pedido para siempre, que nadie puede borrar.

La caja no se infló (todo lo que suma filtra por `payment_status = 'paid'`), pero
el método miente y el libro tiene mugre.

## La decisión

Juan, 2026-08-21. Dos cosas, cortas:

**D1 · La nota en transferencia pasa a opcional.** El campo queda, con el
placeholder de siempre («Alias o referencia…»), sin asterisco y sin bloquear el
botón. `other` no se toca.

**D2 · MP link/QR salen del cobro del pedido online.** Generar una preference no
cobra: deja el pedido abierto esperando a un pagador que no está. El cliente que
paga con MP lo hace **en el checkout** (`payment_method: 'mp'`, el webhook
acredita). El que ya pagó por un link mandado a mano se asienta por el método que
corresponda. Generar el link con el cliente delante sigue existiendo **en la
mesa**, que es donde tiene sentido.

## Qué se toca

| Archivo | Cambio |
|---|---|
| `components/billing/cobro-form.tsx` | `notesRequired = method === "other"`. El asterisco y el bloqueo se van solos. |
| `lib/billing/cobro-actions.ts` | Misma regla en el server: sólo `other` exige nota. |
| `lib/caja/correcciones.ts` | Ídem, por consistencia: corregir una línea a `transfer` tampoco pide nota. La corrección **ya** exige `motivo` obligatorio — el rastro de auditoría nunca colgó de este campo. |
| `components/admin/cobrar-pedido-sheet.tsx` | Sin el prop `mp`. El `CobroForm` ya filtra `mp_link`/`mp_qr` cuando no lo recibe (`if (isMpMethod(m.value) && !mp) return false`) — no hace falta ninguna palanca nueva. |

Cuatro archivos, ninguna migración, ningún contrato nuevo.

## Qué NO cambia

- **El cobro de la mesa.** Mozo y encargado siguen teniendo MP link y QR: ahí el
  cliente está presente y el link se paga en el momento.
- **El checkout.** `payment_method: 'mp'` sigue siendo el camino del que paga
  online, con su webhook.
- **`other`.** Sigue exigiendo nota.
- **La guarda de efectivo, el recargo por método, la propina y el `requestId`.**
  Nada del motor de cobro (spec 062) se mueve.

## Lo que queda pendiente (fuera de esta spec)

- **El pago `pending` huérfano del pedido #7** (`d4520c39`) sigue en la base. Es
  dato del cliente real: se limpia con Juan mirando, no de prepo.
- **No hay forma de asentar «pagó por link» como tal.** Con D2 ese cobro se
  registra como transferencia u otro, y el mix de métodos del dashboard lo cuenta
  ahí. Si el local manda links por WhatsApp seguido, esto vuelve como pedido
  propio: un `mp_link` cobrado a mano, sin preference.
- **Nadie limpia las preferences que quedan `pending`.** Ni acá ni en la mesa hay
  expiración ni cancelación de un pago MP que nunca se acreditó.

## Verificación

- `pnpm typecheck` · `pnpm test` (unidad) en verde.
- **En vivo, con rol real de encargado:**
  1. Pedido online → Cobrar → **Transferencia**: confirma sin escribir nada.
  2. Lo mismo escribiendo el alias: la nota queda guardada en el pago.
  3. **Otro**: sigue pidiendo la nota (botón deshabilitado hasta escribirla).
  4. El selector de métodos del pedido **no ofrece** Link ni QR de MP.
  5. En la **mesa** (mozo y encargado), Link y QR siguen apareciendo y funcionando.
