"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Minus, Plus, X } from "lucide-react";

import { formatCurrency } from "@/lib/currency";
import {
  buildMenuSteps,
  choicesDeltaCents,
  initialOptionIndex,
  optionIndexFromKey,
  type DailyMenuSelection,
  type DailyMenuSelections,
} from "@/lib/mozo/daily-menu-steps";
import type {
  DailyMenuChoiceGroup,
  DailyMenuComponent,
  DailyMenuForMozo,
} from "@/lib/mozo/daily-menus-query";
import { moveSelection } from "@/lib/mozo/product-search";
import { useEscapeToClose } from "@/lib/ui/use-escape-to-close";

/**
 * Asistente de carga del menú del día (spec 072).
 *
 * Antes esto era una hoja larga con **todos** los grupos de opciones juntos:
 * para un menú de entrada + principal + postre había que scrollear la hoja
 * entera y dar tres toques de mouse. Pero cada `choice_group` es una decisión
 * obligatoria de exactamente una opción (D-MDR-4 / D-MDR-6), así que el menú
 * del día ya era un asistente de N pasos dibujado como formulario plano.
 *
 * Ahora es un paso por grupo —primero la entrada, después el principal…— y un
 * paso final para confirmar. Se entra con la primera opción **enfocada de
 * verdad** (roving tabindex), ↓/↑ mueven, Enter elige y avanza, `1`–`9` eligen
 * por posición, ← vuelve. Mismo criterio de teclado que el buscador de
 * productos (specs 055/066): clamp sin wrap-around, fila seleccionada siempre
 * a la vista.
 *
 * Sigue siendo el mismo componente para el celular del mozo: tocar una opción
 * hace lo mismo que Enter. La pista de atajos se muestra sólo en el panel
 * embebido del salón, que es donde hay teclado.
 */
