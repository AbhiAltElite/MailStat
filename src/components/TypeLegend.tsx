import type { TypeStat } from "../lib/api";
import { CATEGORY_LABELS, colorFor } from "../lib/colors";
import { formatBytes, formatCount } from "../lib/format";

interface Props {
  stats: TypeStat[];
  highlight: string | null;
  onHighlight: (cat: string | null) => void;
}

/** The WinDirStat "extension list": what kinds of content weigh the most. */
export default function TypeLegend({ stats, highlight, onHighlight }: Props) {
  const total = Math.max(
    stats.reduce((a, s) => a + s.size, 0),
    1,
  );
  return (
    <div className="flex flex-col gap-0.5">
      {stats.map((s) => {
        const active = highlight === s.cat;
        return (
          <button
            key={s.cat}
            onClick={() => onHighlight(active ? null : s.cat)}
            className={`flex items-center gap-2 rounded px-2 py-1 text-left ${
              active ? "bg-slate-700/70" : "hover:bg-slate-800/70"
            }`}
          >
            <span
              className="h-3 w-3 shrink-0 rounded-sm"
              style={{ background: colorFor(s.cat) }}
            />
            <span className="flex-1 truncate text-[12px] text-slate-200">
              {CATEGORY_LABELS[s.cat] ?? s.cat}
            </span>
            <span className="text-[11px] tabular-nums text-slate-400">
              {formatBytes(s.size)}
            </span>
            <span className="w-12 shrink-0 text-right text-[10px] tabular-nums text-slate-500">
              {((s.size / total) * 100).toFixed(1)}%
            </span>
            <span className="w-14 shrink-0 text-right text-[10px] tabular-nums text-slate-600">
              {formatCount(s.count)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
