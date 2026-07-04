import type { FolderInfo } from "../lib/api";
import { formatBytes, formatCount } from "../lib/format";

interface Props {
  folders: FolderInfo[];
  selectedId: number | null;
  onSelect: (f: FolderInfo | null) => void;
  loading?: boolean;
}

export default function FolderTree({ folders, selectedId, onSelect, loading }: Props) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2 px-2 py-1" aria-busy="true">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-8 animate-pulse rounded-md bg-raised" />
        ))}
      </div>
    );
  }
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
            className={`rounded-md px-2 py-1.5 text-left ${
              active ? "bg-raised" : "hover:bg-raised"
            }`}
            title={f.path}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[13px] text-ink">
                {f.name}
                {f.special && (
                  <span className="ml-1.5 text-[10px] tracking-wide text-faint uppercase">
                    {f.special}
                  </span>
                )}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-muted">
                {formatBytes(f.total_size)}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1 flex-1 rounded-full bg-line">
                <div
                  className="h-1 rounded-full bg-accent"
                  style={{ width: `${Math.max(pct, 0.5)}%` }}
                />
              </div>
              <span className="w-14 shrink-0 text-right text-[10px] tabular-nums text-faint">
                {formatCount(f.msg_count)}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
