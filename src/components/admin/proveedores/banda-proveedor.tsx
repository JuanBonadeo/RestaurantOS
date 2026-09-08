"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Plus, Search, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatearCuit, normalizarCuit } from "@/lib/proveedores/lectura/cuit";

export type CandidatoProveedor = {
  id: string;
  name: string;
  cuit: string | null;
  score: number;
  via: string;
};

export type EstadoProveedor = "sin_foto" | "resuelto" | "propuesto" | "no_encontrado";

export type ProveedorOption = { id: string; name: string; cuit: string | null };

/** El CUIT como se lee en el papel. Lo que no sea un CUIT se muestra tal cual. */
export function mostrarCuit(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const once = normalizarCuit(raw);
  return once ? formatearCuit(once) : raw;
}

const VIA_TEXTO: Record<string, string> = {
  cuit: "el CUIT coincide",
  nombre: "el nombre coincide",
  fuzzy: "el nombre se parece",
};

/** Sin acentos y en minúscula: se busca «serenisima» y aparece «La Serenísima». */
function plano(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export type ItemBuscable = { id: string; name: string; hint?: string | null };

/**
 * El selector con búsqueda — spec 173.
 *
 * Vive acá y no en `ui/` porque nació para la banda de proveedor, y el concepto
 * lo reusa a propósito: el pedido del dueño fue «que sea un botón general, y
 * que desde ahí busque todos los datos… lo mismo con el concepto», así que los
 * dos campos tienen que buscarse igual. Con un `<select>` nativo, encontrar a
 * «Distribuidora del Litoral» entre 111 proveedores es scrollear una lista sin
 * filtro — que es exactamente la vuelta larga que esta pantalla vino a sacar.
 *
 * El alta vive adentro del desplegable (`onCrear`) y no en un botón aparte: el
 * momento en que se descubre que el proveedor no está cargado es el momento en
 * que se lo buscó y no apareció, con el nombre ya tipeado.
 */
export function SelectorBuscable({
  items,
  value,
  onChange,
  placeholder,
  vacio = "Sin elegir",
  onCrear,
  etiquetaCrear,
  invalido = false,
  autoAbierto = false,
  id,
}: {
  items: ItemBuscable[];
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder: string;
  /** Qué dice el botón cuando no hay nada elegido. */
  vacio?: string;
  /** Si viene, lo tipeado que no matchea se puede dar de alta desde el desplegable. */
  onCrear?: (texto: string) => void;
  etiquetaCrear?: (texto: string) => string;
  invalido?: boolean;
  autoAbierto?: boolean;
  /** Lo pone `FormControl`, para que la etiqueta de arriba apunte a algo. */
  id?: string;
}) {
  const [abierto, setAbierto] = useState(autoAbierto);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const cajaRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const elegido = items.find((i) => i.id === value) ?? null;

  const filtrados = useMemo(() => {
    const t = plano(q);
    const base = t
      ? items.filter((i) => plano(i.name).includes(t) || plano(i.hint ?? "").includes(t))
      : items;
    // El tope es de render, no de búsqueda: 111 proveedores pintados de una son
    // 111 nodos que nadie va a mirar. Con el filtro puesto siempre entran.
    return base.slice(0, 60);
  }, [items, q]);

  const puedeCrear = Boolean(onCrear) && q.trim().length >= 2;
  const opciones = puedeCrear ? filtrados.length + 1 : filtrados.length;

  useEffect(() => {
    if (!abierto) return;
    inputRef.current?.focus();
    // El panel está adentro de una columna que scrollea: si el campo quedó cerca
    // del borde de abajo, el desplegable se abre fuera de la vista y parece que
    // no pasó nada. Traerlo a la vista cuesta una línea.
    panelRef.current?.scrollIntoView({ block: "nearest" });
  }, [abierto]);

  useEffect(() => {
    if (!abierto) return;
    const alApuntar = (e: PointerEvent) => {
      if (!cajaRef.current?.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("pointerdown", alApuntar);
    return () => document.removeEventListener("pointerdown", alApuntar);
  }, [abierto]);

  const elegir = (id: string | null) => {
    onChange(id);
    setAbierto(false);
    setQ("");
    setCursor(0);
  };

  const crear = () => {
    onCrear?.(q.trim());
    setAbierto(false);
    setQ("");
    setCursor(0);
  };

  return (
    <div ref={cajaRef} className="relative">
      <button
        type="button"
        id={id}
        onClick={() => setAbierto((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        className={cn(
          "flex h-10 w-full items-center justify-between gap-2 rounded-lg border bg-white px-3 text-left text-sm transition",
          invalido ? "border-red-300" : "border-zinc-200 hover:border-zinc-300",
        )}
      >
        <span className={cn("truncate", elegido ? "text-zinc-900" : "text-zinc-400")}>
          {elegido ? elegido.name : vacio}
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-zinc-400" />
      </button>

      {abierto && (
        <div
          ref={panelRef}
          className="absolute left-0 right-0 z-20 mt-1 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg"
        >
          <div className="flex items-center gap-2 border-b border-zinc-100 px-3">
            <Search className="size-3.5 shrink-0 text-zinc-400" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setCursor(0);
              }}
              placeholder={placeholder}
              className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-zinc-400"
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setCursor((c) => Math.min(c + 1, opciones - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setCursor((c) => Math.max(c - 1, 0));
                } else if (e.key === "Enter") {
                  // El desplegable vive DENTRO del formulario de la compra: sin
                  // esto, elegir con Enter manda el submit y se carga la compra
                  // a medio llenar.
                  e.preventDefault();
                  if (cursor < filtrados.length) {
                    const item = filtrados[cursor];
                    if (item) elegir(item.id);
                  } else if (puedeCrear) {
                    crear();
                  }
                } else if (e.key === "Escape") {
                  // Sólo cierra el desplegable. Si burbujea, cierra lo que haya
                  // detrás y se pierde la carga entera.
                  e.preventDefault();
                  e.stopPropagation();
                  setAbierto(false);
                }
              }}
            />
          </div>

          <ul role="listbox" className="max-h-60 overflow-y-auto py-1">
            {filtrados.length === 0 && !puedeCrear && (
              <li className="px-3 py-2 text-xs text-zinc-400">Nada con ese nombre.</li>
            )}
            {filtrados.map((item, i) => (
              <li key={item.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={item.id === value}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => elegir(item.id)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm",
                    i === cursor ? "bg-zinc-100" : "hover:bg-zinc-50",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-zinc-900">{item.name}</span>
                  {item.hint && (
                    <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">
                      {item.hint}
                    </span>
                  )}
                  {item.id === value && <Check className="size-3.5 shrink-0 text-zinc-900" />}
                </button>
              </li>
            ))}
            {puedeCrear && (
              <li>
                <button
                  type="button"
                  onMouseEnter={() => setCursor(filtrados.length)}
                  onClick={crear}
                  className={cn(
                    "flex w-full items-center gap-2 border-t border-zinc-100 px-3 py-2 text-left text-sm font-medium text-zinc-700",
                    cursor === filtrados.length ? "bg-zinc-100" : "hover:bg-zinc-50",
                  )}
                >
                  <Plus className="size-3.5 shrink-0" />
                  <span className="truncate">
                    {etiquetaCrear ? etiquetaCrear(q.trim()) : `Crear «${q.trim()}»`}
                  </span>
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * La banda de proveedor — spec 173.
 *
 * Es la respuesta al primer pedido del dueño: «debería de encontrar el
 * proveedor, que sea un botón general, y que desde ahí busque todos los datos».
 * Hasta acá había que entrar a la ficha del proveedor y recién ahí cargar la
 * compra; ahora el proveedor es un campo más de la pantalla, y cuando la foto
 * lo trae, viene propuesto.
 *
 * **Con dos candidatos NO se elige solo, por más alto que puntúe.** El dato que
 * lo justifica está medido en la base: el CUIT NO es único en `suppliers` —
 * golf-jcr tiene 71 CUIT bien formados y 69 distintos, kcc 73 y 71. O sea que
 * hay dos pares de proveedores que comparten CUIT en cada negocio. Elegir uno
 * al azar le escribe la compra a la cuenta corriente equivocada, y eso se
 * descubre recién en la conciliación de fin de mes. Por eso el estado
 * `propuesto` deja el guardado apagado hasta que una persona toque.
 */
export function BandaProveedor({
  estado,
  candidatos,
  nombreLeido,
  cuitLeido,
  suppliers,
  value,
  onChange,
  onCrear,
  fijado,
}: {
  estado: EstadoProveedor;
  candidatos: CandidatoProveedor[];
  nombreLeido: string | null;
  cuitLeido: string | null;
  suppliers: ProveedorOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  onCrear: (nombre: string, cuit: string | null) => void;
  /** true cuando se entró desde la ficha de un proveedor. */
  fijado: boolean;
}) {
  // El «Cambiar» del proveedor fijado no es un lujo: se entra a la ficha
  // equivocada y se descubre con el remito en la mano. Lo que hace fijado es
  // que no se muestre nada más hasta que se pida.
  const [cambiando, setCambiando] = useState(false);

  const elegido = suppliers.find((s) => s.id === value) ?? null;
  const items: ItemBuscable[] = suppliers.map((s) => ({
    id: s.id,
    name: s.name,
    hint: mostrarCuit(s.cuit),
  }));

  const selector = (
    <SelectorBuscable
      items={items}
      value={value}
      onChange={onChange}
      placeholder="Buscá por nombre o CUIT…"
      vacio="Elegí el proveedor"
      invalido={!value}
      onCrear={(texto) => onCrear(texto, null)}
      etiquetaCrear={(texto) => `Crear el proveedor «${texto}»`}
      id="banda-proveedor"
    />
  );

  const cuitDelPapel = mostrarCuit(cuitLeido);

  // Fijado y sin ganas de cambiarlo: una línea y a otra cosa. La pantalla se
  // abrió desde su ficha, el proveedor no es la pregunta.
  if (fijado && elegido && !cambiando) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2.5">
        <Check className="size-4 shrink-0 text-emerald-600" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-zinc-900">{elegido.name}</p>
          <p className="text-[11px] text-zinc-500">
            {mostrarCuit(elegido.cuit) ?? "Sin CUIT cargado"} · entraste desde su ficha
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCambiando(true)}
          className="shrink-0 text-xs font-medium text-zinc-500 underline hover:text-zinc-900"
        >
          Cambiar
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "space-y-2 rounded-xl border bg-white p-3",
        estado === "propuesto" && !value
          ? "border-amber-300 bg-amber-50/60"
          : "border-zinc-200",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor="banda-proveedor" className="text-xs font-semibold text-zinc-700">
          Proveedor *
        </label>
        {estado === "resuelto" && elegido && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
            <Check className="size-3" />
            Lo reconocí de la foto
            {candidatos[0]?.via && VIA_TEXTO[candidatos[0].via]
              ? ` — ${VIA_TEXTO[candidatos[0].via]}`
              : ""}
          </span>
        )}
      </div>

      {selector}

      {/* Los candidatos se listan enteros, con de dónde salió cada uno: la
          persona tiene el papel adelante y decide en un segundo si lo ve. */}
      {estado === "propuesto" && candidatos.length > 0 && !value && (
        <div className="space-y-1.5 pt-1">
          <p className="flex items-start gap-1.5 text-[11px] text-amber-800">
            <TriangleAlert className="mt-px size-3 shrink-0" />
            <span>
              {candidatos.length === 1
                ? "Puede ser éste, pero no lo doy por seguro. Confirmalo vos."
                : `Hay ${candidatos.length} proveedores que pueden ser. Elegí cuál.`}
              {nombreLeido ? ` El papel dice «${nombreLeido}»` : ""}
              {cuitDelPapel ? `, CUIT ${cuitDelPapel}` : ""}
              {nombreLeido || cuitDelPapel ? "." : ""}
            </span>
          </p>
          {candidatos.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onChange(c.id)}
              className="flex w-full items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left transition hover:border-zinc-900"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-900">{c.name}</p>
                <p className="text-[11px] text-zinc-500">
                  {mostrarCuit(c.cuit) ?? "Sin CUIT cargado"}
                  {VIA_TEXTO[c.via] ? ` · ${VIA_TEXTO[c.via]}` : ""}
                </p>
              </div>
              <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">
                {Math.round(c.score * 100)}%
              </span>
            </button>
          ))}
        </div>
      )}

      {/* No lo encontró: el alta se ofrece con el nombre YA cargado. Salir a la
          ficha de proveedores para volver después es la vuelta que la spec vino
          a sacar. */}
      {estado === "no_encontrado" && !value && nombreLeido && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <p className="min-w-0 flex-1 text-[11px] text-zinc-600">
            El papel dice «{nombreLeido}»{cuitDelPapel ? `, CUIT ${cuitDelPapel}` : ""} y no
            lo encontré en la lista.
          </p>
          <button
            type="button"
            onClick={() => onCrear(nombreLeido, cuitLeido)}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-zinc-900 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-zinc-800"
          >
            <Plus className="size-3" />
            Crearlo
          </button>
        </div>
      )}

      {estado === "no_encontrado" && !value && !nombreLeido && (
        <p className="text-[11px] text-zinc-500">
          La foto no trajo el nombre del proveedor. Buscalo arriba o creá uno nuevo desde
          el mismo buscador.
        </p>
      )}
    </div>
  );
}
