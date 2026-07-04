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
  onOpenMessage: (id: number) => void;
  loading?: boolean;
}

export default function TopPanel(props: Props) {
  const { tab, onTab, loading } = props;
  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 border-b border-line px-2 pt-2" role="tablist">
        {(
          [
            ["senders", "Top senders"],
            ["largest", "Largest"],
            ["unsubscribe", "Unsubscribe"],
          ] as [TopTab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => onTab(id)}
            className={`rounded-t-md px-3 py-1.5 text-xs ${
              tab === id ? "bg-raised font-medium text-ink" : "text-muted hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {loading ? (
          <div className="flex flex-col gap-2 p-2" aria-busy="true">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-7 animate-pulse rounded-md bg-raised" />
            ))}
          </div>
        ) : (
          <>
            {tab === "senders" && <Senders {...props} />}
            {tab === "largest" && <Largest {...props} />}
            {tab === "unsubscribe" && <Unsubscribe {...props} />}
          </>
        )}
      </div>
    </div>
  );
}

function Senders({ senders, checkedSenders, onToggleSender, onFocusSender }: Props) {
  const max = Math.max(...senders.map((s) => s.size), 1);
  return (
    <table className="w-full text-left text-xs">
      <tbody>
        {senders.map((s) => (
          <tr key={s.email} className="hover:bg-raised">
            <td className="w-6 px-1 py-1 align-middle">
              <input
                type="checkbox"
                checked={checkedSenders.has(s.email)}
                onChange={() => onToggleSender(s.email)}
                className="accent-(--accent)"
                aria-label={`Select ${s.name}`}
              />
            </td>
            <td
              className="max-w-0 cursor-pointer py-1 pr-2"
              onClick={() => onFocusSender(s.email, s.name)}
              title="Show this sender in the treemap"
            >
              <div className="truncate text-ink">{s.name}</div>
              <div className="mt-0.5 h-1 rounded-full bg-line">
                <div
                  className="h-1 rounded-full bg-accent"
                  style={{ width: `${Math.max((s.size / max) * 100, 1)}%` }}
                />
              </div>
            </td>
            <td className="w-16 py-1 text-right tabular-nums text-muted">{formatBytes(s.size)}</td>
            <td className="w-14 py-1 pr-1 text-right tabular-nums text-faint">
              {formatCount(s.count)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Largest({ largest, checkedMessages, onToggleMessage, onOpenMessage }: Props) {
  return (
    <table className="w-full text-left text-xs">
      <tbody>
        {largest.map((m) => (
          <tr key={m.id} className="hover:bg-raised">
            <td className="w-6 px-1 py-1 align-middle">
              <input
                type="checkbox"
                checked={checkedMessages.has(m.id)}
                onChange={() => onToggleMessage(m.id)}
                className="accent-(--accent)"
                aria-label={`Select ${m.subject || "message"}`}
              />
            </td>
            <td className="w-3 py-1">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: colorFor(m.cat) }}
              />
            </td>
            <td
              className="max-w-0 cursor-pointer py-1 pr-2 pl-1.5"
              onClick={() => onOpenMessage(m.id)}
              title="Open details"
            >
              <div className="truncate text-ink">{m.subject || "(no subject)"}</div>
              <div className="truncate text-[11px] text-faint">
                {m.from_name || m.from_email} · {m.folder} · {formatDate(m.date)}
              </div>
            </td>
            <td className="w-16 py-1 pr-1 text-right tabular-nums text-muted">
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
      <p className="p-3 text-xs text-faint">
        No senders with a List-Unsubscribe header found yet.
      </p>
    );
  }
  return (
    <table className="w-full text-left text-xs">
      <tbody>
        {unsubscribe.map((s) => (
          <tr key={s.email} className="hover:bg-raised">
            <td className="w-6 px-1 py-1 align-middle">
              <input
                type="checkbox"
                checked={checkedSenders.has(s.email)}
                onChange={() => onToggleSender(s.email)}
                className="accent-(--accent)"
                aria-label={`Select ${s.name}`}
              />
            </td>
            <td className="max-w-0 py-1 pr-2">
              <div className="truncate text-ink">{s.name}</div>
              <div className="truncate text-[11px] text-faint">
                {formatCount(s.count)} messages · {formatBytes(s.size)}
              </div>
            </td>
            <td className="w-24 py-1 pr-1 text-right">
              {s.unsubscribe && (
                <button
                  onClick={() => onOpenUnsubscribe(s.unsubscribe!)}
                  className="rounded-md border border-line px-2 py-0.5 text-[11px] text-muted hover:bg-raised hover:text-ink"
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
