import { formatBytes, formatCount } from "../lib/format";

export interface PendingAction {
  action: "trash" | "archive" | "delete";
  ids: number[];
  bytes: number;
  what: string;
}

const VERBS: Record<PendingAction["action"], { title: string; button: string; danger: boolean }> = {
  trash: { title: "Move to Trash", button: "Move to Trash", danger: false },
  archive: { title: "Archive", button: "Archive", danger: false },
  delete: { title: "Delete permanently", button: "Delete forever", danger: true },
};

interface Props {
  pending: PendingAction;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({ pending, busy, onConfirm, onCancel }: Props) {
  const v = VERBS[pending.action];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div
        role="alertdialog"
        aria-label={v.title}
        className="w-95 rounded-lg border border-line bg-surface p-5 shadow-2xl"
      >
        <h2 className="text-[15px] font-semibold text-ink">{v.title}</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-ink">
          {formatCount(pending.ids.length)} message{pending.ids.length === 1 ? "" : "s"} ·{" "}
          {formatBytes(pending.bytes)}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted">{pending.what}</p>
        {pending.action === "delete" && (
          <p className="mt-3 rounded-md bg-danger-surface px-2.5 py-1.5 text-xs text-danger">
            This cannot be undone. Messages are removed from the server.
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-[13px] text-muted hover:bg-raised hover:text-ink"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`rounded-md px-4 py-1.5 text-[13px] font-medium text-white disabled:opacity-60 ${
              v.danger ? "bg-danger hover:opacity-90" : "bg-accent hover:bg-accent-strong"
            }`}
          >
            {busy ? "Working" : v.button}
          </button>
        </div>
      </div>
    </div>
  );
}
