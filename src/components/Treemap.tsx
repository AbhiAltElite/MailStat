import { useEffect, useMemo, useRef, useState } from "react";
import { hierarchy, treemap, treemapSquarify } from "d3-hierarchy";
import type { HierarchyRectangularNode } from "d3-hierarchy";
import type { TreeNode } from "../lib/api";
import { colorFor, hashColor } from "../lib/colors";
import { formatBytes } from "../lib/format";

interface Props {
  nodes: TreeNode[];
  /** key-path of the selected tile relative to current drill position */
  selectedKey: string | null;
  onSelect: (node: TreeNode | null) => void;
  onDrill: (node: TreeNode) => void;
  highlightCat: string | null;
}

interface Datum extends TreeNode {
  isRoot?: boolean;
}

type RectNode = HierarchyRectangularNode<Datum>;

export default function Treemap({ nodes, selectedKey, onSelect, onDrill, highlightCat }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<{ node: RectNode; x: number; y: number } | null>(null);

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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !root) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = dims.w * dpr;
    canvas.height = dims.h * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, dims.w, dims.h);

    // Group headers (depth 1 with children)
    for (const g of root.children ?? []) {
      if (!g.children) continue;
      const w = g.x1 - g.x0;
      const h = g.y1 - g.y0;
      ctx.fillStyle = "#1b2430";
      ctx.fillRect(g.x0, g.y0, w, h);
      if (w > 40 && h > 18) {
        ctx.fillStyle = "#9fb2c8";
        ctx.font = "600 10px ui-sans-serif, system-ui";
        const label = `${g.data.label}  ·  ${formatBytes(g.data.size)}`;
        ctx.fillText(ellipsize(ctx, label, w - 10), g.x0 + 5, g.y0 + 11.5);
      }
    }

    // Leaf tiles with a cushion-ish vertical gradient
    for (const leaf of root.leaves()) {
      if (leaf.depth === 0) continue;
      const w = leaf.x1 - leaf.x0;
      const h = leaf.y1 - leaf.y0;
      if (w < 0.5 || h < 0.5) continue;
      const d = leaf.data;
      const base =
        d.cat === "mixed" ? hashColor(d.key + d.label) : colorFor(d.cat);
      const dimmed = highlightCat && d.cat !== highlightCat;
      const grad = ctx.createLinearGradient(leaf.x0, leaf.y0, leaf.x0, leaf.y1);
      grad.addColorStop(0, shade(base, dimmed ? -55 : 18));
      grad.addColorStop(1, shade(base, dimmed ? -70 : -22));
      ctx.fillStyle = grad;
      ctx.fillRect(leaf.x0, leaf.y0, w, h);

      if (selectedKey && keyPathOf(leaf) === selectedKey) {
        ctx.strokeStyle = "#ffd166";
        ctx.lineWidth = 2;
        ctx.strokeRect(leaf.x0 + 1, leaf.y0 + 1, w - 2, h - 2);
      }

      if (w > 60 && h > 26) {
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.font = "11px ui-sans-serif, system-ui";
        ctx.fillText(ellipsize(ctx, d.label || "(no subject)", w - 10), leaf.x0 + 5, leaf.y0 + 14);
        if (h > 40) {
          ctx.fillStyle = "rgba(255,255,255,0.55)";
          ctx.font = "10px ui-sans-serif, system-ui";
          ctx.fillText(formatBytes(d.size), leaf.x0 + 5, leaf.y0 + 27);
        }
      }
    }

    // Selected group outline
    if (selectedKey) {
      for (const g of root.children ?? []) {
        if (keyPathOf(g) === selectedKey) {
          ctx.strokeStyle = "#ffd166";
          ctx.lineWidth = 2;
          ctx.strokeRect(g.x0 + 1, g.y0 + 1, g.x1 - g.x0 - 2, g.y1 - g.y0 - 2);
        }
      }
    }
  }, [root, dims, selectedKey, highlightCat]);

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

  function nodeAt(e: React.MouseEvent): RectNode | null {
    const rect = canvasRef.current!.getBoundingClientRect();
    return hitTest(e.clientX - rect.left, e.clientY - rect.top);
  }

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        style={{ width: dims.w, height: dims.h }}
        onMouseMove={(e) => {
          const n = nodeAt(e);
          const rect = canvasRef.current!.getBoundingClientRect();
          setHover(n ? { node: n, x: e.clientX - rect.left, y: e.clientY - rect.top } : null);
        }}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const n = nodeAt(e);
          // Clicking a leaf selects it; clicking a group header selects group.
          onSelect(n && n.depth > 0 ? topLevelAncestorOrSelf(n) : null);
        }}
        onDoubleClick={(e) => {
          const n = nodeAt(e);
          if (!n) return;
          const top = topAncestor(n);
          if (top && !top.data.leaf && top.data.key !== "__other__") onDrill(top.data);
        }}
      />
      {hover && (
        <div
          className="pointer-events-none absolute z-10 max-w-xs rounded border border-slate-600 bg-slate-900/95 px-2.5 py-1.5 text-xs shadow-lg"
          style={{
            left: Math.min(hover.x + 12, Math.max(dims.w - 240, 0)),
            top: Math.min(hover.y + 12, Math.max(dims.h - 70, 0)),
          }}
        >
          <div className="font-medium text-slate-100">{hover.node.data.label || "(no subject)"}</div>
          {hover.node.data.sublabel && (
            <div className="text-slate-400">{hover.node.data.sublabel}</div>
          )}
          <div className="text-slate-300">
            {formatBytes(hover.node.data.size)}
            {hover.node.data.count > 1 ? ` · ${hover.node.data.count.toLocaleString()} messages` : ""}
          </div>
        </div>
      )}
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
