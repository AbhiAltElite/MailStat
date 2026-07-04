import type { MessageRow, SenderStat } from "../lib/api";
import { formatBytes, formatCount, formatDate } from "../lib/format";
import { colorFor } from "../lib/colors";

export type TopTab = "senders" | "largest" | "unsubscribe";

interface Props {
  tab: TopTab;
  onTab: (t: TopTab) => void;
  senders: SenderStat[];
  largest: MessageRow[];
  unsubscribe: SenderStat[];
  checkedSenders: Set<string>;
  onToggleSender: (email: string) => void;
  checkedMessages: Set<number>;
  onToggleMessage: (id: number) => void;
  onOpenUnsubscribe: (target: string) => void;
  onFocusSender: (email: string, name: string) => void;
}

export default function TopPanel(props: Props) {
  const { tab, onTab } = props;
  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 border-b border-slate-800 px-2 pt-2">
        {(
          [
            ["senders", "Top senders"],
            ["largest", "Largest"],
            ["unsubscribe", "Unsubscribe"],
          ] as [TopTab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => onTab(id)}
            className={`rounded-t px-3 py-1.5 text-[12px] ${
              tab === id
                ? "bg-slate-800 text-slate-100"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {tab === "senders" && <Senders {...props} />}
        {tab === "largest" && <Largest {...props} />}
        {tab === "unsubscribe" && <Unsubscribe {...props} />}
      </div>
    </div>
  );
}

function Senders({ senders, checkedSenders, onToggleSender, onFocusSender }: Props) {
  const max = Math.max(...senders.map((s) => s.size), 1);
  return (
    <table className="w-full text-left text-[12px]">
      <tbody>
        {senders.map((s) => (
          <tr key={s.email} className="group hover:bg-slate-800/60">
            <td className="w-6 px-1 py-1 align-middle">
              <input
                type="checkbox"
                checked={checkedSenders.has(s.email)}
                onChange={() => onToggleSender(s.email)}
                className="accent-sky-600"
              />
            </td>
            <td className="max-w-0 cursor-pointer py-1 pr-2" onClick={() => onFocusSender(s.email, s.name)}>
              <div className="truncate text-slate-200" title={s.email}>
                {s.name}
              </div>
              <div className="mt-0.5 h-1 rounded bg-slate-800">
                <div
                  className="h-1 rounded bg-teal-600"
                  style={{ width: `${Math.max((s.size / max) * 100, 1)}%` }}
                />
              </div>
            </td>
            <td className="w-16 py-1 text-right tabular-nums text-slate-300">
              {formatBytes(s.size)}
            </td>
            <td className="w-14 py-1 pr-1 text-right tabular-nums text-slate-500">
              {formatCount(s.count)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Largest({ largest, checkedMessages, onToggleMessage }: Props) {
  return (
    <table className="w-full text-left text-[12px]">
      <tbody>
        {largest.map((m) => (
          <tr key={m.id} className="hover:bg-slate-800/60">
            <td className="w-6 px-1 py-1 align-middle">
              <input
                type="checkbox"
                checked={checkedMessages.has(m.id)}
                onChange={() => onToggleMessage(m.id)}
                className="accent-sky-600"
              />
            </td>
            <td className="w-3 py-1">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: colorFor(m.cat) }}
              />
            </td>
            <td className="max-w-0 py-1 pl-1.5 pr-2">
              <div className="truncate text-slate-200" title={m.subject}>
                {m.subject || "(no subject)"}
              </div>
              <div className="truncate text-[11px] text-slate-500">
                {m.from_name || m.from_email} · {m.folder} · {formatDate(m.date)}
              </div>
            </td>
            <td className="w-16 py-1 pr-1 text-right tabular-nums text-slate-300">
              {formatBytes(m.size)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Unsubscribe({ unsubscribe, checkedSenders, onToggleSender, onOpenUnsubscribe }: Props) {
  if (!unsubscribe.length) {
    return (
      <p className="p-3 text-[12px] text-slate-500">
        No senders with a List-Unsubscribe header found yet.
      </p>
    );
  }
  return (
    <table className="w-full text-left text-[12px]">
      <tbody>
        {unsubscribe.map((s) => (
          <tr key={s.email} className="hover:bg-slate-800/60">
            <td className="w-6 px-1 py-1 align-middle">
              <input
                type="checkbox"
                checked={checkedSenders.has(s.email)}
                onChange={() => onToggleSender(s.email)}
                className="accent-sky-600"
              />
            </td>
            <td className="max-w-0 py-1 pr-2">
              <div className="truncate text-slate-200" title={s.email}>
                {s.name}
              </div>
              <div className="truncate text-[11px] text-slate-500">
                {formatCount(s.count)} messages · {formatBytes(s.size)}
              </div>
            </td>
            <td className="w-24 py-1 pr-1 text-right">
              {s.unsubscribe && (
                <button
                  onClick={() => onOpenUnsubscribe(s.unsubscribe!)}
                  className="rounded bg-slate-700 px-2 py-0.5 text-[11px] text-slate-200 hover:bg-slate-600"
                >
                  Unsubscribe
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
