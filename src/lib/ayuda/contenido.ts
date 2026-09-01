import {
  Wallet,
  LayoutGrid,
  Receipt,
  ChefHat,
  Truck,
  CalendarDays,
  HandCoins,
  Clock,
  Package,
  Table2,
  Building2,
  FileText,
  Users,
  Tag,
  MessagesSquare,
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

/**
 * Los cuatro bloques del índice. Con seis temas alcanzaba una lista; con
 * dieciséis, no: una tira de tarjetas todas iguales obliga a leerlas todas para
 * encontrar una. El orden es el de la distancia al turno — primero lo que se
 * hace hoy, último lo que se abre cuando algo se rompió.
 */
export type Grupo = "turno" | "local" | "clientes" | "problemas";

export const GRUPOS: { id: Grupo; titulo: string; bajada: string }[] = [
  { id: "turno", titulo: "Tu turno", bajada: "Lo que hacés todos los días, de la apertura al cierre." },
  { id: "local", titulo: "El local", bajada: "La carta, el stock, los salones y los papeles. Se tocan cada tanto." },
  { id: "clientes", titulo: "Los clientes", bajada: "Quiénes son, cómo se les habla y cómo se los trae de vuelta." },
  { id: "problemas", titulo: "Si algo falla", bajada: "Los carteles del sistema, uno por uno." },
];

export type Tema = {
  slug: string;
  titulo: string;
  resumen: string;
  icono: LucideIcon;
  grupo: Grupo;
  /**
   * Lo que hay que llevarse aunque no se lea el resto: dos o tres líneas, arriba
   * de todo y destacadas.
   *
   * No es un resumen de los pasos. Es la respuesta a «si esta persona sólo lee
   * cinco segundos, ¿qué le tiene que quedar?» — casi siempre el límite de lo
   * que puede hacer sola, o la cosa que si se hace mal cuesta plata.
   */
  claves: string[];
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
  // ══ Tu turno ═════════════════════════════════════════════════════════════
  {
    slug: "caja",
    titulo: "La caja: movimientos y cierre",
    resumen: "Lo que entra y sale del cajón, y cómo se cierra el turno cuando el conteo no da.",
    icono: Wallet,
    grupo: "turno",
    claves: [
      "Podés cerrar con una diferencia de hasta $5.000. Más que eso lo cierra el dueño.",
      "Toda diferencia pide motivo escrito. No lo maquilles: es lo que después la explica.",
      "Las propinas no están en «En la caja deberías tener». Son del mozo, no del local.",
    ],
    pasos: [
      {
        titulo: "Elegí tu caja y mirá los dos números",
        texto:
          'Arriba están las cajas del local; tocá la que tenés adelante y el sistema se la acuerda. «En la caja deberías tener» es la plata que tendría que haber en el cajón ahora. «Cobrado en el período» es la venta del turno con todos los métodos juntos: es otra cosa y casi nunca coincide.',
        imagen: "/ayuda/caja-periodo.png",
        alt: "La pantalla de Caja, con «En la caja deberías tener» a la izquierda y «Cobrado en el período» a la derecha.",
        // % del ancho y del alto de la captura (1160 × 860): van sobre el
        // rótulo y no sobre el número, que el círculo tapaba los dígitos.
        marcas: [
          { n: 1, x: 9.5, y: 27.5 },
          { n: 2, x: 56, y: 27.5 },
        ],
      },
      {
        titulo: "Sacar y meter plata",
        texto:
          '«Sangría» saca efectivo —depósito, pago a proveedor— y pide motivo obligatorio: "La sangría requiere un motivo.". «Ingreso» es al revés, para el cambio que se repone. Escribí motivos que se entiendan dentro de un mes: «pago proveedor verdulería», no «varios».',
      },
      {
        titulo: "Antes de cerrar, que los mozos rindan",
        texto:
          'Un mozo que cobró en efectivo tiene esa plata encima hasta que la entrega. Si falta alguno, el cierre te frena con "Falta 1 rendición para poder cerrar.".',
        verTambien: { tema: "rendicion", texto: "Cómo se toma una rendición" },
      },
      {
        titulo: "Contá, explicá la diferencia y decidí si retirás",
        texto:
          'En «Cerrar caja» escribís lo contado —hay un contador por billete si te sirve— y aparece «Te falta» o «Te sobra». Con diferencia, el sistema pide el motivo en las notas. Después, la casilla «Retirar todo el efectivo»: tildada la caja arranca en $0; sin tildar "La caja queda con lo contado — es el arqueo de mitad de turno.".',
        aviso: {
          tono: "peligro",
          texto:
            'Arriba de $5.000 de diferencia el sistema te frena: "La diferencia excede tu autorización. Pedile al admin que cierre la caja.". No cambies el conteo para que entre — convertís un faltante explicable en uno escondido.',
        },
      },
    ],
  },
  {
    slug: "mesas",
    titulo: "El salón",
    resumen: "Abrir, cobrar, anular y mover mesas, incluido lo que el mozo no puede hacer solo.",
    icono: LayoutGrid,
    grupo: "turno",
    claves: [
      "Anular una mesa y anular un cobro son cosas distintas: si ya se cobró, se anula el cobro.",
      "Anular, trasladar y repartir el salón son tuyos o del dueño. El mozo no puede.",
      "Toda anulación pide motivo. Es lo que explica por qué esa venta no está.",
    ],
    pasos: [
      {
        titulo: "El plano es el salón",
        texto:
          "Cada figura es una mesa y el color dice cómo está. Abajo está la referencia con cuántas hay de cada una; el número chico adentro es hace cuánto está abierta, que sirve para ver cuál se demora. A la derecha, lo mismo en lista.",
        imagen: "/ayuda/salon-plano.png",
        alt: "El plano del salón con las mesas, la referencia de colores abajo y el panel de ocupadas a la derecha.",
        marcas: [
          { n: 1, x: 37, y: 23 },
          { n: 2, x: 8, y: 97 },
          { n: 3, x: 72, y: 58 },
        ],
      },
      {
        titulo: "Abrir, cargar y pasar a cobro",
        texto:
          "Tocás una mesa libre, le cargás el pedido y queda abierta; se puede seguir agregando todas las veces que haga falta. Cuando piden la cuenta la mesa se marca en el plano y «Pasar a cobro» abre el cobro con todo lo consumido.",
        verTambien: { tema: "cobrar", texto: "Cómo se cobra una cuenta" },
      },
      {
        titulo: "Si la mesa tenía una reserva",
        texto:
          "Al abrir una mesa reservada el sistema te avisa antes y podés «Abrir igual» o buscar otra. Para sentar a alguien de una reserva, primero hay que confirmarla.",
        verTambien: { tema: "reservas", texto: "Confirmar una reserva" },
      },
      {
        titulo: "Mover: de mozo o de mesa",
        texto:
          '«Transferir mozo» pasa la mesa a otro. «Trasladar mesa» mueve el consumo a otra mesa, que tiene que estar libre — si no, "La mesa está ocupada. Cobrala o liberala antes de mover.". El modo «Distribuir mozos» reparte varias mesas de una antes del servicio.',
      },
      {
        titulo: "Anular una mesa",
        texto:
          'Cancela la orden activa y libera la mesa: es para el cliente que se fue sin consumir o el error de carga. Pide motivo obligatorio, con ejemplos como «cliente se fue, error de carga».',
        aviso: {
          tono: "peligro",
          texto:
            "Anular borra esa venta del turno y sólo lo podés hacer vos o el dueño. Si la mesa YA se cobró, esto no es lo que buscás: se anula el cobro, que deja el rastro del reembolso.",
        },
      },
    ],
  },
  {
    slug: "cobrar",
    titulo: "Cobrar una cuenta",
    resumen: "Propina, descuento, hasta dónde llegás vos, y cómo se deshace un cobro mal hecho.",
    icono: Receipt,
    grupo: "turno",
    claves: [
      "Tu tope de descuento es 25%. Partirlo en dos cobros no lo saltea.",
      "Si «Cobrar» se queda pensando, NO lo toques de nuevo: refrescá y mirá cómo quedó.",
      "Mirá en qué caja va a quedar el cobro antes de confirmar. Es el error más fácil de evitar.",
    ],
    pasos: [
      {
        titulo: "Abrí el cobro y mirá la caja",
        texto:
          "Desde la mesa, «Cobrar mesa» o «Pasar a cobro»: se abre al costado sin salir del salón. Arriba del pago dice «Caja para registrar el cobro» — si estás en el bar, que diga la del bar, porque ahí es donde va a aparecer al cierre.",
      },
      {
        titulo: "Toda la mesa o dividida",
        texto:
          "Por defecto se cobra «Mesa completa». Si se divide, aparecen las sub-cuentas: se cobra una por una y lo que queda se ve en «Falta cobrar».",
      },
      {
        titulo: "Propina y descuento",
        texto:
          'La propina se elige por porcentaje o monto, y «Sin propina» es una opción válida. En el descuento el sistema te dice «Tu rol permite hasta 25%»; si te pasás se pone en rojo con «Excede tu autorización · pedile al dueño» y no te deja cobrar. El descuento siempre pide motivo, con «Cortesía de la casa» entre las opciones.',
      },
      {
        titulo: "Cobrar",
        texto:
          'Elegís método, confirmás, y el pago queda asentado en la caja. Cuando no falta nada dice «Mesa cobrada». Si el negocio factura, el comprobante sale desde ahí mismo.',
        aviso: {
          tono: "peligro",
          texto:
            'Si tocaste «Cobrar» y no pasó nada, no insistas: te va a decir "El pago ya se estaba registrando. Refrescá para ver el estado.". Refrescá y fijate ANTES de volver a cobrar, o la mesa queda cobrada dos veces.',
        },
      },
      {
        titulo: "Anular un cobro",
        texto:
          'Pide motivo obligatorio y lo que hace es "Los pagos cobrados se marcan como reembolsados (auditoría) y la mesa vuelve al plano como estaba, con todos sus ítems.". No borra nada: deja rastro y te devuelve la mesa. No sirve para corregir un monto — se anula y se cobra bien.',
        verTambien: { tema: "facturacion", texto: "Y si ya se había facturado" },
      },
    ],
  },
  {
    slug: "comandas",
    titulo: "La cocina y las comanderas",
    resumen: "Qué está saliendo, qué se demora, y qué hacer cuando una comanda no se imprime.",
    icono: ChefHat,
    grupo: "turno",
    claves: [
      '"1 comanda no se imprimió" quiere decir que la cocina NO se enteró de ese plato.',
      '"sin conexión" es la PC de las impresoras caída: no sale ni un ticket hasta que vuelva.',
      "Editar una comanda reimprime el ticket corregido. Avisale a la cocina igual.",
    ],
    pasos: [
      {
        titulo: "Las tres columnas",
        texto:
          "«Pendientes» son las que la cocina todavía no tomó, «En cocina» las que está haciendo, «Entregadas» las que salieron. Arriba, «Saturación por sector» te dice qué estación está tapada — parrilla, fritera, la que sea.",
      },
      {
        titulo: "La que no se imprimió",
        texto:
          'Cuando una comanda falla aparece el aviso "1 comanda no se imprimió" y con «Ver solo las fallidas» las ves todas juntas para reimprimirlas. Mientras no se resuelva, para la cocina ese plato no existe.',
        aviso: {
          tono: "peligro",
          texto:
            "Antes de reimprimir, chequeá si el papel ya salió. Reimprimir a ciegas hace que se cocine dos veces.",
        },
      },
      {
        titulo: 'El cartel "sin conexión"',
        texto:
          "Es la PC del local que conecta el sistema con las impresoras: apagada, dormida o sin red. Todo lo que cargues sigue funcionando pero no imprime nada. Es lo primero que hay que mirar cuando «no salen las comandas»: prendé esa máquina y las pendientes salen solas.",
      },
      {
        titulo: "Editar o anular una comanda",
        texto:
          'Desde las opciones de la comanda se corrige lo que salió mal y con «Guardar y reimprimir» sale el ticket corregido — "Comanda actualizada · se reimprime el ticket corregido.". Si la corrección es urgente, decíselo a la cocina de palabra: el papel nuevo puede llegar después de que empezaron.',
      },
    ],
  },
  {
    slug: "pedidos",
    titulo: "Los pedidos de la web",
    resumen: "Delivery y take away: aceptarlos, corregirlos, cobrarlos y avisar para cuándo están.",
    icono: Truck,
    grupo: "turno",
    claves: [
      '«No marchó» en rojo = alguien espera comida que nunca se empezó. Es lo más urgente de la pantalla.',
      "El motivo de cancelación lo lee el cliente en el seguimiento de su pedido.",
      "Un pedido ya pagado no se edita: se anula y se rehace.",
    ],
    pasos: [
      {
        titulo: "Las cinco columnas",
        texto:
          "Un pedido recorre «Nuevos» → «Preparando» → «Listos» → «En camino» → «Entregados», y se mueve con el botón de su tarjeta. El número al lado de «Pedidos online» es cuántos hay sin atender: si tiene número, alguien está esperando.",
        imagen: "/ayuda/pedidos-columnas.png",
        alt: "Las cinco columnas de pedidos online: Nuevos, Preparando, Listos, En camino y Entregados.",
        marcas: [
          { n: 1, x: 7, y: 47 },
          { n: 2, x: 43.5, y: 9 },
        ],
      },
      {
        titulo: "Confirmar, y los que son para más tarde",
        texto:
          "«Confirmar pedido» lo acepta y manda la comanda a cocina — confirmá cuando estés seguro de que se puede hacer. Los encargados para otro momento quedan en «Nuevos» con el chip «Programado» y no salen a cocina hasta que corresponde.",
      },
      {
        titulo: "El que tenía que salir y sigue ahí",
        texto:
          'Si un programado se pasó de hora, la tarjeta se pone en rojo con «No marchó»: "Tenía que marchar y sigue acá — revisá que salga la comanda". «Marchar ya» lo manda a cocina en el momento.',
        aviso: {
          tono: "peligro",
          texto:
            "Casi siempre es que la comanda no llegó. Fijate en Comandas si la impresión falló antes de marcharlo de nuevo, o la cocina recibe dos.",
        },
        verTambien: { tema: "comandas", texto: "Las comandas que no se imprimieron" },
      },
      {
        titulo: "Corregir, cobrar, cancelar",
        texto:
          'Tocando la tarjeta se abre el detalle: ahí se saca lo que no hay, se cambian cantidades y se deja «Nota para cocina (sale en la comanda)». Los que pagan al recibir dicen «Efectivo · A cobrar» y se cobran desde ahí. Cancelar pide un motivo con ejemplos como «Sin stock, zona fuera de cobertura».',
      },
    ],
  },
  {
    slug: "reservas",
    titulo: "Reservas",
    resumen: "El libro del día, las que pide el cliente por la web, y qué hacer cuando no hay lugar.",
    icono: CalendarDays,
    grupo: "turno",
    claves: [
      "Una solicitud sin responder vence sola y el cliente recibe que no se pudo. Miralas al empezar el turno.",
      "El motivo del rechazo se lo mandamos al cliente: escribilo pensando en que lo lee él.",
      "Editar no confirma. Ajustá primero y decidí después, así el cliente recibe un solo aviso.",
    ],
    pasos: [],
    pasosPorModo: {
      estricto: [
        {
          titulo: "El día, hora por hora",
          texto:
            "La pantalla abre en hoy y lista las reservas por hora con su estado. Arriba se cambia de fecha y se busca por nombre o teléfono.",
        },
        {
          titulo: "Tomar una por teléfono",
          texto:
            'Pide nombre, teléfono, cuántos son y el horario, que sale de una grilla fija: elegís uno de los habilitados, no escribís la hora a mano. Si el que te piden no está, no hay turno ahí — y forzarlo desde acá no se puede. Está bien que no se pueda: en este modo el cupo es el cupo.',
        },
        {
          titulo: "Las que pide el cliente por la web",
          texto:
            'Quedan esperando tu respuesta y la fecha se marca con «Tiene solicitudes sin responder». Cada una tiene «Confirmar» y «Rechazar»; al rechazar podés escribir por qué, con un ejemplo: «Ej: esa noche tenemos un evento privado». Hasta que decidas, el cliente sabe que la pidió, no que la tiene.',
        },
        {
          titulo: "Cuando llega, y el que no vino",
          texto:
            "«Sentar la reserva» la pasa a «En mesa» — si no tiene mesa, la elegís en el plano. «No vino» la marca como ausente. Marcalo de verdad: es lo único que después deja ver quién falta seguido.",
          verTambien: { tema: "mesas", texto: "Qué pasa con la mesa cuando la sentás" },
        },
      ],
      flexible: [
        {
          titulo: "El libro del día, por servicio",
          texto:
            "La pantalla abre en hoy, con las reservas por hora dentro de cada servicio — mediodía, cena, el que tenga el local. Arriba se cambia de fecha y se busca por nombre o teléfono.",
        },
        {
          titulo: "Tomar una por teléfono",
          texto:
            "Pide nombre, teléfono, cuántos son, el servicio y la hora. Acá la hora se escribe: no hay grilla de turnos. La mesa es opcional — se puede tomar ahora y asignarla después, cuando armes el salón.",
        },
        {
          titulo: "El cupo es blando para vos y duro para el cliente",
          texto:
            'Con el servicio lleno, al que reserva por la web el sistema lo frena. A vos no: te dice "No quedan mesas libres en ese servicio. Confirmá para reservar igual." y te deja pasar. La diferencia es a propósito — vos sabés que a las 22:30 se libera la que entró a las 20:00, y la web no.',
          aviso: {
            tono: "ojo",
            texto: "Que puedas sobrevender no quiere decir que convenga. El cartel es para el caso que conocés, no para llenar el libro y ver qué pasa.",
          },
        },
        {
          titulo: "Las que pide el cliente por la web",
          texto:
            'Quedan esperando tu respuesta y la fecha se marca con «Tiene solicitudes sin responder». Cada una tiene «Confirmar» y «Rechazar»; al rechazar podés escribir por qué, con un ejemplo: «Ej: esa noche tenemos un evento privado». Hasta que decidas, el cliente sabe que la pidió, no que la tiene.',
        },
        {
          titulo: "Cuando llega, y el que no vino",
          texto:
            "«Sentar la reserva» la pasa a «En mesa»; como en este modo la mesa suele estar sin asignar, la elegís en el plano en ese momento. «No vino» la marca como ausente — marcalo de verdad, es lo único que después deja ver quién falta seguido.",
          verTambien: { tema: "mesas", texto: "Qué pasa con la mesa cuando la sentás" },
        },
      ],
    },
  },
  {
    slug: "rendicion",
    titulo: "La rendición de los mozos",
    resumen: "La plata que los mozos tienen encima y cómo pasa al cajón antes de cerrar.",
    icono: HandCoins,
    grupo: "turno",
    claves: [
      "Rendir no cambia el total del turno: pasa la plata de la columna del mozo a la del cajón.",
      "Sin todas las rendiciones, la caja no cierra.",
      "El que no entrega queda registrado como deuda, a la vista en el cierre y avisada al dueño.",
    ],
    pasos: [
      {
        titulo: "Quién debe cuánto",
        texto:
          'La pantalla lista los mozos con pagos pendientes del turno y, en cada uno, «Efectivo que debería entregar» con el detalle por método. Si no hay nadie, dice "No hay mozos/encargados con pagos pendientes de rendir.".',
      },
      {
        titulo: "Tomar la entrega",
        texto:
          "Escribís en «Efectivo que entrega» lo que te dio y confirmás. Si coincide, listo. Esa plata deja de estar a nombre del mozo y pasa al cajón.",
      },
      {
        titulo: "Cuando no coincide",
        texto:
          'Si entrega de menos o de más, el sistema pide «¿Qué pasó?» con ejemplos como «Ej: le di cambio de más, billete falso…». Y si se fue sin rendir, está «Marcar como no entregó», que también pide el porqué.',
        aviso: {
          tono: "ojo",
          texto:
            "Lo que escribas queda a la vista en el cierre y se le avisa al dueño. Es información, no castigo: un mozo al que le pasa una vez es un mal día, uno al que le pasa siempre es otra conversación.",
        },
        verTambien: { tema: "caja", texto: "El cierre de caja" },
      },
    ],
  },
  {
    slug: "fichaje",
    titulo: "Fichaje y asistencia",
    resumen: "Quién entró, quién salió y quién no fichó todavía.",
    icono: Clock,
    grupo: "turno",
    claves: [
      "Cada uno ficha con su PIN: no fiches por otro.",
      '"Sin fichar" a mitad del turno suele ser un olvido, no una ausencia. Preguntá.',
    ],
    pasos: [
      {
        titulo: "La asistencia del día",
        texto:
          '«Asistencia del día» muestra quién está adentro ahora, «Ya salieron» los que terminaron y «Sin fichar» los que todavía no marcaron. Si nadie fichó, dice "No hay nadie fichado todavía.".',
      },
      {
        titulo: "Cómo se ficha",
        texto:
          "Con el PIN de cada uno en el teclado numérico. Es de la persona: sirve para las horas trabajadas y para saber quién estaba cuando pasó algo.",
      },
    ],
  },

  // ══ El local ═════════════════════════════════════════════════════════════
  {
    slug: "catalogo",
    titulo: "La carta y el stock",
    resumen: "Productos, categorías, el stock del bar y de la cocina, y el menú del día.",
    icono: Package,
    grupo: "local",
    claves: [
      "Marcar «No disponible» saca el producto de la carta sin borrarlo. Es lo que se usa cuando se acabó algo.",
      "El sector de cocina decide a qué comandera sale el producto. Si está mal, el ticket sale en la impresora equivocada.",
      "Todo movimiento de stock de cocina pide motivo.",
    ],
    pasos: [
      {
        titulo: "Cuando se acaba algo",
        texto:
          "En la carta, marcar el producto como no disponible lo saca de lo que ve el cliente sin borrarlo ni perder su precio ni su historial. Cuando vuelve a haber, se reactiva. Es lo que hay que usar para «se acabó el pescado», nunca borrarlo.",
      },
      {
        titulo: "Categorías y sectores",
        texto:
          'Cada categoría tiene un «Sector de cocina default» —parrilla, fritera, postre— que heredan sus productos y que define a qué comandera sale el ticket. Un producto puede pisar ese default desde su propia ficha. Las categorías también se arrastran para reordenar cómo se ven en la carta.',
        aviso: {
          tono: "ojo",
          texto: "Un producto sin sector no se rutea a ninguna comandera. Si algo «no imprime nunca», mirá esto antes que la impresora.",
        },
      },
      {
        titulo: "Stock de bar y stock de cocina",
        texto:
          'Son dos cosas distintas. El del bar es para productos puntuales que se cuentan por unidad —alfajores, turrón— sin tocar listas globales. El de cocina va por insumos y presentaciones: se carga «Cantidad de envases», en positivo para sumar y en negativo para restar, y "El motivo es obligatorio." con ejemplos como «Merma por vencimiento, conteo físico».',
      },
      {
        titulo: "La merma",
        texto:
          "Muestra el porcentaje de pérdida de cada insumo en el período que elijas. Sirve para ver qué se está tirando; no es un inventario contable ni pretende serlo.",
      },
      {
        titulo: "El menú del día",
        texto:
          'Se arma con productos fijos y grupos para elegir («Elegir una de:», por ejemplo el grupo Guarnición), con un precio único: "Precio único del combo. No se suman adicionales.". Se marcan los días en que corre y "El menú solo va a aparecer en el catálogo esos días.".',
      },
    ],
  },
  {
    slug: "salones",
    titulo: "Salones y mesas",
    resumen: "Armar el plano: crear salones, agregar mesas y moverlas cuando cambia el local.",
    icono: Table2,
    grupo: "local",
    claves: [
      "Borrar un salón borra sus mesas. Las reservas viejas no se borran, pero quedan sin mesa.",
      "El plano es lo que ve el mozo: si el salón cambió de verdad, cambialo acá el mismo día.",
    ],
    pasos: [
      {
        titulo: "Crear un salón",
        texto:
          'Le ponés nombre y después "podés agregar mesas y subir una foto del plano desde el editor". Tener el salón dibujado parecido a la realidad es lo que hace que el mozo encuentre la mesa sin pensar.',
      },
      {
        titulo: "Las mesas",
        texto:
          "Se agregan, se renombran y se arrastran hasta que el plano se parezca al salón. Los nombres son los que va a leer todo el mundo en la comanda y en la cuenta: usá los que ya usa el local, no los que te parezcan prolijos.",
      },
      {
        titulo: "Borrar un salón",
        texto:
          'El sistema te avisa: "Las mesas del salón se borran. Las reservas históricas que apuntaban a esas mesas quedan sin mesa asignada (pero no se borran)."',
        aviso: {
          tono: "peligro",
          texto: "Si el salón cambia por una temporada o un evento, conviene editarlo en vez de borrarlo y rehacerlo: borrar deja reservas futuras sin mesa.",
        },
      },
    ],
  },
  {
    slug: "proveedores",
    titulo: "Proveedores y facturas de compra",
    resumen: "Quién nos vende qué, y cargar la factura que llega con la mercadería.",
    icono: Building2,
    grupo: "local",
    claves: [
      "Sacale la foto a la factura cuando llega. Después no aparece.",
      "Vincular el proveedor con sus insumos es lo que hace que los costos salgan solos.",
    ],
    pasos: [
      {
        titulo: "Los proveedores",
        texto:
          "Se cargan con nombre, CUIT y contacto. Si venís de una lista en Excel, se pueden pegar todos juntos en formato CSV con los encabezados «nombre, cuit, contacto, telefono, email».",
      },
      {
        titulo: "Vincular insumos",
        texto:
          "A cada proveedor se le enganchan los insumos que provee. Es lo que después permite saber a quién comprarle y a cuánto, sin buscarlo en un cuaderno.",
      },
      {
        titulo: "Cargar la factura de compra",
        texto:
          "«Cargar factura de compra» pide número, monto y una foto de la factura. Hacelo cuando llega la mercadería: es el momento en que el papel está en la mano y en que alguien todavía se acuerda de qué vino.",
      },
    ],
  },
  {
    slug: "facturacion",
    titulo: "Comprobantes",
    resumen: "Las facturas emitidas, las que fallaron y cómo se anula una mal hecha.",
    icono: FileText,
    grupo: "local",
    claves: [
      "Una factura no se corrige: se anula con nota de crédito y se emite de nuevo.",
      "Un rechazo de datos de ARCA no se arregla reintentando. Un error de conexión sí.",
      "El motivo de anulación es obligatorio y queda en el comprobante.",
    ],
    pasos: [
      {
        titulo: "Dónde aparecen",
        texto:
          'Los comprobantes se emiten desde el cobro y se ven acá — "Los comprobantes aparecen acá al facturar desde el cobro.". Se busca por número o CUIT. Si el negocio todavía no tiene los datos fiscales cargados vas a ver "AFIP no configurado", y eso lo resuelve el dueño.',
      },
      {
        titulo: "Cuando una falla",
        texto:
          'El detalle te dice de qué tipo es el problema, y son dos muy distintos: "Error temporario de conexión con el provider: podés reintentar tal cual." se resuelve reintentando; "Rechazo de datos de ARCA: revisá CUIT / datos del comprobante antes de reintentar." no — ahí hay un dato mal y reintentar sin corregirlo vuelve a fallar.',
      },
      {
        titulo: "Anular una factura",
        texto:
          '«Anular comprobante» pide motivo —con el ejemplo «factura mal hecha al mozo»— y "Se emite la nota de crédito y la factura queda anulada.". Así se corrige una factura: nunca editándola.',
        aviso: {
          tono: "ojo",
          texto: 'A veces el comprobante queda "en proceso en ARCA" un rato. Eso no es un error: esperá antes de anular o reintentar.',
        },
      },
    ],
  },

  // ══ Los clientes ═════════════════════════════════════════════════════════
  {
    slug: "clientes",
    titulo: "Los clientes",
    resumen: "Quién pide, qué pide y hace cuánto que no viene.",
    icono: Users,
    grupo: "clientes",
    claves: [
      "«Días desde el último» es el dato que dice a quién hay que llamar.",
      "Un cliente sin direcciones guardadas puede ser de retiro, no un error.",
    ],
    pasos: [
      {
        titulo: "La ficha",
        texto:
          "Cada cliente tiene su historial de pedidos, «Lo que más pide» y «Días desde el último». Con eso sabés qué ofrecerle antes de que pregunte y quién dejó de venir sin avisar.",
      },
      {
        titulo: "Escribirle",
        texto:
          "Desde la ficha se abre WhatsApp Web con ese contacto, sin tener que buscar el número. Para hablarles a muchos a la vez, eso son las campañas.",
        verTambien: { tema: "promociones", texto: "Promos y campañas" },
      },
    ],
  },
  {
    slug: "promociones",
    titulo: "Promos y campañas",
    resumen: "Códigos de descuento y mensajes para traer de vuelta a los que no vienen.",
    icono: Tag,
    grupo: "clientes",
    claves: [
      "Una promo activa la puede usar cualquiera en el checkout: revisá el pedido mínimo antes de activarla.",
      "En una campaña, cada cliente recibe un código personal de un solo uso.",
      "Los mensajes de campaña los mandás vos, uno por uno, desde WhatsApp.",
    ],
    pasos: [
      {
        titulo: "Un código de descuento",
        texto:
          'Se crea con el código, el tipo de descuento —porcentaje, monto fijo o anular el envío— y opcionalmente un pedido mínimo y una fecha de vencimiento. Mientras está activa, "Los clientes pueden aplicarla en el checkout."; desactivada, "El código existe pero los clientes no pueden usarlo.".',
        aviso: {
          tono: "ojo",
          texto: "Sin pedido mínimo, un 20% se lo lleva también el que pide un café. Poné el mínimo antes de activarla, no después.",
        },
      },
      {
        titulo: "Una campaña a un grupo",
        texto:
          'Elegís a quiénes —todos, o por comportamiento: «No piden hace 30–90 días», «Pidieron 5 o más veces»—, el descuento y el mensaje. "Cada cliente recibe el mensaje con su nombre y un código personal único, de un solo uso."',
      },
      {
        titulo: "Mandarla",
        texto:
          "La campaña te arma la lista y, cliente por cliente, abre WhatsApp con el mensaje ya escrito. Vos apretás enviar. Después se marca quién recibió y quién usó su código, así sabés si sirvió.",
      },
    ],
  },
  {
    slug: "conversaciones",
    titulo: "WhatsApp y el bot",
    resumen: "Las conversaciones con los clientes y cuándo sacarle el teclado al bot.",
    icono: MessagesSquare,
    grupo: "clientes",
    claves: [
      "Mientras el agente está prendido, el bot contesta y vos no podés escribir.",
      "Apagalo para atender vos; prendelo de nuevo cuando termines, o el cliente queda sin respuesta automática.",
    ],
    pasos: [
      {
        titulo: "La bandeja",
        texto:
          "Están todas las conversaciones, marcadas con quién las atiende: «El agente (bot) atiende esta conversación» o «La atiende un humano».",
      },
      {
        titulo: "Tomar una conversación",
        texto:
          'Con el agente prendido, "El bot atiende. Apagalo para escribirle vos al cliente.". Lo apagás y el cuadro de texto se habilita: "Lo estás atendiendo vos. Prendé el agente para devolvérselo al bot.".',
        aviso: {
          tono: "ojo",
          texto: "Acordate de volver a prenderlo al terminar. Una conversación que quedó en manos de nadie es un cliente esperando.",
        },
      },
    ],
  },

  // ══ Si algo falla ════════════════════════════════════════════════════════
  //
  // CATÁLOGO: no se numera (ver TipoTema). Cada entrada arranca con la frase
  // LITERAL que el panel pinta, para poder encontrarla con Cmd+F desde la
  // pantalla. Si cambiás un mensaje en el código, cambialo acá.
  {
    slug: "carteles",
    titulo: "Me apareció un cartel",
    resumen: "Qué significa cada aviso del sistema y qué hay que hacer.",
    icono: TriangleAlert,
    grupo: "problemas",
    claves: [
      "Buscá acá la frase exacta que estás leyendo en la pantalla.",
      "Los carteles en rojo cuestan plata si se ignoran. Los amarillos, tiempo.",
    ],
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
      {
        titulo: '"sin conexión" en Comandas',
        texto:
          "La PC del local que conecta el sistema con las impresoras está caída. Todo lo que cargues sigue registrándose, pero no sale ni un ticket. Prendé esa máquina: cuando vuelve, las comandas pendientes salen solas.",
        aviso: {
          tono: "peligro",
          texto: "Es lo primero que hay que mirar cuando «no salen las comandas». Mientras esté, avisale a la cocina de palabra.",
        },
        verTambien: { tema: "comandas", texto: "La cocina y las comanderas" },
      },
      {
        titulo: '"El motivo es obligatorio." (stock de cocina)',
        texto:
          "Estás moviendo stock sin decir por qué. Escribí qué pasó — «merma por vencimiento», «conteo físico» —: sin eso, el número de mañana no se puede explicar.",
      },
      {
        titulo: '"Este insumo no tiene presentaciones cargadas."',
        texto:
          "No se le puede cargar stock porque el sistema no sabe en qué viene (bidón, caja, kilo). Se le agrega al menos una presentación desde el catálogo y recién ahí acepta cantidades.",
      },
      {
        titulo: '"AFIP no configurado"',
        texto:
          'No se pueden emitir comprobantes porque faltan los datos fiscales: "Para emitir comprobantes electrónicos, primero configurá CUIT y punto de venta.". Lo carga el dueño; no se resuelve desde el mostrador.',
      },
      {
        titulo: '"Rechazo de datos de ARCA: revisá CUIT / datos del comprobante antes de reintentar."',
        texto:
          "Hay un dato mal en el comprobante y ARCA lo rechazó. Reintentar tal cual vuelve a fallar: primero corregí el dato (casi siempre el CUIT del cliente).",
        verTambien: { tema: "facturacion", texto: "Comprobantes, paso a paso" },
      },
      {
        titulo: '"Error temporario de conexión con el provider: podés reintentar tal cual."',
        texto:
          "Este sí es el que se arregla reintentando: no hay nada mal cargado, se cayó la conexión. Probá de nuevo en un rato.",
      },
      {
        titulo: '"El comprobante sigue en proceso en ARCA."',
        texto:
          "No es un error: la emisión está en curso. Esperá antes de anular o reintentar, o vas a terminar con dos comprobantes por la misma venta.",
      },
      {
        titulo: '"No hay clientes en este segmento todavía. La campaña no se puede lanzar."',
        texto:
          "El filtro que elegiste no matchea a nadie — por ejemplo «no piden hace más de 90 días» en un local que abrió hace dos meses. Ampliá el segmento.",
      },
      {
        titulo: '"El agente está atendiendo esta conversación."',
        texto:
          "No podés escribirle al cliente porque el bot tiene el teclado. Apagá el agente arriba a la derecha y el cuadro de texto se habilita. Acordate de volver a prenderlo al terminar.",
        verTambien: { tema: "conversaciones", texto: "WhatsApp y el bot" },
      },
      {
        titulo: '"Las mesas del salón se borran."',
        texto:
          "Es el aviso antes de borrar un salón. Las reservas históricas no se borran, pero quedan sin mesa asignada. Si el cambio es temporal, editá el salón en vez de borrarlo.",
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
