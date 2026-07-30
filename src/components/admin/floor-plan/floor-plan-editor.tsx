"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  Circle,
  Copy,
  Grid3x3,
  Image as ImageIcon,
  Maximize2,
  RectangleHorizontal,
  RotateCcw,
  Save,
  Square,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveFloorPlan } from "@/lib/admin/floor-plan/actions";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";
import type { FloorPlan, FloorTable, TableShape as TableShapeType } from "@/lib/reservations/types";

import { TableShape } from "./table-shape";
import { useFloorPlanStore } from "./use-floor-plan-store";

type Props = {
  businessSlug: string;
  businessId: string;
  plan: FloorPlan;
  tables: FloorTable[];
};

const GRID = 10;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 3;

function snap(v: number, free: boolean): number {
  if (free) return Math.round(v);
  return Math.round(v / GRID) * GRID;
}

export function FloorPlanEditor({ businessSlug, businessId, plan, tables }: Props) {
  const init = useFloorPlanStore((s) => s.init);
  const setName = useFloorPlanStore((s) => s.setName);
  const setCanvasSize = useFloorPlanStore((s) => s.setCanvasSize);
  const setBackgroundImage = useFloorPlanStore((s) => s.setBackgroundImage);
  const setBackgroundOpacity = useFloorPlanStore((s) => s.setBackgroundOpacity);
  const setShowCustomerName = useFloorPlanStore((s) => s.setShowCustomerName);
  const addTable = useFloorPlanStore((s) => s.addTable);
  const select = useFloorPlanStore((s) => s.select);
  const updateSelected = useFloorPlanStore((s) => s.updateSelected);
  const moveSelected = useFloorPlanStore((s) => s.moveSelected);
  const resizeSelected = useFloorPlanStore((s) => s.resizeSelected);
  const rotateSelected = useFloorPlanStore((s) => s.rotateSelected);
  const deleteSelected = useFloorPlanStore((s) => s.deleteSelected);
  const duplicateSelected = useFloorPlanStore((s) => s.duplicateSelected);
  const markClean = useFloorPlanStore((s) => s.markClean);

  const width = useFloorPlanStore((s) => s.width);
  const height = useFloorPlanStore((s) => s.height);
  const name = useFloorPlanStore((s) => s.name);
  const backgroundImageUrl = useFloorPlanStore((s) => s.backgroundImageUrl);
  const backgroundOpacity = useFloorPlanStore((s) => s.backgroundOpacity);
  const showCustomerName = useFloorPlanStore((s) => s.showCustomerName);
  const allTables = useFloorPlanStore((s) => s.tables);
  const selectedLocalId = useFloorPlanStore((s) => s.selectedLocalId);
  const dirty = useFloorPlanStore((s) => s.dirty);

  const [pending, startTransition] = useTransition();
  const [showGrid, setShowGrid] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{
    mode: "move" | "resize" | "rotate";
    startX: number;
    startY: number;
    snapshot: { x: number; y: number; width: number; height: number; rotation: number };
  } | null>(null);

  useEffect(() => {
    init({
      width: plan.width,
      height: plan.height,
      name: plan.name,
      backgroundImageUrl: plan.background_image_url,
      backgroundOpacity: plan.background_opacity,
      showCustomerName: plan.show_customer_name ?? false,
      tables,
    });
  }, [
    init,
    plan.background_image_url,
    plan.background_opacity,
    plan.show_customer_name,
    plan.height,
    plan.name,
    plan.width,
    tables,
  ]);

  const selected = allTables.find((t) => t._localId === selectedLocalId) ?? null;

  function svgPointFromEvent(e: React.PointerEvent | PointerEvent): { x: number; y: number } {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (width / rect.width);
    const sy = (e.clientY - rect.top) * (height / rect.height);
    return { x: sx, y: sy };
  }

  function onTablePointerDown(localId: string) {
    return (e: React.PointerEvent<SVGGElement>) => {
      e.stopPropagation();
      select(localId);
      const t = useFloorPlanStore.getState().tables.find((x) => x._localId === localId);
      if (!t) return;
      const p = svgPointFromEvent(e);
      dragRef.current = {
        mode: "move",
        startX: p.x,
        startY: p.y,
        snapshot: { x: t.x, y: t.y, width: t.width, height: t.height, rotation: t.rotation },
      };
      (e.target as Element).setPointerCapture?.(e.pointerId);
    };
  }

  function onResizeHandlePointerDown(e: React.PointerEvent<SVGRectElement>) {
    e.stopPropagation();
    if (!selected) return;
    const p = svgPointFromEvent(e);
    dragRef.current = {
      mode: "resize",
      startX: p.x,
      startY: p.y,
      snapshot: {
        x: selected.x,
        y: selected.y,
        width: selected.width,
        height: selected.height,
        rotation: selected.rotation,
      },
    };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  function onRotateHandlePointerDown(e: React.PointerEvent<SVGCircleElement>) {
    e.stopPropagation();
    if (!selected) return;
    const p = svgPointFromEvent(e);
    dragRef.current = {
      mode: "rotate",
      startX: p.x,
      startY: p.y,
      snapshot: {
        x: selected.x,
        y: selected.y,
        width: selected.width,
        height: selected.height,
        rotation: selected.rotation,
      },
    };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  function onSvgPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!dragRef.current || !selected) return;
    const p = svgPointFromEvent(e);
    const dx = p.x - dragRef.current.startX;
    const dy = p.y - dragRef.current.startY;
    const free = e.shiftKey;

    if (dragRef.current.mode === "move") {
      const snap0 = dragRef.current.snapshot;
      const targetX = snap(snap0.x + dx, free);
      const targetY = snap(snap0.y + dy, free);
      moveSelected(targetX - selected.x, targetY - selected.y);
    } else if (dragRef.current.mode === "resize") {
      const snap0 = dragRef.current.snapshot;
      const newW = snap(Math.max(20, snap0.width + dx), free);
      const newH = snap(Math.max(20, snap0.height + dy), free);
      resizeSelected(newW, newH);
    } else {
      const snap0 = dragRef.current.snapshot;
      const cx = snap0.x + snap0.width / 2;
      const cy = snap0.y + snap0.height / 2;
      const angle = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI;
      const deg = angle + 90;
      rotateSelected(free ? deg : Math.round(deg / 15) * 15);
    }
  }

  function onSvgPointerUp() {
    dragRef.current = null;
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isField =
        target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");
      if (e.key === "Delete" || e.key === "Backspace") {
        if (isField) return;
        if (selectedLocalId) {
          e.preventDefault();
          deleteSelected();
        }
      }
      if ((e.key === "d" || e.key === "D") && (e.metaKey || e.ctrlKey)) {
        if (isField) return;
        if (selectedLocalId) {
          e.preventDefault();
          duplicateSelected();
        }
      }
      if (e.key === "Escape") {
        select(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedLocalId, deleteSelected, duplicateSelected, select]);

  async function onUploadBackground(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Solo imágenes (PNG, JPG, etc).");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error("Máximo 8MB.");
      return;
    }
    setUploading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const path = `${businessId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage
        .from("floor-plans")
        .upload(path, file, { cacheControl: "3600", upsert: false });
      if (error) {
        console.error(error);
        toast.error("No pudimos subir la imagen.");
        return;
      }
      const { data } = supabase.storage.from("floor-plans").getPublicUrl(path);
      setBackgroundImage(data.publicUrl);

      // try to auto-fit canvas to image aspect ratio
      const img = new Image();
      img.onload = () => {
        if (img.naturalWidth && img.naturalHeight) {
          const aspect = img.naturalWidth / img.naturalHeight;
          const targetW = 1200;
          const targetH = Math.round(targetW / aspect);
          if (Math.abs(targetH - height) > 50 || Math.abs(targetW - width) > 50) {
            setCanvasSize(targetW, targetH);
          }
        }
      };
      img.src = data.publicUrl;
      toast.success("Imagen cargada. Ajustá la opacidad y dibujá las mesas encima.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function onSave() {
    startTransition(async () => {
      const result = await saveFloorPlan({
        business_slug: businessSlug,
        floor_plan_id: plan.id,
        name,
        width,
        height,
        background_image_url: backgroundImageUrl,
        background_opacity: backgroundOpacity,
        show_customer_name: showCustomerName,
        tables: allTables.map((t) => ({
          id: t.id,
          label: t.label,
          seats: t.seats,
          shape: t.shape,
          x: t.x,
          y: t.y,
          width: t.width,
          height: t.height,
          rotation: t.rotation,
          status: t.status,
          is_bar: t.is_bar,
        })),
      });
      if (result.ok) {
        toast.success("Plano guardado");
        markClean();
      } else {
        toast.error(result.error);
      }
    });
  }

  const totalSeats = useMemo(
    () => allTables.filter((t) => t.status === "active").reduce((sum, t) => sum + t.seats, 0),
    [allTables],
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-3">
        {/* Toolbar */}
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1.5 rounded-lg border bg-card/95 p-2 shadow-sm backdrop-blur">
          <ToolGroup label="Mesas">
            <ToolbarButton onClick={() => addTable("circle")} icon={<Circle className="size-4" />}>
              Redonda
            </ToolbarButton>
            <ToolbarButton onClick={() => addTable("square")} icon={<Square className="size-4" />}>
              Cuadrada
            </ToolbarButton>
            <ToolbarButton
              onClick={() => addTable("rect")}
              icon={<RectangleHorizontal className="size-4" />}
            >
              Rectangular
            </ToolbarButton>
          </ToolGroup>

          <Divider />

          <ToolGroup label="Plano">
            <ToolbarButton
              icon={<ImageIcon className="size-4" />}
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? "Subiendo…" : backgroundImageUrl ? "Cambiar foto" : "Subir foto"}
            </ToolbarButton>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUploadBackground(f);
              }}
            />
            <ToolbarButton
              icon={<Grid3x3 className="size-4" />}
              onClick={() => setShowGrid((g) => !g)}
              active={showGrid}
            >
              Grilla
            </ToolbarButton>
          </ToolGroup>

          <Divider />

          <ToolGroup label="Zoom">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setZoom((z) => Math.max(MIN_ZOOM, +(z - 0.1).toFixed(2)))}
              aria-label="Zoom out"
            >
              <ZoomOut className="size-4" />
            </Button>
            <span className="w-10 text-center text-xs tabular-nums text-muted-foreground">
              {Math.round(zoom * 100)}%
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setZoom((z) => Math.min(MAX_ZOOM, +(z + 0.1).toFixed(2)))}
              aria-label="Zoom in"
            >
              <ZoomIn className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setZoom(1)}
              aria-label="Resetear zoom"
            >
              <Maximize2 className="size-4" />
            </Button>
          </ToolGroup>

          <div className="ms-auto flex items-center gap-2">
            {dirty ? (
              <span className="hidden text-xs text-muted-foreground sm:inline">
                Cambios sin guardar
              </span>
            ) : null}
            <Button type="button" size="sm" onClick={onSave} disabled={pending || !dirty}>
              <Save className="size-4" /> Guardar
            </Button>
          </div>
        </div>

        {/* Canvas */}
        <div className="relative overflow-auto rounded-xl border bg-muted/30 p-4 shadow-inner">
          <div
            className="relative mx-auto"
            style={{
              width: `${zoom * 100}%`,
              maxWidth: "none",
              transition: "width 80ms ease-out",
            }}
          >
            <svg
              ref={svgRef}
              viewBox={`0 0 ${width} ${height}`}
              className="block aspect-auto w-full rounded-lg border bg-background shadow-sm"
              style={{ aspectRatio: `${width}/${height}` }}
              onPointerMove={onSvgPointerMove}
              onPointerUp={onSvgPointerUp}
              onPointerLeave={onSvgPointerUp}
              onClick={(e) => {
                if (e.target === svgRef.current) select(null);
              }}
            >
              <defs>
                <pattern id="fp-grid" width={GRID * 5} height={GRID * 5} patternUnits="userSpaceOnUse">
                  <path
                    d={`M ${GRID * 5} 0 L 0 0 0 ${GRID * 5}`}
                    className="fill-none stroke-border/40"
                    strokeWidth={1}
                  />
                </pattern>
                <pattern
                  id="fp-grid-major"
                  width={GRID * 25}
                  height={GRID * 25}
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d={`M ${GRID * 25} 0 L 0 0 0 ${GRID * 25}`}
                    className="fill-none stroke-border/70"
                    strokeWidth={1.2}
                  />
                </pattern>
              </defs>

              {/* background photo */}
              {backgroundImageUrl ? (
                <image
                  href={backgroundImageUrl}
                  x={0}
                  y={0}
                  width={width}
                  height={height}
                  preserveAspectRatio="xMidYMid slice"
                  opacity={backgroundOpacity / 100}
                />
              ) : null}

              {/* grid */}
              {showGrid ? (
                <>
                  <rect width={width} height={height} fill="url(#fp-grid)" />
                  <rect width={width} height={height} fill="url(#fp-grid-major)" />
                </>
              ) : null}

              {/* canvas border */}
              <rect
                x={0.5}
                y={0.5}
                width={width - 1}
                height={height - 1}
                className="fill-none stroke-border/60"
                strokeDasharray="4 6"
              />

              {allTables.map((t) => (
                <TableShape
                  key={t._localId}
                  table={t}
                  selected={t._localId === selectedLocalId}
                  onPointerDown={onTablePointerDown(t._localId)}
                />
              ))}

              {selected ? (
                <SelectionHandles
                  table={selected}
                  onResize={onResizeHandlePointerDown}
                  onRotate={onRotateHandlePointerDown}
                />
              ) : null}
            </svg>
          </div>

          {/* Stats overlay */}
          <div className="pointer-events-none absolute bottom-3 left-3 flex gap-2 text-xs">
            <span className="rounded-md bg-card/90 px-2 py-1 shadow-sm backdrop-blur">
              {allTables.length} mesa{allTables.length === 1 ? "" : "s"}
            </span>
            <span className="rounded-md bg-card/90 px-2 py-1 shadow-sm backdrop-blur">
              {totalSeats} comensales
            </span>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Tip: Shift mientras arrastrás desactiva el snap a grilla. Suprimir borra,
          ⌘/Ctrl+D duplica, Escape deselecciona.
        </p>
      </div>

      {/* Sidebar */}
      <aside className="space-y-4">
        {/* Plan settings card */}
        <div className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
          <h3 className="text-sm font-semibold">Plano</h3>
          <div className="space-y-1.5">
            <Label htmlFor="fp-name">Nombre</Label>
            <Input
              id="fp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="fp-w">Ancho</Label>
              <Input
                id="fp-w"
                type="number"
                min={200}
                max={5000}
                step={50}
                value={width}
                onChange={(e) => setCanvasSize(Math.max(200, Number(e.target.value) || width), height)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fp-h">Alto</Label>
              <Input
                id="fp-h"
                type="number"
                min={200}
                max={5000}
                step={50}
                value={height}
                onChange={(e) => setCanvasSize(width, Math.max(200, Number(e.target.value) || height))}
              />
            </div>
          </div>

          {/* Background controls */}
          <div className="space-y-2 border-t pt-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Foto del plano
              </Label>
              {backgroundImageUrl ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setBackgroundImage(null)}
                  aria-label="Quitar foto"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              ) : null}
            </div>

            {backgroundImageUrl ? (
              <div className="space-y-2">
                <div className="relative aspect-video w-full overflow-hidden rounded-lg border bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={backgroundImageUrl}
                    alt="Plano"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="fp-opacity" className="text-xs">
                      Opacidad
                    </Label>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {backgroundOpacity}%
                    </span>
                  </div>
                  <input
                    id="fp-opacity"
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={backgroundOpacity}
                    onChange={(e) => setBackgroundOpacity(Number(e.target.value))}
                    className="w-full accent-primary"
                  />
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className={cn(
                  "flex w-full flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-border/60 bg-muted/30 px-3 py-6 text-center transition hover:border-primary/50 hover:bg-muted/50",
                  uploading && "opacity-50",
                )}
              >
                <ImageIcon className="size-6 text-muted-foreground" />
                <span className="text-xs font-medium">
                  {uploading ? "Subiendo…" : "Subir foto del plano"}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  PNG, JPG. Máx 8MB. Usala como referencia para dibujar las mesas encima.
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Cómo se rotulan las mesas en vivo (spec 067) */}
        <div className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
          <h3 className="text-sm font-semibold">En vivo</h3>
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={showCustomerName}
              onChange={(e) => setShowCustomerName(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-primary"
            />
            <span className="space-y-0.5">
              <span className="block text-xs font-medium leading-tight">
                Mostrar el nombre del cliente en las mesas ocupadas
              </span>
              <span className="text-muted-foreground block text-[10px] leading-snug">
                En vez del número de mesa y el tiempo abierto. Las mesas libres
                siguen mostrando su número, y si no se conoce el nombre (walk-in
                sin datos) la mesa se rotula como siempre.
              </span>
            </span>
          </label>
        </div>

        {/* Selected table card */}
        {selected ? (
          <div className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Mesa seleccionada</h3>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => duplicateSelected()}
                  aria-label="Duplicar mesa"
                  title="Duplicar (⌘D)"
                >
                  <Copy className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => updateSelected({ rotation: 0 })}
                  aria-label="Resetear rotación"
                  title="Resetear rotación"
                >
                  <RotateCcw className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => deleteSelected()}
                  aria-label="Eliminar mesa"
                  title="Eliminar"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fp-label">Nombre</Label>
              <Input
                id="fp-label"
                value={selected.label}
                onChange={(e) => updateSelected({ label: e.target.value })}
                maxLength={40}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="fp-seats">Comensales</Label>
                <Input
                  id="fp-seats"
                  type="number"
                  min={1}
                  max={50}
                  value={selected.seats}
                  onChange={(e) =>
                    updateSelected({ seats: Math.max(1, Number(e.target.value) || 1) })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fp-shape">Forma</Label>
                <select
                  id="fp-shape"
                  className="h-9 w-full rounded-lg border bg-transparent px-2 text-sm"
                  value={selected.shape}
                  onChange={(e) => updateSelected({ shape: e.target.value as TableShapeType })}
                >
                  <option value="circle">Redonda</option>
                  <option value="square">Cuadrada</option>
                  <option value="rect">Rectangular</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="fp-tw">Ancho</Label>
                <Input
                  id="fp-tw"
                  type="number"
                  min={20}
                  value={selected.width}
                  onChange={(e) =>
                    resizeSelected(
                      Math.max(20, Number(e.target.value) || selected.width),
                      selected.height,
                    )
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fp-th">Alto</Label>
                <Input
                  id="fp-th"
                  type="number"
                  min={20}
                  value={selected.height}
                  onChange={(e) =>
                    resizeSelected(
                      selected.width,
                      Math.max(20, Number(e.target.value) || selected.height),
                    )
                  }
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="fp-rot">Rotación</Label>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {selected.rotation}°
                </span>
              </div>
              <input
                id="fp-rot"
                type="range"
                min={0}
                max={359}
                step={5}
                value={selected.rotation}
                onChange={(e) => rotateSelected(Number(e.target.value))}
                className="w-full accent-primary"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fp-status">Estado</Label>
              <select
                id="fp-status"
                className="h-9 w-full rounded-lg border bg-transparent px-2 text-sm"
                value={selected.status}
                onChange={(e) =>
                  updateSelected({ status: e.target.value as "active" | "disabled" })
                }
              >
                <option value="active">Activa</option>
                <option value="disabled">Deshabilitada</option>
              </select>
            </div>
            <p className="text-xs text-muted-foreground">
              Las deshabilitadas no se ofrecen en el motor de reservas pero conservan
              el historial.
            </p>

            {/* Barra: venta directa sin mozo (spec 08) */}
            <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
              <div className="pr-3">
                <Label htmlFor="fp-isbar" className="cursor-pointer">
                  Barra (venta directa)
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Vende y cobra sin mozo. No manda a comanda, salvo los sectores
                  marcados &quot;Sale a comanda&quot;. Queda fuera de reservas.
                </p>
              </div>
              <button
                id="fp-isbar"
                type="button"
                onClick={() => updateSelected({ is_bar: !selected.is_bar })}
                role="switch"
                aria-checked={selected.is_bar}
                className={cn(
                  "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition",
                  selected.is_bar ? "bg-emerald-600" : "bg-muted-foreground/30",
                )}
              >
                <span
                  className={cn(
                    "inline-block h-5 w-5 transform rounded-full bg-white shadow transition",
                    selected.is_bar ? "translate-x-5" : "translate-x-0.5",
                  )}
                />
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed bg-card/50 p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Seleccioná una mesa para editarla, o agregá una nueva desde la barra superior.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}

function ToolGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      className="flex items-center gap-1"
      role="group"
      aria-label={label}
    >
      {children}
    </div>
  );
}

function Divider() {
  return <div className="mx-1 h-6 w-px bg-border" />;
}

function ToolbarButton({
  children,
  onClick,
  icon,
  active,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  icon: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className="gap-1.5"
    >
      {icon}
      <span className="hidden sm:inline">{children}</span>
    </Button>
  );
}

function SelectionHandles({
  table,
  onResize,
  onRotate,
}: {
  table: { x: number; y: number; width: number; height: number; rotation: number };
  onResize: (e: React.PointerEvent<SVGRectElement>) => void;
  onRotate: (e: React.PointerEvent<SVGCircleElement>) => void;
}) {
  const cx = table.width / 2;
  const cy = table.height / 2;
  const transform = `translate(${table.x} ${table.y}) rotate(${table.rotation} ${cx} ${cy})`;
  const handleSize = 12;
  return (
    <g transform={transform} style={{ touchAction: "none" }}>
      {/* selection outline */}
      <rect
        x={-2}
        y={-2}
        width={table.width + 4}
        height={table.height + 4}
        className="pointer-events-none fill-none stroke-primary/60"
        strokeDasharray="3 3"
        strokeWidth={1}
        rx={4}
      />
      {/* resize bottom-right */}
      <rect
        x={table.width - handleSize / 2}
        y={table.height - handleSize / 2}
        width={handleSize}
        height={handleSize}
        rx={2}
        className="fill-primary stroke-primary-foreground"
        strokeWidth={1.5}
        style={{ cursor: "nwse-resize" }}
        onPointerDown={onResize}
      />
      {/* rotation arm + handle */}
      <line x1={cx} y1={0} x2={cx} y2={-24} className="stroke-primary" strokeWidth={2} />
      <circle
        cx={cx}
        cy={-28}
        r={7}
        className="fill-primary stroke-primary-foreground"
        strokeWidth={1.5}
        style={{ cursor: "grab" }}
        onPointerDown={onRotate}
      />
    </g>
  );
}
