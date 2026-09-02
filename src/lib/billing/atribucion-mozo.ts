/**
 * A quién se le atribuye la plata de una mesa: al **mozo asignado a la mesa**,
 * y sólo si no hay ninguno, al último que cargó items.
 *
 * Spec 140 · D5 — antes era al revés (`loaded_by` primero, la mesa de fallback).
 * Con el rol `terminal` —una PC compartida por todo el salón— `loaded_by` es
 * siempre la misma cuenta, y como toda mesa cobrada tiene al menos un item, el
 * fallback a la mesa no se alcanzaba nunca: la rendición de cada mozo daba $0 y
 * la recaudación entera quedaba atribuida a la terminal. La rendición se arma
 * filtrando exactamente por este campo (`getRendicionPendienteMozo`).
 *
 * También arregla un caso que ya existía sin terminal: cada item que el
 * encargado cargaba desde el panel le pasaba a él la propina de esa mesa.
 *
 * Lo que no tiene mesa (mostrador, delivery) sigue cayendo en `loaded_by`, que
 * ahí es la respuesta correcta: la cargó quien la cargó.
 *
 * Vive acá y no en `cobro-actions` porque ese módulo es `"use server"`: todos
 * sus exports tienen que ser funciones async, así que una función pura no puede
 * salir de ahí (el typecheck no lo ve — lo caza el build).
 */
export function elegirMozoAtribuido(input: {
  mesaMozoId: string | null;
  lastLoadedBy: string | null;
}): string | null {
  return input.mesaMozoId ?? input.lastLoadedBy;
}
