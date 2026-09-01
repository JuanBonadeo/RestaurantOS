import {
  Wallet,
  LayoutGrid,
  Receipt,
  Truck,
  CalendarDays,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import type { ReservationMode } from "@/lib/reservations/types";

// ============================================
// Contenido de la guía del encargado — spec 134 (RestaurantOS-Brain#35).
//
// Es un DATO TIPADO, no MDX: el repo no tiene MDX y no se agrega una
// dependencia para esto (D8). El renderer vive en
// `app/[business_slug]/admin/(authed)/ayuda/`.
//
// TRES REGLAS AL EDITAR ESTE ARCHIVO:
//
// 1. Las frases entre comillas son LITERALES de la pantalla (D4). El encargado
//    tiene que poder buscar acá lo que está leyendo allá. Si cambiás un cartel
//    en el panel, cambialo también acá — si no, la guía miente, y miente justo
//    en el momento en que alguien la abrió porque no entendía algo.
// 2. Nada de vocabulario nuestro (D5). No existen "kanban", "estado",
//    "payload", "tab", "server action", "RLS" ni "spec". Existen la comanda, la
//    comandera, el arqueo, la rendición, fichar, la cuenta y la mesa.
// 3. Los números que salen de `can.ts` (el 25 % de descuento, los $5.000 de
//    diferencia de caja) se escriben UNA vez, acá abajo, importados de ahí. No
//    se tipean a mano en el texto de un paso: el día que el cliente devuelva la
//    matriz firmada con otros topes, tiene que haber un solo lugar que tocar.
// ============================================

/** 'ojo' = tenelo en cuenta · 'peligro' = si lo hacés mal, se cobra dos veces,
 *  se acepta una caja que no cierra, o se anula algo sin registro.
 *  Dos tonos a propósito: con tres ya no se distinguen, y si todo es urgente
 *  nada lo es. */
export type Aviso = { tono: "ojo" | "peligro"; texto: string };

/**
 * Un círculo numerado sobre un punto de la captura. `x`/`y` son PORCENTAJES
 * del ancho y del alto de la imagen, no píxeles: así el número sigue cayendo
 * donde tiene que caer cuando la captura se escala en un celular de 375 px.
 *
 * La anotación va como DATO y no quemada adentro del PNG. Dos razones: la
 * explicación tiene que vivir en el texto del paso —adentro de la imagen no se
 * lee a 375 px— y volver a sacar una captura cuando cambie la pantalla no
 * puede obligar a rehacerla en un editor de imágenes.
 */
export type Marca = { n: number; x: number; y: number };

/** Adónde seguir cuando un paso se apoya en otro tema. Es un link y no prosa
 *  ("está explicado en el tema Cobrar"): mandar a alguien de vuelta al índice a
 *  buscarlo a mano es la fricción que hace que se abandone la guía y no la duda. */
export type VerTambien = { tema: string; texto: string };

export type Paso = {
  titulo: string;
  texto: string;
  verTambien?: VerTambien;
  /** Ruta bajo /public, ej. '/ayuda/caja-cierre.png'. */
  imagen?: string;
  /** Obligatorio si hay imagen. */
  alt?: string;
  marcas?: Marca[];
  aviso?: Aviso;
};

/**
 * 'pasos'    → una secuencia: primero esto, después aquello. Va numerada.
 * 'catalogo' → una lista para BUSCAR en ella. NO se numera: el encargado que
 *              tiene un cartel en la pantalla no lee del 1 al 12, escanea los
 *              títulos hasta encontrar el suyo, y los números le dirían que hay
 *              un orden que en realidad no existe.
 */
export type TipoTema = "pasos" | "catalogo";

export type Tema = {
  slug: string;
  titulo: string;
  resumen: string;
  icono: LucideIcon;
  /** Default 'pasos'. */
  tipo?: TipoTema;
  pasos: Paso[];
  /**
   * D12 — sólo lo usa `reservas`. El modo es por negocio (`estricto` /
   * `flexible`) y cambia tanto lo que el encargado ve que un texto común no
   * serviría: en estricto elige un horario de una grilla fija, en flexible
   * escribe la hora en un libro. Se muestra SÓLO el modo del negocio en el que
   * está parado — nunca los dos con un "si tu local usa…", que obliga a
   * alguien apurado a decidir cuál de las dos mitades le toca.
   */
  pasosPorModo?: Record<ReservationMode, Paso[]>;
};

/** Los pasos que le tocan a este negocio. */
export function pasosDe(tema: Tema, modo: ReservationMode): Paso[] {
  return tema.pasosPorModo?.[modo] ?? tema.pasos;
}

// ─── Los temas ──────────────────────────────────────────────────────────────
//
// Seis, en el orden del TURNO y no en el de la barra del operativo: se abre la
// caja, se trabaja el salón, se cobra, y en el medio entran los pedidos de la
// web y las reservas. `carteles` va último porque no se lee de corrido: se
// busca cuando ya apareció uno.
//
// Los pasos se escriben en la task 2 (issue #35). Un tema sin pasos se muestra
// en el índice como "En preparación" y no se abre: la estructura se puede
// mergear vacía sin prometer nada que no esté (RNF-2).

export const TEMAS: Tema[] = [
  // ── 1 · Caja ──────────────────────────────────────────────────────────────
  {
    slug: "caja",
    titulo: "Abrir la caja, los movimientos y el cierre",
    resumen:
      "Con cuánto arranca el turno, cómo se anota lo que entra y sale, y qué hacer cuando el conteo no da.",
    icono: Wallet,
    pasos: [
      {
        titulo: "Elegí con qué caja estás trabajando",
        texto:
          'Arriba de todo están las cajas del local: Caja Principal, Caja Bar, las que haya. Tocá la que tenés adelante. El sistema se acuerda de tu elección, así que el puesto del bar registra siempre en la del bar sin tener que elegirla cada vez. Si no ves ninguna, dice "Sin cajas configuradas" y las crea el dueño desde la configuración.',
      },
      {
        titulo: 'Qué quiere decir "En la caja deberías tener"',
        texto:
          "Es la plata que tendría que haber en el cajón en este momento: con lo que quedó del último corte, más lo que se cobró en efectivo, menos lo que sacaste. Las propinas NO están adentro de ese número: son del mozo, no del local. Al lado, «Cobrado en el período» es la venta del turno con todos los métodos juntos — tarjeta, transferencia y efectivo —, que es otra cosa y casi nunca coincide.",
        imagen: "/ayuda/caja-periodo.png",
        alt: "La pantalla de Caja, con el recuadro «En la caja deberías tener» a la izquierda y «Cobrado en el período» a la derecha.",
        // % del ancho y del alto de la captura (1160 × 860).
        // Van sobre el rótulo y no sobre el número: el círculo mide 28 px y
        // encima de «$ 168.000» tapaba justo los dígitos que hay que leer.
        marcas: [
          { n: 1, x: 9.5, y: 27.5 },
          { n: 2, x: 56, y: 27.5 },
        ],
        aviso: {
          tono: "ojo",
          texto:
            "Ese número sube y baja solo con los cobros y las sangrías. Si contás el cajón y no da, la diferencia ya existía: no la genera el cierre, la muestra.",
        },
      },
      {
        titulo: "Sacar plata de la caja: Sangría",
        texto:
          'El botón «Sangría» es para sacar efectivo: depósito en banco, pago a un proveedor, lo que sea. Pide el monto y un motivo, y el motivo es obligatorio — si lo dejás vacío te dice "La sangría requiere un motivo.". Escribí algo que se entienda dentro de tres semanas: «pago proveedor verdulería», no «varios».',
      },
      {
        titulo: "Meter plata en la caja: Ingreso",
        texto:
          'El botón «Ingreso» es al revés: sumar efectivo que entra sin ser una venta. Cambio que trajo el dueño, un vuelto que se repone, plata que vuelve de otra caja. También conviene ponerle motivo, aunque acá el sistema no te lo exija.',
      },
      {
        titulo: "Antes de cerrar: que los mozos rindan",
        texto:
          'Un mozo que cobró en efectivo tiene esa plata encima hasta que la entrega. En «Rendición por empleado» ves quién debe cuánto. Rendir no cambia el total del turno: pasa la plata de la columna del mozo a la del cajón. Si falta alguno, el cierre te frena con "Falta 1 rendición para poder cerrar.".',
        verTambien: {
          tema: "carteles",
          texto: "Lo que puede frenar un cierre, uno por uno",
        },
      },
      {
        titulo: "Contá el cajón",
        texto:
          'Tocá «Cerrar caja» y escribí lo que contaste en «Efectivo contado en el cajón». Si te sirve, «Contar por billete (opcional)» te deja cargar cuántos de mil, cuántos de dos mil, y hace la cuenta sola. Es opcional: si ya contaste a mano, poné el total y listo.',
      },
      {
        titulo: "Si no da: la diferencia y el motivo",
        texto:
          'Debajo del monto aparece «Te falta» o «Te sobra» con la diferencia. Cuando hay diferencia el sistema pide que escribas qué pasó: "Hay diferencia con el efectivo esperado. Tenés que registrar el motivo en las notas.". No es burocracia — es lo único que hace que un faltante de mañana se pueda explicar.',
        aviso: {
          tono: "peligro",
          texto:
            'Vos podés cerrar con una diferencia de hasta $5.000. Más que eso, el sistema te frena con "La diferencia excede tu autorización. Pedile al admin que cierre la caja." y hay que llamar al dueño. No lo intentes por partes ni maquilles el conteo: el número que ponés es el que quedó registrado para siempre.',
        },
      },
      {
        titulo: "Retirar la plata o dejarla",
        texto:
          'Antes de confirmar hay una casilla: «Retirar todo el efectivo». Tildada, se lleva todo — "Se registra como sangría del cierre y la caja arranca en $0.". Sin tildar, "La caja queda con lo contado — es el arqueo de mitad de turno.". Se retira todo o nada: no hay retiro parcial. Si estás cortando a mitad del día para contar y seguir, destildala.',
      },
      {
        titulo: "Confirmá",
        texto:
          "«Contar y cerrar» cierra el período y arranca uno nuevo. De ahí en más los cobros del turno viejo ya no se tocan: lo que haya que corregir se corrige en el libro, no volviendo a cerrar.",
      },
    ],
  },

  // ── 2 · Mesas ─────────────────────────────────────────────────────────────
  {
    slug: "mesas",
    titulo: "El salón: abrir, cerrar, anular y pasar de mesa",
    resumen:
      "Todo lo que se hace con una mesa desde el mostrador, incluido lo que el mozo no puede hacer solo.",
    icono: LayoutGrid,
    pasos: [
      {
        titulo: "El plano es el salón",
        texto:
          "Cada figura es una mesa y el color dice cómo está: libre, ocupada, o esperando algo. Abajo de todo está la referencia de colores con cuántas hay de cada una. El número chico adentro de la mesa es hace cuánto que está abierta — sirve para ver de una cuál se está demorando. A la derecha tenés la misma información en lista. Si el local tiene más de un salón, se cambia con las pestañas de arriba.",
        imagen: "/ayuda/salon-plano.png",
        alt: "El plano del salón con las mesas, la referencia de colores abajo y el panel de ocupadas a la derecha.",
        marcas: [
          { n: 1, x: 37, y: 23 },
          { n: 2, x: 8, y: 97 },
          { n: 3, x: 72, y: 58 },
        ],
      },
      {
        titulo: "Abrir una mesa que llega sin reserva",
        texto:
          "Tocá una mesa libre y cargale el pedido: con eso queda abierta. Si esa mesa tiene una reserva más tarde, el sistema te avisa antes — «Podés abrirla igual para un walk-in, pero después vas a necesitar la mesa para esta reserva.» — y elegís «Abrir igual» o buscás otra.",
      },
      {
        titulo: "Sentar una reserva",
        texto:
          'Cuando el cliente de una reserva llega, se la sienta en su mesa con «Sentar la reserva». Si todavía no tiene mesa asignada, el sistema te pide elegirla en el plano. Ojo: una reserva que todavía no confirmaste no se puede sentar — te dice "Confirmá la reserva antes de sentarla.".',
        verTambien: { tema: "reservas", texto: "Cómo se confirma una reserva" },
      },
      {
        titulo: "Cargar y agregar al pedido",
        texto:
          "«Cargar pedido» abre la carta para sumar a esa mesa. Se puede volver a cargar todas las veces que haga falta mientras la mesa está abierta: cada tanda sale como una comanda nueva a su sector.",
      },
      {
        titulo: "Cuando pide la cuenta",
        texto:
          "La mesa pasa a «Pidió la cuenta» y queda marcada en el plano para que se vea de lejos. De ahí, «Pasar a cobro» abre el cobro con todo lo consumido.",
        verTambien: { tema: "cobrar", texto: "Cómo se cobra una cuenta" },
      },
      {
        titulo: "Cambiar el mozo de una mesa",
        texto:
          "«Transferir mozo» pasa la mesa a otro. Sirve cuando alguien se va antes de terminar el turno o cuando hay que repartir de nuevo el salón. Un mozo sólo puede transferir mesas que son suyas; vos podés mover cualquiera.",
      },
      {
        titulo: "Pasar el consumo a otra mesa",
        texto:
          '«Trasladar mesa» mueve la cuenta abierta a otra mesa —los clientes se cambiaron de lugar, se juntaron dos grupos—. La mesa de destino tiene que estar libre: si no, te dice "La mesa está ocupada. Cobrala o liberala antes de mover.". Si alguien tocó la mesa mientras la movías, "La mesa cambió mientras la movías. Refrescá e intentá de nuevo.".',
      },
      {
        titulo: "Anular una mesa",
        texto:
          '«Anular mesa» cancela la orden activa y deja la mesa libre. Es para el cliente que se fue sin consumir o para el error de carga. Pide motivo y es obligatorio — "El motivo de anulación es obligatorio." —, con ejemplos como «cliente se fue, error de carga».',
        aviso: {
          tono: "peligro",
          texto:
            "Anular borra la venta de esa mesa del turno. Un mozo no puede hacerlo: es tuyo o del dueño. Si la mesa ya se cobró, no se anula acá — se anula el cobro, que es otra cosa y deja el rastro del reembolso.",
        },
        verTambien: { tema: "cobrar", texto: "Cómo se anula un cobro ya hecho" },
      },
      {
        titulo: "Repartir el salón entre los mozos",
        texto:
          "El modo «Distribuir mozos» te deja asignar de una varias mesas a cada uno antes de que arranque el servicio. Es tuyo o del dueño: el mozo no reparte el salón.",
      },
    ],
  },

  // ── 3 · Cobrar ────────────────────────────────────────────────────────────
  {
    slug: "cobrar",
    titulo: "Cobrar una cuenta: propina, descuento y anular un cobro",
    resumen:
      "Cómo se cobra, hasta cuánto descuento podés hacer vos, y cómo se deshace un cobro mal hecho.",
    icono: Receipt,
    pasos: [
      {
        titulo: "Abrí el cobro",
        texto:
          "Desde la mesa, «Cobrar mesa» o «Pasar a cobro». Se abre al costado, sin salir del salón: la lista de lo consumido a la izquierda y el pago a la derecha.",
      },
      {
        titulo: "Mirá en qué caja va a quedar",
        texto:
          "Arriba del pago dice «Caja para registrar el cobro». Ese cobro va a aparecer en esa caja al cierre, así que si estás cobrando desde el bar asegurate de que diga la del bar. Es el error más caro de la noche y el más fácil de evitar: se arregla mirando una línea antes de apretar.",
      },
      {
        titulo: "Toda la mesa o dividida",
        texto:
          "Por defecto se cobra «Mesa completa». Si la mesa se divide, aparecen las sub-cuentas y arriba dice «Elegí una sub-cuenta»: se cobra una por una y el total que falta se ve en «Falta cobrar».",
      },
      {
        titulo: "La propina",
        texto:
          "Se elige por porcentaje o se escribe el monto. «Sin propina» también es una opción válida y no hay que justificarla. La propina no entra en lo que la caja debería tener: es del mozo.",
      },
      {
        titulo: "El descuento: hasta dónde llegás vos",
        texto:
          'Debajo del descuento el sistema te dice «Tu rol permite hasta 25%». Si te pasás, se pone en rojo: «Excede tu autorización · pedile al dueño», y no te deja cobrar. Además el descuento siempre pide motivo — "El descuento requiere un motivo." — y hay una lista para elegir, con «Cortesía de la casa» entre las opciones.',
        aviso: {
          tono: "ojo",
          texto:
            "El tope es del rol, no de la mesa: no se saltea partiendo el descuento en dos cobros. Si hace falta más, se llama al dueño.",
        },
      },
      {
        titulo: "Cobrar",
        texto:
          'Elegís el método, confirmás, y el pago queda registrado en la caja. Cuando no falta nada dice «Mesa cobrada» y «Todos los pagos quedaron registrados. Podés volver al salón.». Si el negocio factura, desde ahí mismo sale el comprobante con «Cobrar / Facturar».',
        aviso: {
          tono: "peligro",
          texto:
            'Si tocaste «Cobrar» y la pantalla se quedó pensando, NO lo toques de nuevo. El sistema te va a decir "El pago ya se estaba registrando. Refrescá para ver el estado." — refrescá y fijate antes de volver a cobrar, o la mesa queda cobrada dos veces.',
        },
      },
      {
        titulo: "Anular un cobro ya hecho",
        texto:
          '«Anular cobro» deshace un cobro mal hecho: pide motivo obligatorio, con ejemplos como «cliente reclamó, pago doble, error de carga». Lo que hace es "Los pagos cobrados se marcan como reembolsados (auditoría) y la mesa vuelve al plano como estaba, con todos sus ítems.". O sea: no borra nada, deja el rastro y te devuelve la mesa para rehacerla.',
        aviso: {
          tono: "peligro",
          texto:
            "Anular un cobro es tuyo o del dueño, nunca del mozo. Y no sirve para corregir un monto: se anula y se vuelve a cobrar bien, para que la caja y la factura cuenten la misma historia.",
        },
      },
      {
        titulo: "Si la cuenta no se puede reabrir",
        texto:
          'Al anular, la mesa vuelve a estar abierta con su consumo. Si mientras tanto alguien abrió otra cuenta en esa mesa, el sistema te frena: "No pudimos reabrir la cuenta: la mesa ya tiene otra cuenta abierta. Anulá esa primero.". Cerrá o anulá esa otra cuenta y volvé a intentar.',
      },
    ],
  },

  // ── 4 · Pedidos online ────────────────────────────────────────────────────
  {
    slug: "pedidos",
    titulo: "Los pedidos que entran por la web",
    resumen:
      "Los que llegan solos: aceptarlos, corregirlos, cobrarlos y avisar para cuándo están.",
    icono: Truck,
    pasos: [
      {
        titulo: "Las cinco columnas",
        texto:
          "Un pedido de la web recorre «Pendientes» → «En cocina» → «Listos» → «En camino» → «Entregados». Se mueve tocando el botón de su tarjeta. Arriba, al lado de «Pedidos online», hay un número: es cuántos hay sin atender. Si tiene número, alguien está esperando.\n\nEn «Pendientes» también esperan los encargues con hora: los reconocés por el cartelito «Programado». No hay que tocarles nada — pasan solos a «En cocina» 40 minutos antes de la hora que le pusiste a cocina. Si es para otro día, además la comanda recién se imprime en ese momento; si es para hoy, el papel ya salió cuando lo cargaste.",
        imagen: "/ayuda/pedidos-columnas.png",
        alt: "Las cinco columnas de pedidos online: Pendientes, En cocina, Listos, En camino y Entregados.",
        marcas: [
          { n: 1, x: 7, y: 47 },
          { n: 2, x: 43.5, y: 9 },
        ],
      },
      {
        titulo: "Confirmar un pedido nuevo",
        texto:
          "Un pedido que entra queda en «Pendientes» hasta que lo mirás. «Confirmar pedido» lo acepta y manda la comanda a cocina. Confirmá recién cuando estés seguro de que se puede hacer: es lo que le avisa al cliente que va en camino.",
      },
      {
        titulo: "Los pedidos para más tarde",
        texto:
          "Un pedido encargado para otro momento aparece en «Pendientes» con el chip «Programado» y se queda al final de la columna. No sale a cocina cuando entra: sale cuando corresponde. Aceptarlo lo deja avalado sin marcharlo.",
      },
      {
        titulo: "El que tenía que salir y sigue ahí",
        texto:
          'Si un programado se pasó de su hora, la tarjeta se pone en rojo con «No marchó» y el texto "Tenía que marchar y sigue acá — revisá que salga la comanda". Es el aviso más importante de la pantalla: alguien está esperando comida que nunca se empezó. «Marchar ya» lo manda a cocina en el momento.',
        aviso: {
          tono: "peligro",
          texto:
            "«No marchó» casi siempre significa que la comanda no llegó a la cocina. Antes de marcharlo de nuevo, fijate en Comandas si la impresión falló — si no, la cocina va a recibir dos.",
        },
        verTambien: { tema: "carteles", texto: "Qué hacer si una comanda no se imprimió" },
      },
      {
        titulo: "Corregir un pedido antes de cobrarlo",
        texto:
          "Tocando la tarjeta se abre el detalle y ahí se edita: sacar algo que no hay, cambiar cantidades, sumar lo que el cliente pidió por teléfono. También podés dejar una «Nota para cocina (sale en la comanda)». Un pedido ya pagado no se edita: se anula y se rehace.",
      },
      {
        titulo: "Cobrarlo",
        texto:
          "Los que pagaron online ya vienen cobrados. Los que pagan al recibir dicen «Efectivo · A cobrar», y desde el detalle se registra el pago con «Cobrar / Facturar», que lo asienta en la caja igual que una mesa.",
        verTambien: { tema: "caja", texto: "Dónde aparece eso en el cierre" },
      },
      {
        titulo: "Cancelar un pedido",
        texto:
          '«Cancelar pedido» pide un «Motivo de cancelación» y sugiere ejemplos: «Sin stock, zona fuera de cobertura, etc.». El cliente lo ve: el motivo que escribas aparece en el seguimiento del pedido, así que escribilo pensando en que lo lee él.',
      },
      {
        titulo: "Cargar un pedido a mano",
        texto:
          "El que llama por teléfono se carga con «Cargar pedido», arriba de todo en «Pendientes». Entra al mismo circuito que los de la web y se cobra igual.",
      },
    ],
  },

  // ── 5 · Reservas ──────────────────────────────────────────────────────────
  //
  // D12: los dos modos. NO se escribe un texto común con condicionales: el
  // encargado ve el suyo y nada más. Lo que se repite entre los dos —confirmar,
  // sentar, no vino— se repite escrito, que sale más barato que un "si tu local
  // usa reservas flexibles, saltá al paso 6".
  {
    slug: "reservas",
    titulo: "Tomar, confirmar y rechazar una reserva",
    resumen:
      "El libro del día, las que pide el cliente por la web y qué hacer cuando no hay lugar.",
    icono: CalendarDays,
    pasos: [],
    pasosPorModo: {
      estricto: [
        {
          titulo: "El día, hora por hora",
          texto:
            "La pantalla abre en el día de hoy y lista las reservas por hora con su estado. Arriba se cambia de fecha y se busca por nombre o teléfono. Si no hay nada, dice «No hay reservas para esta fecha.».",
        },
        {
          titulo: "Tomar una reserva por teléfono",
          texto:
            "«Nueva reserva» pide nombre, teléfono, cuántos son y el horario. Los horarios salen de una grilla fija: elegís uno de los que el local tiene habilitados, no escribís la hora a mano. Si el que te piden no está en la lista, es porque no hay turno ahí.",
        },
        {
          titulo: "Cuando no hay lugar",
          texto:
            'Si te dice "Ese horario ya no está disponible." o "Ya no quedan mesas disponibles para ese horario.", el turno está lleno. Ofrecé otro horario de la grilla: forzarlo desde acá no se puede, y está bien que no se pueda — en este modo el cupo es el cupo.',
        },
        {
          titulo: "Las que pide el cliente por la web",
          texto:
            "Las que entran solas quedan esperando tu respuesta y la fecha se marca con «Tiene solicitudes sin responder». Cada una tiene «Confirmar» y «Rechazar». Hasta que decidas, el cliente sabe que la pediste, no que la tiene.",
          aviso: {
            tono: "ojo",
            texto:
              "Una solicitud sin responder vence sola y el cliente recibe el aviso de que no se pudo. Miralas al empezar el turno, no al final.",
          },
        },
        {
          titulo: "Rechazar bien",
          texto:
            'Al rechazar te pregunta «¿Rechazar la reserva?» y te deja escribir por qué, con un ejemplo: «Ej: esa noche tenemos un evento privado». Ese texto le llega al cliente. Una línea amable acá vale más que la reserva que no pudiste darle.',
        },
        {
          titulo: "Ajustar antes de decidir",
          texto:
            "Si la querés tomar pero con otra hora, otra mesa o menos gente, editala primero y decidí después: editar no confirma nada. Así el cliente recibe un solo aviso, con los datos que quedaron de verdad.",
        },
        {
          titulo: "Cuando llega",
          texto:
            "«Sentar la reserva» la pasa a «En mesa». Si todavía no tiene mesa, elegila en el plano. Una reserva sin confirmar no se sienta: primero se confirma.",
          verTambien: { tema: "mesas", texto: "Qué pasa con la mesa cuando la sentás" },
        },
        {
          titulo: "El que no vino",
          texto:
            "«No vino» la marca como ausente después de preguntarte «¿Marcar como no vino?». Marcalo de verdad: es lo único que después deja ver quién falta seguido y decidir si a ese teléfono se le pide seña.",
        },
      ],
      flexible: [
        {
          titulo: "El libro del día, por servicio",
          texto:
            "La pantalla abre en el día de hoy, con las reservas ordenadas por hora dentro de cada servicio — mediodía, cena, el que tenga el local. Arriba se cambia de fecha y se busca por nombre o teléfono.",
        },
        {
          titulo: "Tomar una reserva por teléfono",
          texto:
            "«Nueva reserva» pide nombre, teléfono, cuántos son, el servicio y la hora. Acá la hora se escribe: no hay grilla de turnos. La mesa es opcional — se puede tomar ahora y asignar la mesa después, cuando armes el salón.",
        },
        {
          titulo: "El cupo es blando para vos y duro para el cliente",
          texto:
            'Cuando el servicio está lleno, al cliente que reserva por la web el sistema lo frena: "Ese servicio ya está completo. Probá otro horario, otra fecha u otro salón.". A vos no: te dice "No quedan mesas libres en ese servicio. Confirmá para reservar igual." y te deja pasar. La diferencia es a propósito — vos sabés que a las 22:30 se libera la que entró a las 20:00, y la web no.',
          aviso: {
            tono: "ojo",
            texto:
              "Que puedas sobrevender no quiere decir que convenga. El cartel es para el caso que conocés, no para llenar el libro y ver qué pasa.",
          },
        },
        {
          titulo: "Las que pide el cliente por la web",
          texto:
            "Las que entran solas quedan esperando tu respuesta y la fecha se marca con «Tiene solicitudes sin responder». Cada una tiene «Confirmar» y «Rechazar». Hasta que decidas, el cliente sabe que la pidió, no que la tiene.",
          aviso: {
            tono: "ojo",
            texto:
              "Una solicitud sin responder vence sola y el cliente recibe el aviso de que no se pudo. Miralas al empezar el turno, no al final.",
          },
        },
        {
          titulo: "Rechazar bien",
          texto:
            'Al rechazar te pregunta «¿Rechazar la reserva?» y te deja escribir por qué, con un ejemplo: «Ej: esa noche tenemos un evento privado». Ese texto le llega al cliente. Una línea amable acá vale más que la reserva que no pudiste darle.',
        },
        {
          titulo: "Ajustar antes de decidir",
          texto:
            "Si la querés tomar pero con otra hora, otra mesa o menos gente, editala primero y decidí después: editar no confirma nada. Así el cliente recibe un solo aviso, con los datos que quedaron de verdad. La fecha no se cambia: si el cliente quiere otro día, es otra reserva.",
        },
        {
          titulo: "Cuando llega",
          texto:
            "«Sentar la reserva» la pasa a «En mesa». Si todavía no tiene mesa asignada —que en este modo es lo normal—, elegila en el plano en ese momento. Una reserva sin confirmar no se sienta: primero se confirma.",
          verTambien: { tema: "mesas", texto: "Qué pasa con la mesa cuando la sentás" },
        },
        {
          titulo: "El que no vino",
          texto:
            "«No vino» la marca como ausente después de preguntarte «¿Marcar como no vino?». Marcalo de verdad: es lo único que después deja ver quién falta seguido y decidir si a ese teléfono se le pide seña.",
        },
      ],
    },
  },

  // ── 6 · Carteles ──────────────────────────────────────────────────────────
  //
  // CATÁLOGO: no se numera (ver TipoTema). Cada entrada arranca con la frase
  // LITERAL que el panel pinta, para que se pueda encontrar con Cmd+F desde la
  // pantalla. Si cambiás un mensaje en el código, cambialo acá.
  {
    slug: "carteles",
    titulo: "Me apareció un cartel: qué significa cada uno",
    resumen:
      "La lista de los avisos que puede tirar el panel, con lo que hay que hacer en cada caso.",
    icono: TriangleAlert,
    tipo: "catalogo",
    pasos: [
      {
        titulo: '"La diferencia excede tu autorización. Pedile al admin que cierre la caja."',
        texto:
          "Contaste el cajón y falta o sobra más de $5.000. Es el techo de lo que podés cerrar solo. No cambies el número contado para que entre: llamá al dueño, que él sí puede cerrarla, y dejá escrito en las notas qué pasó.",
        aviso: {
          tono: "peligro",
          texto: "Cambiar el conteo para esquivar este cartel convierte un faltante explicable en un faltante escondido.",
        },
      },
      {
        titulo: '"Hay diferencia con el efectivo esperado. Tenés que registrar el motivo en las notas."',
        texto:
          "La diferencia está dentro de lo tuyo, pero no cierra sin explicación. Escribí en las notas qué creés que pasó — vuelto mal dado, un cobro cargado en la caja equivocada, un billete falso. Con eso el cierre sigue.",
      },
      {
        titulo: '"Falta 1 rendición para poder cerrar."',
        texto:
          "Un mozo cobró en efectivo y todavía no entregó esa plata. Buscalo y rendí desde «Rendición por empleado». Si se fue sin rendir, el cierre te deja registrarlo igual eligiendo qué pasó — «No entregó», «Entrega de menos», «Entrega de más» — y queda como deuda a la vista.",
        verTambien: { tema: "caja", texto: "El cierre de caja, paso a paso" },
      },
      {
        titulo: '"Hay una mesa con la cuenta abierta"',
        texto:
          "No se puede cerrar la caja con consumo sin cobrar. Andá al salón, cobrá esa mesa o anulala si el cliente se fue, y volvé al cierre.",
      },
      {
        titulo: '"Queda 1 pedido de delivery / take away abierto"',
        texto:
          "Lo mismo que la mesa, pero del lado de los pedidos de la web: hay uno sin cerrar. Entregalo, cobralo o cancelalo, y después cerrá.",
      },
      {
        titulo: '"Se abrió una cuenta mientras cerrabas. Revisá el salón y volvé a intentar."',
        texto:
          "Alguien abrió una mesa justo mientras contabas. El cierre se frena para no dejar esa venta afuera del turno. Mirá el salón, resolvé esa mesa y volvé a cerrar: no perdiste el conteo.",
      },
      {
        titulo: '"Un mozo cobró mientras cerrabas y le quedó plata sin rendir. Actualizá y volvé a intentar."',
        texto:
          "Entró un cobro en efectivo después de que abriste el cierre. Actualizá, rendí esa plata y cerrá de nuevo.",
      },
      {
        titulo: '"La sangría requiere un motivo."',
        texto:
          "Estás sacando plata de la caja sin decir para qué. Escribí el motivo — «pago proveedor», «depósito banco» — con suficiente detalle como para entenderlo dentro de un mes.",
      },
      {
        titulo: '"Tu rol permite hasta 25%" / "Excede tu autorización · pedile al dueño"',
        texto:
          "El descuento que pusiste se pasa de lo que podés autorizar. Bajalo hasta el tope o pedile al dueño que lo haga él. Partirlo en dos cobros no cuenta como solución.",
        verTambien: { tema: "cobrar", texto: "Descuentos, con el tope explicado" },
      },
      {
        titulo: '"El descuento requiere un motivo."',
        texto:
          "Todo descuento tiene que decir por qué. Elegí uno de la lista —«Cortesía de la casa» y las demás— o escribilo. Sin motivo el cobro no avanza.",
      },
      {
        titulo: '"El pago ya se estaba registrando. Refrescá para ver el estado."',
        texto:
          "Tocaste «Cobrar» dos veces, o la primera tardó y parecía colgada. El sistema frenó el segundo cobro a propósito. Refrescá y fijate cómo quedó la mesa ANTES de volver a cobrar.",
        aviso: {
          tono: "peligro",
          texto: "Es el cartel que evita cobrarle dos veces al cliente. Si aparece, refrescá y mirá — nunca insistas.",
        },
      },
      {
        titulo: '"No pudimos reabrir la cuenta: la mesa ya tiene otra cuenta abierta. Anulá esa primero."',
        texto:
          "Anulaste un cobro, pero mientras tanto se abrió una cuenta nueva en esa misma mesa. Resolvé la nueva —cobrala o anulala— y recién ahí se puede recuperar la vieja.",
      },
      {
        titulo: '"El motivo de anulación es obligatorio."',
        texto:
          "Estás anulando una mesa sin decir por qué. Escribí qué pasó: «cliente se fue», «error de carga». Es lo que después explica por qué esa venta no está.",
      },
      {
        titulo: '"La mesa está ocupada. Cobrala o liberala antes de mover."',
        texto:
          "Querés trasladar una cuenta a una mesa que ya tiene gente. Elegí una libre, o resolvé primero la del destino.",
      },
      {
        titulo: '"La mesa cambió mientras la movías. Refrescá e intentá de nuevo."',
        texto:
          "Alguien tocó esa mesa al mismo tiempo que vos. No se perdió nada: refrescá y volvé a hacer el traslado.",
      },
      {
        titulo: '"Tenía que marchar y sigue acá — revisá que salga la comanda"',
        texto:
          "Un pedido programado se pasó de su hora y nunca salió a cocina. Antes de tocar «Marchar ya», fijate en Comandas si la comanda falló: si la cocina ya la tiene en papel, marcharlo otra vez le manda una copia.",
        verTambien: { tema: "pedidos", texto: "Los pedidos de la web, paso a paso" },
      },
      {
        titulo: '"1 comanda no se imprimió"',
        texto:
          "La comanda no llegó a la impresora del sector. Con «Ver solo las fallidas» las ves todas juntas y desde ahí se reimprimen. Mientras no se resuelva, la cocina no sabe que ese plato existe: avisá a mano si hay apuro.",
      },
      {
        titulo: '"sin conexión"',
        texto:
          "El agente de impresión del local dejó de responder — la PC que conecta el sistema con las impresoras está apagada, dormida o sin red. Ningún ticket va a salir hasta que vuelva. Prendé esa máquina; si vuelve, las comandas pendientes salen solas.",
        aviso: {
          tono: "peligro",
          texto: "Con este cartel prendido, todo lo que se cargue sigue funcionando pero no imprime nada. Es lo primero que hay que mirar cuando «no salen las comandas».",
        },
      },
      {
        titulo: '"No hay sectores configurados. Cargá los sectores desde el catálogo para que las comandas se ruteen a cocina."',
        texto:
          "El sistema no sabe a qué impresora mandar cada cosa porque no hay sectores cargados. Es configuración del dueño, no se arregla desde acá.",
      },
      {
        titulo: '"Ese servicio ya está completo. Probá otro horario, otra fecha u otro salón."',
        texto:
          "Es el cartel que ve el CLIENTE en la web cuando el servicio está lleno. A vos, desde el panel, el sistema te deja pasar igual avisándote que no quedan mesas.",
        verTambien: { tema: "reservas", texto: "El cupo, explicado" },
      },
      {
        titulo: '"No quedan mesas libres en ese servicio. Confirmá para reservar igual."',
        texto:
          "Estás tomando una reserva sobre un servicio lleno. El sistema no te lo prohíbe: te pide que confirmes que sabés lo que hacés. Tomala sólo si tenés el lugar contado de verdad.",
      },
      {
        titulo: '"Confirmá la reserva antes de sentarla."',
        texto:
          "Estás por sentar a alguien cuya reserva todavía está esperando respuesta. Confirmala primero — con eso el cliente recibe el aviso — y después sentala.",
      },
      {
        titulo: '"Sólo el encargado puede confirmar o rechazar reservas."',
        texto:
          "Le apareció a alguien que no tiene el permiso. Confirmar y rechazar son tuyos o del dueño: el mozo no decide reservas.",
      },
      {
        titulo: '"No hay caja configurada. Pedile al admin que cree una."',
        texto:
          "No se puede cobrar porque el negocio no tiene ninguna caja creada. Es configuración del dueño y sin eso no hay cobro posible.",
      },
      {
        titulo: '"Pago registrado. Faltaba el CUIT para la Factura A — emitila desde Facturación."',
        texto:
          "El cobro entró bien, pero la factura A no salió porque falta el CUIT del cliente. Pedile el CUIT y emitila desde la sección Facturación: el pago ya está, lo que falta es el papel.",
      },
    ],
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

export function temaPorSlug(slug: string): Tema | undefined {
  return TEMAS.find((t) => t.slug === slug);
}

/** ¿Tiene contenido escrito para este negocio? Ver RNF-2. */
export function estaEscrito(tema: Tema, modo: ReservationMode): boolean {
  return pasosDe(tema, modo).length > 0;
}

/** El próximo tema ESCRITO, para el link del pie. Saltea los que están vacíos:
 *  mandar a alguien a una página que dice "en preparación" es peor que no
 *  ofrecerle nada. */
export function temaSiguiente(
  slug: string,
  modo: ReservationMode,
): Tema | undefined {
  const i = TEMAS.findIndex((t) => t.slug === slug);
  return i >= 0 ? TEMAS.slice(i + 1).find((t) => estaEscrito(t, modo)) : undefined;
}
