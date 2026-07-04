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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[380px] rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <h2 className="text-[15px] font-semibold text-slate-100">{v.title}</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-slate-300">
          {formatCount(pending.ids.length)} message{pending.ids.length === 1 ? "" : "s"} ·{" "}
          {formatBytes(pending.bytes)}
          <br />
          <span className="text-slate-400">{pending.what}</span>
        </p>
        {pending.action === "delete" && (
          <p className="mt-2 rounded border border-red-900 bg-red-950/60 px-2.5 py-1.5 text-[12px] text-red-300">
            This cannot be undone — messages are expunged from the server.
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded px-3 py-1.5 text-[13px] text-slate-300 hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`rounded px-4 py-1.5 text-[13px] font-medium text-white disabled:opacity-50 ${
              v.danger ? "bg-red-700 hover:bg-red-600" : "bg-sky-700 hover:bg-sky-600"
            }`}
          >
            {busy ? "Working…" : v.button}
          </button>
        </div>
      </div>
    </div>
  );
}
