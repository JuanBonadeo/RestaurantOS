# Implementation Plan: 062 — Motor de cobro unificado

## Enfoque

Un componente, cuatro callers. El componente **no sabe qué está cobrando**: recibe cuánto falta y una función que registra el pago. Eso es lo que permite que la venta de mostrador —donde la orden nace recién al cobrar— use exactamente el mismo formulario que una mesa abierta.

El refactor es **de estructura, no de comportamiento**: si algo se ve o se comporta distinto al final, es un bug. La red de seguridad es esa: los tests existentes de cobro no se editan, y el diff visible tiende a cero.

Orden pensado para que el riesgo se pague temprano: el componente nace sirviendo al caller **más pobre** (el pedido del board, 293 líneas sin reglas), donde cualquier error se ve enseguida y no hay nada que romper. El del mozo —la superficie en producción— se migra último, cuando el motor ya corrió en los otros tres.

## El contrato

```ts
// src/components/billing/cobro-form.tsx
export type CobroSubject =
  | { kind: "mesa"; label: string }          // "Mesa 12"
  | { kind: "pedido"; orderNumber: number }  // "Pedido #48"
  | { kind: "mostrador" };                   // "Venta rápida"

export type CobroSubmit = {
  method: PaymentMethod;
  amountCents: number;        // con el ajuste del método ya aplicado
  tipCents: number;
  cajaId: string;
  lastFour?: string;
  cardBrand?: "visa" | "mastercard" | "amex" | "otro";
  notes?: string;
  adjustmentPercent: number;
  adjustmentCents: number;
  requestId: string;          // estable entre taps, nuevo tras un cobro OK
};

export type CobroFormProps = {
  subject: CobroSubject;
  /** Lo que falta cobrar, SIN ajuste de método. */
  amountDueCents: number;
  cajas: Caja[];
  methodConfigs: PaymentMethodConfig[];
  /** Mostrador no ofrece MP; el pedido sí. */
  allowedMethods: PaymentMethod[];
  /** Hallazgo T002-2: no es un booleano. El mozo la trae de la orden (se carga
   *  en el paso Cuenta y no se toca al cobrar); el encargado la edita acá. */
  tip:
    | { mode: "none" }
    | { mode: "fixed"; cents: number }
    | { mode: "editable"; initialCents?: number };
  /** Ergonomía: mozo = touch, paneles del admin = compact. */
  size?: "touch" | "compact";
  /** El caller elige el action. El form no importa server actions.
   *  Devuelve el resultado COMPLETO: el mozo lo usa para mergear la fila ya
   *  persistida sin refrescar la pantalla (spec 41). Hallazgo T002-1. */
  onSubmit: (input: CobroSubmit) => Promise<ActionResult<unknown>>;
  /** MP: preference + link/QR + polling. Sin esto, no se ofrece MP. */
  mp?: {
    start: (input: { method: "mp_link" | "mp_qr"; amountCents: number; tipCents: number; cajaId: string })
      => Promise<ActionResult<{ paymentId: string; initPoint: string }>>;
    onPaid: () => void;
  };
};
```

Lo que **queda adentro** (una sola vez): ajuste por método, guarda de efectivo, vuelto, validación de últimos 4, nota obligatoria en `transfer`/`other`, botón bloqueado en vuelo, `requestId`.

Lo que **queda afuera** (del caller): qué orden/split se cobra, `splitId: null` vs split real, cerrar la orden, liberar la mesa, facturar, refrescar.

**Facturar queda afuera a propósito** (hallazgo T002-3): hoy `emitInvoice` está en el mozo, en el pedido y en el mostrador — **el único que no factura es el cobro del encargado**. El bloque de comprobante se extrae a `comprobante-fields.tsx` y lo monta el caller que corresponda; que el encargado no lo tenga es una asimetría a decidir con Juan, no algo a replicar.

## Capas

### Datos
**Sin migración.** No hay tabla ni columna nueva: es un refactor de UI sobre un motor que ya existe.

### Dominio
- `src/lib/billing/adjustment.ts` — mover `calculateAdjustment` (hoy duplicada como helper local en `cobrar-client.tsx:495` y en el desktop) + test. Es la última regla de dinero que sigue copiada.

### Cliente
- `src/components/billing/cobro-form.tsx` — el componente. Sin `PageShell`, sin `Dialog`, sin `Sheet`: sólo el cuerpo del formulario. El contenedor lo pone cada caller.
- `src/components/billing/comprobante-fields.tsx` — el bloque de Factura A/B extraído de `cobrar-pedido-sheet.tsx` antes de borrarlo (FR-008).
- Los cuatro callers quedan como cáscaras: cargan datos, arman el `subject`, eligen el action, envuelven en su contenedor.

## Orden (TDD)

1. **`calculateAdjustment` a `lib/billing` + test.** Las dos copias pasan a importarla. Nada más cambia — commit chico y verificable solo.
2. **`CobroForm` + tests de comportamiento** sin tocar ningún caller: recargo aplicado, efectivo de menos rechazado, de más = vuelto, últimos 4, nota obligatoria, doble tap = un `requestId`, métodos filtrados por `allowedMethods`, propina oculta con `allowTip: false`.
3. **Pedido del board** (el caller más pobre): `CobrarPedidoSheet` pasa a montar `CobroForm` + `ComprobanteFields`. **Acá se gana el recargo que hoy se cobra mal.** Test de integración: mismo `amount_cents` que la mesa (SC-005).
4. **Cobro del encargado**: página + panel embebido. Sin cambios de layout ni de props externas. Los tests de cobro existentes quedan verdes **sin editarlos**.
5. **Venta de mostrador**: el bloque de pago del panel pasa al form; el picker no se toca. Gana la guarda de efectivo y los últimos 4.
6. **Cobro del mozo**: `CobroForm` con `size="touch"` dentro del `CobrarSplitDialog` actual. **Ni el flujo ni los tamaños cambian.**
7. Borrar lo que quedó muerto (FR-012) y confirmar que no queda ningún formulario paralelo.
8. `pnpm typecheck` + `pnpm test` + `pnpm build`.
9. **Verify en vivo con roles reales**, los cuatro: mozo cobrando una mesa en el celular (mixto + MP), encargado cobrando desde el panel del salón, pedido del board con tarjeta con recargo, venta de mostrador en efectivo.

Cada paso del 3 al 6 es un commit que deja el árbol verde y la app usable: si hay que parar a la mitad, lo migrado ya está mejor y lo no migrado sigue funcionando como hoy.

## Riesgos

- **El cobro del mozo es la superficie en producción de golf.** Decidido con Juan hacer las cuatro juntas; el orden (mozo último) es la mitigación: cuando le toca, el motor ya corrió en tres callers. El otro seguro es que el modal, el flujo y los taps no se tocan — sólo cambia de dónde sale el formulario.
- **Diferencias silenciosas entre los dos clientes grandes.** 1357 y 1022 líneas que *parecen* lo mismo pueden no serlo (labels, orden de campos, qué se muestra cuando). Antes de migrar cada uno hay que diffear su comportamiento real, no asumir: lo que se descubra se documenta en la spec y se decide, no se pierde en el merge.
- **El ajuste sobre monto editado** ya es inconsistente hoy. Unificar obliga a elegir una semántica; si la elegida cambia algún caso real, es un cambio de comportamiento y va explicitado, no escondido en el refactor.
- **Refactor sin cambio funcional visible = fácil de "casi terminar".** Si queda un quinto formulario vivo, el problema empeora (ahora hay cinco). FR-012 no es opcional.
