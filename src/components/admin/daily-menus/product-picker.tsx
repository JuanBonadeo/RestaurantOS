"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import type { ProductModifierGroup } from "@/lib/daily-menus/daily-menu-modifiers";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export type PickedProduct = {
  id: string;
  name: string;
  image_url: string | null;
  /**
   * Lo que el producto pregunta por su cuenta dentro del combo (spec 083). Se
   * trae en el mismo viaje —una columna más en el select que ya existía— para
   * que el editor pueda mostrarlo al elegirlo (spec 148, D4). El editor de
   * menús no es una pantalla de hora pico: el costo es un join.
   */
  modifier_groups: ProductModifierGroup[];
};

export function ProductPicker({
  businessId,
  value,
  onChange,
}: {
  businessId: string;
  value: PickedProduct | null;
  onChange: (product: PickedProduct | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickedProduct[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const search = useCallback(
    async (q: string) => {
      if (q.length < 2) {
        setResults([]);
        return;
      }
      setLoading(true);
      const supabase = createSupabaseBrowserClient();
      const { data } = await supabase
        .from("products")
        .select(
          "id, name, image_url, modifier_groups(id, name, is_required, sort_order)",
        )
        .eq("business_id", businessId)
        .eq("is_active", true)
        .ilike("name", `%${q}%`)
        .order("name")
        .limit(10);
      setResults(
        (data ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          image_url: p.image_url,
          modifier_groups: (p.modifier_groups ?? []) as ProductModifierGroup[],
        })),
      );
      setLoading(false);
    },
    [businessId],
  );

  useEffect(() => {
    const timer = setTimeout(() => search(query), 250);
    return () => clearTimeout(timer);
  }, [query, search]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (value) {
    return (
      <div className="bg-muted flex items-center gap-2 rounded-lg px-3 py-2">
        <span className="flex-1 truncate text-sm font-medium">
          {value.name}
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="hover:bg-background rounded p-0.5 transition-colors"
          aria-label="Quitar producto"
        >
          <X className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
        <Input
          placeholder="Buscar producto…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (query.length >= 2) setOpen(true);
          }}
          className="pl-8"
        />
      </div>
      {open && (results.length > 0 || loading) && (
        <div className="bg-popover ring-foreground/10 absolute z-50 mt-1 w-full overflow-hidden rounded-lg shadow-md ring-1">
          {loading && results.length === 0 && (
            <div className="text-muted-foreground px-3 py-2 text-sm">
              Buscando…
            </div>
          )}
          {results.map((p) => (
            <button
              key={p.id}
              type="button"
              className="hover:bg-accent flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors"
              onClick={() => {
                onChange(p);
                setQuery("");
                setOpen(false);
              }}
            >
              <span className="truncate">{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
