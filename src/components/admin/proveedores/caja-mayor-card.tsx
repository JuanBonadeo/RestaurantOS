"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowDownToLine, Wallet } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { MovimientoModal } from "@/components/admin/local/movimiento-modal";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { registrarIngreso } from "@/lib/caja/actions";
import type { SaldoCajaAdministrativa } from "@/lib/caja/queries";

type Props = {
  slug: string;
  saldo: SaldoCajaAdministrativa | null;
  /** El encargado y el admin pueden fondearla; el resto sólo la ve. */
  puedeFondear: boolean;
};

/**
 * La Caja Mayor, arriba de Proveedores — spec 168.
 *
 * La spec 160 le mandó los pagos a esta caja y no dejó dónde verla: el saldo sólo
 * se podía deducir del libro de movimientos. Y sin fondeo **arrancaba en $0 y sólo
 * bajaba**, así que el número no era un saldo sino la suma de todo lo pagado.
 *
 * Vive acá y no en `/admin/caja` porque esa pantalla ofrece «Ver ahora» → el board
 * del arqueo, que es justo lo que esta caja no tiene.
 */
export function CajaMayorCard({ slug, saldo, puedeFondear }: Props) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [pendiente, startTransition] = useTransition();

  // Sin caja no hay tarjeta: un negocio creado antes de la migración 0067 podría
  // no tenerla, y una tarjeta en $0 que no se puede fondear confunde más que faltar.
  if (!saldo) return null;

  const enRojo = saldo.saldo_cents < 0;

  return (
    <section className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border bg-white px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-lg bg-zinc-100">
          <Wallet className="size-4 text-zinc-500" />
        </span>
        <div>
          <p className="text-xs font-medium text-zinc-500">{saldo.cajaName}</p>
          <p
            className={cn(
              "text-lg font-bold tabular-nums",
              enRojo ? "text-red-600" : "text-zinc-900",
            )}
          >
            {formatCurrency(saldo.saldo_cents)}
          </p>
        </div>
      </div>

      <p className="max-w-md flex-1 text-xs text-zinc-500">
        De acá salen los pagos a proveedor: es una caja administrativa, no entra al
        arqueo del turno.{" "}
        {enRojo && (
          // El negativo NO es un error (160 · D7): la caja mayor del Golf corre
          // −$402M contra +$123M desde 2018. Se explica, no se alarma.
          <span className="text-zinc-600">
            Está en negativo porque salió más de lo que se le puso; cuando cargues
            efectivo, sube.
          </span>
        )}
      </p>

      <div className="flex items-center gap-2">
        <Link
          href={`/${slug}/admin/caja/movimientos?caja=${saldo.cajaId}`}
          className="text-xs font-medium text-zinc-500 underline transition hover:text-zinc-900"
        >
          Ver movimientos
          {saldo.movimientos > 0 ? ` (${saldo.movimientos})` : ""}
        </Link>
        {puedeFondear && (
          <Button variant="outline" size="sm" onClick={() => setAbierto(true)}>
            <ArrowDownToLine className="mr-1.5 size-3.5" />
            Ingresar efectivo
          </Button>
        )}
      </div>

      <MovimientoModal
        open={abierto}
        onOpenChange={setAbierto}
        title={`Ingresar efectivo a ${saldo.cajaName}`}
        description="La plata que ponés en la caja administrativa para pagarle a los proveedores. No toca el arqueo del turno."
        requiereMotivo={false}
        ctaLabel="Registrar ingreso"
        onSubmit={(amount, reason) =>
          startTransition(async () => {
            const r = await registrarIngreso(saldo.cajaId, amount, reason ?? null, slug);
            if (!r.ok) {
              toast.error(r.error);
              return;
            }
            toast.success("Ingreso registrado");
            setAbierto(false);
            router.refresh();
          })
        }
      />
      {pendiente && <span className="sr-only">Registrando…</span>}
    </section>
  );
}
