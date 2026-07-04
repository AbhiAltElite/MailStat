import type { TypeStat } from "../lib/api";
import { CATEGORY_LABELS, colorFor } from "../lib/colors";
import { formatBytes } from "../lib/format";

interface Props {
  stats: TypeStat[];
  highlight: string | null;
  onHighlight: (cat: string | null) => void;
}

/** Content types by weight, the email analogue of a file extension list. */
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
            className={`flex items-center gap-2 rounded-md px-2 py-1 text-left ${
              active ? "bg-raised" : "hover:bg-raised"
            }`}
            title="Highlight in treemap"
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: colorFor(s.cat) }}
            />
            <span className="flex-1 truncate text-xs text-ink">
              {CATEGORY_LABELS[s.cat] ?? s.cat}
            </span>
            <span className="text-[11px] tabular-nums text-muted">{formatBytes(s.size)}</span>
            <span className="w-11 shrink-0 text-right text-[10px] tabular-nums text-faint">
              {((s.size / total) * 100).toFixed(1)}%
            </span>
          </button>
        );
      })}
    </div>
  );
}
