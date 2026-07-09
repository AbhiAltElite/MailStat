import { useEffect, useMemo, useRef, useState } from "react";
import { hierarchy, treemap, treemapSquarify } from "d3-hierarchy";
import type { HierarchyRectangularNode } from "d3-hierarchy";
import type { TreeNode } from "../lib/api";
import { colorFor, hashColor } from "../lib/colors";
import { formatBytes } from "../lib/format";

interface Props {
  nodes: TreeNode[];
  /** Identifies the current drill position; zoom resets when this changes. */
  viewKey: string;
  /** key-path of the selected tile relative to current drill position */
  selectedKey: string | null;
  onSelect: (node: TreeNode | null) => void;
  onDrill: (node: TreeNode) => void;
  onOpenMessage: (id: number) => void;
  highlightCat: string | null;
  theme: "light" | "dark";
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

interface Datum extends TreeNode {
  isRoot?: boolean;
}

type RectNode = HierarchyRectangularNode<Datum>;

const MIN_SCALE = 1;
// A mailbox view can hold hundreds of message tiles, some a fraction of a
// pixel wide at 100%. Cap zoom high enough that even those can be enlarged
// until they actually render and can be clicked, instead of staying blank
// no matter how far you zoom.
const MAX_SCALE = 60;
const DRAG_THRESHOLD = 4;

interface ZoomState {
  scale: number;
  x: number;
  y: number;
}

const IDENTITY: ZoomState = { scale: 1, x: 0, y: 0 };

function clampNum(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Keep the visible viewport inside the (possibly zoomed) content bounds. */
function clampPan(x: number, y: number, scale: number, dims: { w: number; h: number }): [number, number] {
  const minX = dims.w * (1 - scale);
  const minY = dims.h * (1 - scale);
  return [clampNum(x, minX, 0), clampNum(y, minY, 0)];
}

export default function Treemap({
  nodes,
  viewKey,
  selectedKey,
  onSelect,
  onDrill,
  onOpenMessage,
  highlightCat,
  theme,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<{ node: RectNode; x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState<ZoomState>(IDENTITY);
  const [isPanning, setIsPanning] = useState(false);

  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const dimsRef = useRef(dims);
  dimsRef.current = dims;

  // A different drill position or grouping starts from a fresh view.
  useEffect(() => {
    setZoom(IDENTITY);
  }, [viewKey]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setDims({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const root: RectNode | null = useMemo(() => {
    if (!nodes.length || dims.w < 10 || dims.h < 10) return null;
    const rootDatum: Datum = {
      key: "__root__",
      label: "",
      sublabel: "",
      size: 0,
      count: 0,
      cat: "mixed",
      leaf: false,
      children: nodes,
      isRoot: true,
    };
    const h = hierarchy<Datum>(rootDatum, (d) => (d.isRoot || d.children.length ? d.children : undefined))
      // Parents with capped children carry an explicit "…more" bucket so leaf
      // sums equal the parent size; sum() over leaves keeps areas truthful.
      .sum((d) => (d.isRoot || d.children.length ? 0 : Math.max(d.size, 1)))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    return treemap<Datum>()
      .tile(treemapSquarify.ratio(1.35))
      .size([dims.w, dims.h])
      .paddingOuter(2)
      .paddingTop((d) => (d.depth === 1 && !d.data.leaf && (d.children?.length ?? 0) > 0 ? 16 : 2))
      .paddingInner(1)(h) as RectNode;
  }, [nodes, dims]);

  // Zoom in/out around a fixed screen point, e.g. the cursor or the canvas center.
  function zoomAt(sx: number, sy: number, factor: number) {
    setZoom((t) => {
      const newScale = clampNum(t.scale * factor, MIN_SCALE, MAX_SCALE);
      if (newScale === t.scale) return t;
      const worldX = (sx - t.x) / t.scale;
      const worldY = (sy - t.y) / t.scale;
      const [x, y] = clampPan(sx - worldX * newScale, sy - worldY * newScale, newScale, dimsRef.current);
      return { scale: newScale, x, y };
    });
  }

  // Wheel zoom: attached natively so preventDefault actually stops page scroll.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = canvas!.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * 0.0015);
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
    }
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [dims]);

  // Drag to pan. Registered once; a ref-held drag state and threshold let a
  // stationary click still reach onClick, while an actual drag suppresses it.
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number; dragging: boolean } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const ds = dragState.current;
      if (!ds) return;
      const dx = e.clientX - ds.startX;
      const dy = e.clientY - ds.startY;
      if (!ds.dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        ds.dragging = true;
        setIsPanning(true);
        setHover(null);
      }
      if (!ds.dragging) return;
      const [x, y] = clampPan(ds.origX + dx, ds.origY + dy, zoomRef.current.scale, dimsRef.current);
      setZoom((t) => ({ ...t, x, y }));
    }
    function onUp() {
      if (dragState.current?.dragging) suppressClick.current = true;
      dragState.current = null;
      setIsPanning(false);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !root) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = dims.w * dpr;
    canvas.height = dims.h * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, dims.w, dims.h);
    ctx.setTransform(dpr * zoom.scale, 0, 0, dpr * zoom.scale, dpr * zoom.x, dpr * zoom.y);

    const groupBg = cssVar("--tm-group-bg");
    const groupText = cssVar("--tm-group-text");
    const outline = cssVar("--sel");
    // Compare against the actual on-screen size so labels appear on tiles
    // that are too small at 100% but become readable once zoomed in.
    const s = zoom.scale;
    // Font sizes and text offsets are authored in world units but drawn
    // through a scaled transform, so they must be divided by the current
    // zoom to stay a constant, readable size on screen instead of growing
    // without bound as you zoom in.
    const inv = 1 / s;

    // Group headers (depth 1 with children)
    for (const g of root.children ?? []) {
      if (!g.children) continue;
      const w = g.x1 - g.x0;
      const h = g.y1 - g.y0;
      ctx.fillStyle = groupBg;
      ctx.fillRect(g.x0, g.y0, w, h);
      if (w * s > 40 && h * s > 18) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(g.x0, g.y0, w, h);
        ctx.clip();
        ctx.fillStyle = groupText;
        ctx.font = `600 ${10 * inv}px ui-sans-serif, system-ui`;
        const label = `${g.data.label}  ·  ${formatBytes(g.data.size)}`;
        ctx.fillText(ellipsize(ctx, label, w - 10 * inv), g.x0 + 5 * inv, g.y0 + 11.5 * inv);
        ctx.restore();
      }
    }

    // Leaf tiles with a cushion-ish vertical gradient
    for (const leaf of root.leaves()) {
      if (leaf.depth === 0) continue;
      const w = leaf.x1 - leaf.x0;
      const h = leaf.y1 - leaf.y0;
      // Screen-space, like every other size check below: a tile that's
      // sub-pixel at 100% but has real (nonzero) world-space area should
      // still appear once zoomed in enough to see it, not stay permanently
      // blank because it once measured under a fixed world-space threshold.
      if (w * s < 0.75 || h * s < 0.75) continue;
      const d = leaf.data;
      const base =
        d.cat === "mixed" ? hashColor(d.key + d.label) : colorFor(d.cat);
      const dimmed = highlightCat && d.cat !== highlightCat;
      const grad = ctx.createLinearGradient(leaf.x0, leaf.y0, leaf.x0, leaf.y1);
      grad.addColorStop(0, shade(base, 18));
      grad.addColorStop(1, shade(base, -22));
      ctx.globalAlpha = dimmed ? 0.18 : 1;
      ctx.fillStyle = grad;
      ctx.fillRect(leaf.x0, leaf.y0, w, h);
      ctx.globalAlpha = 1;
      if (dimmed) continue;

      if (selectedKey && keyPathOf(leaf) === selectedKey) {
        ctx.strokeStyle = outline;
        ctx.lineWidth = 2 * inv;
        ctx.strokeRect(leaf.x0 + inv, leaf.y0 + inv, w - 2 * inv, h - 2 * inv);
      }

      if (w * s > 60 && h * s > 26) {
        // Clip so text can never bleed past its own tile into a neighbor,
        // which is what made high zoom look broken.
        ctx.save();
        ctx.beginPath();
        ctx.rect(leaf.x0, leaf.y0, w, h);
        ctx.clip();
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.font = `${11 * inv}px ui-sans-serif, system-ui`;
        ctx.fillText(
          ellipsize(ctx, d.label || "(no subject)", w - 10 * inv),
          leaf.x0 + 5 * inv,
          leaf.y0 + 14 * inv,
        );
        if (h * s > 40) {
          ctx.fillStyle = "rgba(255,255,255,0.55)";
          ctx.font = `${10 * inv}px ui-sans-serif, system-ui`;
          ctx.fillText(formatBytes(d.size), leaf.x0 + 5 * inv, leaf.y0 + 27 * inv);
        }
        ctx.restore();
      }
    }

    // Selected group outline
    if (selectedKey) {
      for (const g of root.children ?? []) {
        if (keyPathOf(g) === selectedKey) {
          ctx.strokeStyle = outline;
          ctx.lineWidth = 2 / s;
          ctx.strokeRect(g.x0 + 1 / s, g.y0 + 1 / s, g.x1 - g.x0 - 2 / s, g.y1 - g.y0 - 2 / s);
        }
      }
    }
  }, [root, dims, selectedKey, highlightCat, theme, zoom]);

  function hitTest(x: number, y: number): RectNode | null {
    if (!root) return null;
    let hit: RectNode | null = null;
    for (const n of root.descendants()) {
      if (n.depth === 0) continue;
      if (x >= n.x0 && x <= n.x1 && y >= n.y0 && y <= n.y1) {
        if (!hit || n.depth > hit.depth) hit = n;
      }
    }
    return hit;
  }

  /** Screen-space canvas offset plus the world-space point under it. */
  function pointAt(e: React.MouseEvent) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const wx = (sx - zoom.x) / zoom.scale;
    const wy = (sy - zoom.y) / zoom.scale;
    return { sx, sy, wx, wy };
  }

  const atMinZoom = zoom.scale <= MIN_SCALE;
  const atMaxZoom = zoom.scale >= MAX_SCALE;
  const isDefaultZoom = zoom.scale === 1 && zoom.x === 0 && zoom.y === 0;

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        style={{ width: dims.w, height: dims.h, cursor: isPanning ? "grabbing" : zoom.scale > 1 ? "grab" : "default" }}
        onMouseDown={(e) => {
          dragState.current = {
            startX: e.clientX,
            startY: e.clientY,
            origX: zoom.x,
            origY: zoom.y,
            dragging: false,
          };
        }}
        onMouseMove={(e) => {
          if (dragState.current?.dragging) return;
          const { wx, wy, sx, sy } = pointAt(e);
          const n = hitTest(wx, wy);
          setHover(n ? { node: n, x: sx, y: sy } : null);
        }}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          const { wx, wy } = pointAt(e);
          const n = hitTest(wx, wy);
          // Clicking a leaf selects it; clicking a group header selects group.
          onSelect(n && n.depth > 0 ? topLevelAncestorOrSelf(n) : null);
        }}
        onDoubleClick={(e) => {
          const { wx, wy } = pointAt(e);
          const n = hitTest(wx, wy);
          if (!n) return;
          // A message tile opens the detail drawer; a group drills in.
          if (n.data.key.startsWith("m:")) {
            onOpenMessage(Number(n.data.key.slice(2)));
            return;
          }
          const top = topAncestor(n);
          if (top && !top.data.leaf && top.data.key !== "__other__") onDrill(top.data);
        }}
      />
      {hover && (
        <div
          className="pointer-events-none absolute z-10 max-w-xs rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-lg"
          style={{
            left: Math.min(hover.x + 12, Math.max(dims.w - 240, 0)),
            top: Math.min(hover.y + 12, Math.max(dims.h - 70, 0)),
          }}
        >
          <div className="font-medium text-ink">{hover.node.data.label || "(no subject)"}</div>
          {hover.node.data.sublabel && <div className="text-faint">{hover.node.data.sublabel}</div>}
          <div className="text-muted">
            {formatBytes(hover.node.data.size)}
            {hover.node.data.count > 1 ? ` · ${hover.node.data.count.toLocaleString()} messages` : ""}
          </div>
        </div>
      )}
      <div className="absolute right-2 bottom-2 z-10 flex items-center gap-0.5 rounded-md border border-line bg-surface/95 p-0.5 shadow-lg">
        <button
          onClick={() => zoomAt(dims.w / 2, dims.h / 2, 1 / 1.4)}
          disabled={atMinZoom}
          className="rounded px-2 py-1 text-sm text-ink hover:bg-raised disabled:opacity-35"
          aria-label="Zoom out"
          title="Zoom out"
        >
          −
        </button>
        <button
          onClick={() => setZoom(IDENTITY)}
          disabled={isDefaultZoom}
          className="rounded px-2 py-1 text-[11px] tabular-nums text-muted hover:bg-raised hover:text-ink disabled:opacity-35"
          title="Reset zoom"
        >
          {Math.round(zoom.scale * 100)}%
        </button>
        <button
          onClick={() => zoomAt(dims.w / 2, dims.h / 2, 1.4)}
          disabled={atMaxZoom}
          className="rounded px-2 py-1 text-sm text-ink hover:bg-raised disabled:opacity-35"
          aria-label="Zoom in"
          title="Zoom in"
        >
          +
        </button>
      </div>
    </div>
  );
}

