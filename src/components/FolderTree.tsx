import type { FolderInfo } from "../lib/api";
import { formatBytes, formatCount } from "../lib/format";

interface Props {
  folders: FolderInfo[];
  selectedId: number | null;
  onSelect: (f: FolderInfo | null) => void;
}

export default function FolderTree({ folders, selectedId, onSelect }: Props) {
  const total = Math.max(
    folders.reduce((a, f) => a + f.total_size, 0),
    1,
  );
  return (
    <div className="flex flex-col gap-0.5">
      {folders.map((f) => {
        const pct = (f.total_size / total) * 100;
        const active = f.id === selectedId;
        return (
          <button
            key={f.id}
            onClick={() => onSelect(active ? null : f)}
            className={`group rounded px-2 py-1.5 text-left transition-colors ${
              active ? "bg-sky-900/60" : "hover:bg-slate-800/70"
            }`}
            title={f.path}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[13px] text-slate-200">
                {f.name}
                {f.special && (
                  <span className="ml-1.5 text-[10px] uppercase tracking-wide text-slate-500">
                    {f.special}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-slate-400">
                {formatBytes(f.total_size)}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1 flex-1 rounded bg-slate-800">
                <div
                  className="h-1 rounded bg-sky-600"
                  style={{ width: `${Math.max(pct, 0.5)}%` }}
                />
              </div>
              <span className="w-14 shrink-0 text-right text-[10px] tabular-nums text-slate-500">
                {formatCount(f.msg_count)}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