export function DailyMenuWizard({
  menu,
  onClose,
  onAdd,
  embedded = false,
}: {
  menu: DailyMenuForMozo | null;
  onClose: () => void;
  onAdd: (
    menu: DailyMenuForMozo,
    quantity: number,
    selectedChoices: DailyMenuSelection[],
  ) => void;
  /** Embebido en un panel: el overlay se scopea al contenedor (`absolute`) en
   *  vez de cubrir todo el viewport (`fixed`). */
  embedded?: boolean;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selections, setSelections] = useState<DailyMenuSelections>(new Map());
  const [quantity, setQuantity] = useState(1);
  /** Se editó una elección desde el paso final: al confirmarla hay que volver
   *  derecho ahí, sin repetir los pasos que ya estaban resueltos (FR-005). */
  const [returnToConfirm, setReturnToConfirm] = useState(false);

  const steps = useMemo(
    () => buildMenuSteps(menu?.choice_groups ?? []),
    [menu],
  );
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const confirmIndex = steps.length - 1;

  const panelRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const submitRef = useRef<HTMLButtonElement>(null);

  useEscapeToClose(onClose, !!menu);

  // Cada menú abre limpio, desde el primer paso.
  useEffect(() => {
    if (!menu) return;
    setStepIndex(0);
    setActiveIndex(0);
    setSelections(new Map());
    setQuantity(1);
    setReturnToConfirm(false);
  }, [menu?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Foco real al entrar a un paso y al moverse con las flechas (FR-002/003).
  // En el paso final va al botón «Agregar»: Enter agrega.
  useEffect(() => {
    if (!menu || !step) return;
    const t = setTimeout(() => {
      if (step.kind === "choice") {
        const el = optionRefs.current[activeIndex];
        el?.focus({ preventScroll: true });
        el?.scrollIntoView({ block: "nearest" });
      } else {
        submitRef.current?.focus({ preventScroll: true });
      }
    }, 0);
    return () => clearTimeout(t);
  }, [menu?.id, stepIndex, activeIndex, step?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!menu || !step) return null;

  const fixedComponents = menu.components.filter((c) => c.kind !== "choice");
  const delta = choicesDeltaCents(selections);
  const lineTotal = (menu.price_cents + delta) * quantity;

  /** Entra al paso `target` dejando el foco donde corresponde. */
  const goToStep = (target: number, withSelections: DailyMenuSelections) => {
    const next = steps[target];
    setStepIndex(target);
    setActiveIndex(
      next?.kind === "choice" ? initialOptionIndex(next.group, withSelections) : 0,
    );
  };

  const choose = (group: DailyMenuChoiceGroup, option: DailyMenuComponent) => {
    if (!option.product_id) return;
    const next = new Map(selections);
    next.set(group.choice_group_id, {
      choice_group_id: group.choice_group_id,
      choice_group_label: group.label,
      product_id: option.product_id,
      product_name: option.product_name ?? option.label,
      extra_price_cents: option.extra_price_cents ?? 0,
      modifier_ids: [],
    });
    setSelections(next);
    if (returnToConfirm) {
      setReturnToConfirm(false);
      goToStep(confirmIndex, next);
    } else {
      goToStep(Math.min(stepIndex + 1, confirmIndex), next);
    }
  };

  /** Volver: al paso anterior, o cerrar si ya estamos en el primero. */
  const goBack = () => {
    if (stepIndex === 0) {
      onClose();
      return;
    }
    setReturnToConfirm(false);
    goToStep(stepIndex - 1, selections);
  };

  const editGroup = (groupIndex: number) => {
    setReturnToConfirm(true);
    goToStep(groupIndex, selections);
  };

  const handleAdd = () => {
    onAdd(menu, quantity, [...selections.values()]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const typing =
      target.tagName === "INPUT" || target.tagName === "TEXTAREA";

    // Focus-trap: Tab/Shift+Tab ciclan dentro del panel (igual que ProductModal).
    if (e.key === "Tab") {
      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]):not([tabindex="-1"]), input, select, textarea, [href]',
        ),
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
      return;
    }

    if (typing) return;

    if (e.key === "ArrowLeft" || e.key === "Backspace") {
      e.preventDefault();
      goBack();
      return;
    }

    if (step.kind === "choice") {
      const length = step.group.options.length;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => moveSelection(i, 1, length));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => moveSelection(i, -1, length));
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        setActiveIndex(0);
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        setActiveIndex(length - 1);
        return;
      }
      const byDigit = optionIndexFromKey(e.key, length);
      if (byDigit !== null) {
        e.preventDefault();
        const option = step.group.options[byDigit];
        if (option) choose(step.group, option);
        return;
      }
      // Enter/Espacio sobre una opción: elegir y avanzar. Se maneja acá en vez
      // de dejar la activación nativa del `<button>` para que el `preventDefault`
      // corte el click y no haya doble disparo, y para que sólo aplique estando
      // parado en una opción (no en el botón de cerrar del header).
      if (e.key === "Enter" || e.key === " ") {
        if (target.getAttribute("role") !== "radio") return;
        e.preventDefault();
        const option = step.group.options[activeIndex];
        if (option) choose(step.group, option);
      }
      return;
    }

    // Paso final: cantidad con + / − (mismo atajo que ProductModal y walk-in).
    if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      setQuantity((q) => Math.min(99, q + 1));
    } else if (e.key === "-") {
      e.preventDefault();
      setQuantity((q) => Math.max(1, q - 1));
    }
  };

  const stepLabel =
    step.kind === "choice" ? step.group.label : "Confirmá el menú";

  return (
    <div
      onClick={onClose}
      className={`${embedded ? "absolute" : "fixed"} inset-0 z-50 flex items-end justify-center bg-black/45 backdrop-blur-sm`}
    >
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label={`${menu.name} — ${stepLabel}`}
        className={`flex w-full max-w-md ${embedded ? "max-h-full" : "max-h-[92dvh]"} flex-col rounded-t-3xl bg-white shadow-2xl`}
      >
        {/* ── Header: dónde estoy y qué estoy decidiendo ── */}
        <div className="shrink-0 border-b border-zinc-100 px-3 pb-3 pt-2.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={goBack}
              className="rounded-full p-2 text-zinc-600 active:bg-zinc-100"
              aria-label={stepIndex === 0 ? "Cerrar" : "Paso anterior"}
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[10px] font-bold uppercase tracking-[0.15em] text-emerald-700">
                {menu.name}
              </p>
              <h3 className="truncate font-heading text-lg font-extrabold leading-tight text-zinc-900">
                {stepLabel}
              </h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-2 text-zinc-500 active:bg-zinc-100"
              aria-label="Cerrar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {steps.length > 1 && (
            <div className="mt-2 flex items-center gap-2 pl-1">
              <div className="flex items-center gap-1">
                {steps.map((s, i) => (
                  <span
                    key={i}
                    className={`h-1.5 rounded-full transition-all ${
                      i === stepIndex
                        ? "w-5 bg-emerald-600"
                        : i < stepIndex
                          ? "w-1.5 bg-emerald-300"
                          : "w-1.5 bg-zinc-200"
                    }`}
                  />
                ))}
              </div>
              <span className="text-[11px] font-semibold text-zinc-500">
                Paso {stepIndex + 1} de {steps.length}
              </span>
            </div>
          )}
        </div>

        {/* ── Cuerpo ── */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {step.kind === "choice" ? (
            <ul role="radiogroup" aria-label={step.group.label} className="space-y-1.5">
              {step.group.options.map((opt, i) => {
                const isActive = i === activeIndex;
                const isChosen =
                  selections.get(step.group.choice_group_id)?.product_id ===
                  opt.product_id;
                return (
                  <li key={opt.id}>
                    <button
                      ref={(el) => {
                        optionRefs.current[i] = el;
                      }}
                      type="button"
                      role="radio"
                      aria-checked={isChosen}
                      tabIndex={isActive ? 0 : -1}
                      onClick={() => choose(step.group, opt)}
                      onMouseEnter={() => setActiveIndex(i)}
                      className={`flex min-h-[52px] w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition focus:outline-none active:scale-[0.99] ${
                        isChosen
                          ? "bg-emerald-50 ring-2 ring-emerald-500"
                          : isActive
                            ? "bg-white ring-2 ring-emerald-400"
                            : "bg-zinc-50 ring-1 ring-zinc-100"
                      }`}
                    >
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums ${
                          isChosen
                            ? "bg-emerald-600 text-white"
                            : "bg-white text-zinc-500 ring-1 ring-zinc-200"
                        }`}
                      >
                        {isChosen ? (
                          <Check className="h-3.5 w-3.5" strokeWidth={3} />
                        ) : (
                          i + 1
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold text-zinc-900">
                          {opt.product_name ?? opt.label}
                        </span>
                        {opt.description && (
                          <span className="mt-0.5 block truncate text-xs text-zinc-500">
                            {opt.description}
                          </span>
                        )}
                      </span>
                      {opt.extra_price_cents > 0 && (
                        <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold tabular-nums text-amber-800">
                          +{formatCurrency(opt.extra_price_cents)}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <ConfirmStep
              menu={menu}
              fixedComponents={fixedComponents}
              selections={selections}
              onEditGroup={editGroup}
            />
          )}
        </div>

        {/* ── Pie: total + acción del paso ── */}
        <div className="shrink-0 border-t border-zinc-200 bg-white px-3 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {step.kind === "choice" ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-zinc-500">
                Elegí una opción para seguir
              </p>
              <p className="text-base font-extrabold text-emerald-700 tabular-nums">
                {formatCurrency(menu.price_cents + delta)}
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex items-center rounded-full ring-1 ring-zinc-200">
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  className="flex h-11 w-11 items-center justify-center text-zinc-700 active:bg-zinc-50"
                  aria-label="Menos"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-6 text-center text-sm font-bold tabular-nums">
                  {quantity}
                </span>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setQuantity((q) => Math.min(99, q + 1))}
                  className="flex h-11 w-11 items-center justify-center text-zinc-700 active:bg-zinc-50"
                  aria-label="Más"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <button
                ref={submitRef}
                type="button"
                onClick={handleAdd}
                className="flex h-12 flex-1 items-center justify-between rounded-2xl bg-emerald-600 px-4 text-white transition active:scale-[0.98]"
              >
                <span className="text-base font-semibold">Agregar</span>
                <span className="text-base font-bold tabular-nums">
                  {formatCurrency(lineTotal)}
                </span>
              </button>
            </div>
          )}

          {embedded && (
            <p className="mt-2 text-[11px] text-zinc-400">
              {step.kind === "choice"
                ? "↑↓ moverse · 1-9 elegir directo · Enter confirmar · ← volver"
                : "+/− cantidad · Enter agregar · ← volver"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Paso final: qué incluye, qué se eligió (editable) y a cuánto queda. */
function ConfirmStep({
  menu,
  fixedComponents,
  selections,
  onEditGroup,
}: {
  menu: DailyMenuForMozo;
  fixedComponents: DailyMenuComponent[];
  selections: DailyMenuSelections;
  onEditGroup: (groupIndex: number) => void;
}) {
  const groups = menu.choice_groups.filter((g) => g.options.length > 0);
  return (
    <div className="space-y-4">
      {fixedComponents.length > 0 && (
        <section>
          <p className="px-1 text-[11px] font-bold uppercase tracking-wide text-zinc-500">
            Incluye
          </p>
          <ul className="mt-1.5 space-y-1">
            {fixedComponents.map((c) => (
              <li
                key={c.id}
                className="flex items-start gap-2.5 rounded-xl bg-zinc-50 px-3 py-2 ring-1 ring-zinc-100"
              >
                <Check
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600"
                  strokeWidth={3}
                />
                <span className="min-w-0 text-sm text-zinc-700">
                  {c.kind === "product" && c.product_name
                    ? `${c.label}: ${c.product_name}`
                    : c.label}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {groups.length > 0 && (
        <section>
          <p className="px-1 text-[11px] font-bold uppercase tracking-wide text-emerald-700">
            Elegiste
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {groups.map((g, i) => {
              const sel = selections.get(g.choice_group_id);
              return (
                <li key={g.choice_group_id}>
                  <button
                    type="button"
                    onClick={() => onEditGroup(i)}
                    className="flex w-full items-center gap-3 rounded-2xl bg-white px-3 py-2.5 text-left ring-1 ring-zinc-200 transition active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                        {g.label}
                      </span>
                      <span className="block truncate text-[15px] font-semibold text-zinc-900">
                        {sel?.product_name ?? "—"}
                      </span>
                    </span>
                    {sel && sel.extra_price_cents > 0 && (
                      <span className="shrink-0 text-xs font-bold tabular-nums text-amber-800">
                        +{formatCurrency(sel.extra_price_cents)}
                      </span>
                    )}
                    <span className="shrink-0 text-xs font-semibold text-emerald-700">
                      cambiar
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