/** Selection acts on top-level children (what the drill path addresses). */
function topAncestor(n: RectNode): RectNode {
  let cur = n;
  while (cur.depth > 1 && cur.parent) cur = cur.parent;
  return cur;
}

function topLevelAncestorOrSelf(n: RectNode): TreeNode {
  // Message leaves (keys starting m:) are individually addressable even at depth 2.
  if (n.data.key.startsWith("m:")) return n.data;
  return topAncestor(n).data;
}

function keyPathOf(n: RectNode): string {
  if (n.data.key.startsWith("m:")) return n.data.key;
  return topAncestor(n).data.key;
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > max) t = t.slice(0, -1);
  return t + "…";
}

function shade(color: string, amt: number): string {
  // Supports #rrggbb and hsl(...) inputs.
  if (color.startsWith("hsl")) {
    const m = color.match(/hsl\((\d+)\s+(\d+)%\s+(\d+)%\)/);
    if (m) {
      const l = Math.max(8, Math.min(92, parseInt(m[3]) + amt / 3));
      return `hsl(${m[1]} ${m[2]}% ${l}%)`;
    }
    return color;
  }
  const num = parseInt(color.slice(1), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const r = clamp((num >> 16) + amt);
  const g = clamp(((num >> 8) & 0xff) + amt);
  const b = clamp((num & 0xff) + amt);
  return `rgb(${r},${g},${b})`;
}
