import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  api,
  isTauri,
  type Account,
  type FolderInfo,
  type MessageDetail as Detail,
  type MessageRow,
  type NewAccount,
  type PathSeg,
  type ScanProgress,
  type SenderStat,
  type TreeNode,
  type TypeStat,
} from "./lib/api";
import { formatBytes, formatCount } from "./lib/format";
import Treemap from "./components/Treemap";
import FolderTree from "./components/FolderTree";
import TypeLegend from "./components/TypeLegend";
import TopPanel, { type TopTab } from "./components/TopPanel";
import AddAccountModal from "./components/AddAccountModal";
import ConfirmDialog, { type PendingAction } from "./components/ConfirmDialog";
import MessageDetail from "./components/MessageDetail";

const GROUPINGS: { id: string; label: string; dims: string[] }[] = [
  { id: "folder-sender", label: "Folder, then sender", dims: ["folder", "sender"] },
  { id: "sender", label: "Sender", dims: ["sender"] },
  { id: "year-sender", label: "Year, then sender", dims: ["year", "sender"] },
  { id: "type-sender", label: "Type, then sender", dims: ["type", "sender"] },
];

type Theme = "light" | "dark";

function initialTheme(): Theme {
  const stored = localStorage.getItem("mailstat-theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [grouping, setGrouping] = useState(GROUPINGS[0]);
  const [drillPath, setDrillPath] = useState<PathSeg[]>([]);
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [typeStats, setTypeStats] = useState<TypeStat[]>([]);
  const [senders, setSenders] = useState<SenderStat[]>([]);
  const [largest, setLargest] = useState<MessageRow[]>([]);
  const [unsub, setUnsub] = useState<SenderStat[]>([]);
  const [tab, setTab] = useState<TopTab>("senders");
  const [highlightCat, setHighlightCat] = useState<string | null>(null);
  const [selected, setSelected] = useState<TreeNode | null>(null);
  const [checkedSenders, setCheckedSenders] = useState<Set<string>>(new Set());
  const [checkedMessages, setCheckedMessages] = useState<Set<number>>(new Set());
  const [scan, setScan] = useState<ScanProgress | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState<Account | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const account = accounts.find((a) => a.id === accountId) ?? null;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("mailstat-theme", theme);
  }, [theme]);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 5000);
  }, []);

  const refreshAccounts = useCallback(async () => {
    const list = await api.listAccounts();
    setAccounts(list);
    setAccountId((cur) => {
      if (cur && list.some((a) => a.id === cur)) return cur;
      // Prefer a real account over the demo mailbox when nothing is
      // selected yet, so a leftover demo account never eclipses real mail
      // after a restart.
      const preferred = list.find((a) => a.kind !== "demo") ?? list[0];
      return preferred?.id ?? null;
    });
  }, []);

  const refreshData = useCallback(async () => {
    if (accountId == null) return;
    setDataLoading(true);
    // allSettled so one failing query (for example an unusual header on a
    // single real-world message) can't blank out every other panel.
    const [f, t, s, l, u] = await Promise.allSettled([
      api.getFolders(accountId),
      api.typeStats(accountId),
      api.topSenders(accountId, 200),
      api.largestMessages(accountId, 200),
      api.unsubscribeCandidates(accountId, 200),
    ]);
    if (f.status === "fulfilled") setFolders(f.value);
    if (t.status === "fulfilled") setTypeStats(t.value);
    if (s.status === "fulfilled") setSenders(s.value);
    if (l.status === "fulfilled") setLargest(l.value);
    if (u.status === "fulfilled") setUnsub(u.value);
    const failed = [f, t, s, l, u].filter((r) => r.status === "rejected");
    if (failed.length) {
      notify(`Some panels failed to load: ${failed.map((r) => r.reason).join(", ")}`);
    }
    setDataLoading(false);
  }, [accountId, notify]);

  const refreshTreemap = useCallback(async () => {
    if (accountId == null) return;
    setNodes(await api.getTreemap(accountId, grouping.dims, drillPath));
  }, [accountId, grouping, drillPath]);

  useEffect(() => {
    refreshAccounts();
  }, [refreshAccounts]);
  useEffect(() => {
    setDrillPath([]);
    setSelected(null);
    setCheckedSenders(new Set());
    setCheckedMessages(new Set());
    setDetailId(null);
  }, [accountId, grouping.id]);
  useEffect(() => {
    refreshData();
  }, [refreshData]);
  useEffect(() => {
    refreshTreemap();
  }, [refreshTreemap]);

  // Scan lifecycle events from the Rust side. Registered once: routing
  // through refs (rather than depending on refreshData/refreshTreemap
  // directly) keeps this subscription alive across drill-downs and grouping
  // changes, which would otherwise tear it down and briefly leave no
  // listener attached, dropping a scan-done event that lands in that gap.
  const liveRefs = useRef({ notify, refreshAccounts, refreshData, refreshTreemap });
  liveRefs.current = { notify, refreshAccounts, refreshData, refreshTreemap };

  useEffect(() => {
    if (!isTauri) return;
    const unlisteners: Promise<() => void>[] = [
      listen<ScanProgress>("scan-progress", (e) => setScan(e.payload)),
      listen<number>("scan-done", async () => {
        setScan(null);
        liveRefs.current.notify("Scan complete");
        await liveRefs.current.refreshAccounts();
        await liveRefs.current.refreshData();
        await liveRefs.current.refreshTreemap();
      }),
      listen<number>("scan-cancelled", () => {
        setScan(null);
        liveRefs.current.notify("Scan cancelled");
      }),
      listen<[number, string]>("scan-error", (e) => {
        setScan(null);
        liveRefs.current.notify(`Scan failed: ${e.payload[1]}`);
      }),
    ];
    return () => {
      unlisteners.forEach((u) => u.then((f) => f()));
    };
  }, []);

  const startDemo = async () => {
    await api.seedDemo();
    await refreshAccounts();
  };

  const addAccount = async (cfg: NewAccount) => {
    const id = await api.addAccount(cfg);
    await refreshAccounts();
    setAccountId(id);
    await api.startScan(id);
  };

  const drillTo = (node: TreeNode) => {
    const dim = grouping.dims[drillPath.length];
    if (!dim) return;
    setSelected(null);
    setDrillPath([...drillPath, { dim, key: node.key, label: node.label }]);
  };

  const focusSender = (email: string, name: string) => {
    setDetailId(null);
    setGrouping(GROUPINGS[1]);
    setTimeout(() => setDrillPath([{ dim: "sender", key: email, label: name }]), 0);
  };

  const folderSelect = (f: FolderInfo | null) => {
    setSelected(null);
    if (!f) {
      setDrillPath([]);
      return;
    }
    if (grouping.dims[0] === "folder") {
      setDrillPath([{ dim: "folder", key: String(f.id), label: f.name }]);
    } else {
      setGrouping(GROUPINGS[0]);
      setTimeout(() => setDrillPath([{ dim: "folder", key: String(f.id), label: f.name }]), 0);
    }
  };

  // Cleanup actions -----------------------------------------------------------

  const requestNodeAction = async (action: PendingAction["action"]) => {
    if (accountId == null || !selected || selected.key === "__other__") return;
    const dim = selected.key.startsWith("m:") ? "msg" : grouping.dims[drillPath.length];
    const path = [...drillPath, { dim, key: selected.key }];
    const ids = await api.idsForPath(accountId, path);
    setPending({ action, ids, bytes: selected.size, what: selected.label });
  };

  const requestCheckedAction = async (action: PendingAction["action"]) => {
    if (accountId == null) return;
    let ids: number[] = [];
    let what = "";
    if (checkedSenders.size) {
      ids = await api.idsForSenders(accountId, [...checkedSenders]);
      what = `${checkedSenders.size} sender${checkedSenders.size > 1 ? "s" : ""}`;
    }
    if (checkedMessages.size) {
      ids = [...new Set([...ids, ...checkedMessages])];
      what = what
        ? `${what} and ${checkedMessages.size} messages`
        : `${checkedMessages.size} messages`;
    }
    if (!ids.length) return;
    const msgBytes = largest
      .filter((m) => checkedMessages.has(m.id))
      .reduce((a, m) => a + m.size, 0);
    const senderBytes = senders
      .filter((s) => checkedSenders.has(s.email))
      .reduce((a, s) => a + s.size, 0);
    setPending({ action, ids, bytes: msgBytes + senderBytes, what });
  };

  const requestDetailAction = (action: PendingAction["action"], detail: Detail) => {
    setDetailId(null);
    setPending({
      action,
      ids: [detail.id],
      bytes: detail.size,
      what: detail.subject || "(no subject)",
    });
  };

  const confirmAction = async () => {
    if (!pending || accountId == null) return;
    setActionBusy(true);
    try {
      const res = await api.performAction(accountId, pending.ids, pending.action);
      const verb =
        pending.action === "archive"
          ? "Archived"
          : pending.action === "trash"
            ? "Moved to Trash"
            : "Deleted";
      notify(`${verb} ${formatCount(res.affected)} messages, ${formatBytes(res.bytes)}`);
      setPending(null);
      setSelected(null);
      setCheckedSenders(new Set());
      setCheckedMessages(new Set());
      await refreshAccounts();
      await refreshData();
      await refreshTreemap();
    } catch (e) {
      notify(`Action failed: ${e}`);
    } finally {
      setActionBusy(false);
    }
  };

  const confirmRemoveAccount = async () => {
    if (!removeConfirm) return;
    setRemoveBusy(true);
    try {
      await api.removeAccount(removeConfirm.id);
      setRemoveConfirm(null);
      setAccountId(null);
      await refreshAccounts();
    } catch (e) {
      notify(`Could not remove account: ${e}`);
    } finally {
      setRemoveBusy(false);
    }
  };

  const openUnsubscribe = async (raw: string) => {
    const targets = [...raw.matchAll(/<([^>]+)>/g)].map((m) => m[1]);
    const url = targets.find((t) => t.startsWith("http")) ?? targets[0];
    if (!url) return notify("No unsubscribe link in this header");
    if (isTauri) await openUrl(url);
    else window.open(url, "_blank");
  };

  const anyChecked = checkedSenders.size > 0 || checkedMessages.size > 0;
  const hasArchive = folders.some((f) => f.special === "archive");
  const selectionActive = (selected && selected.key !== "__other__") || anyChecked;

  const breadcrumb = useMemo(
    () =>
      [{ label: account?.label ?? "", path: [] as PathSeg[] }].concat(
        drillPath.map((seg, i) => ({
          label: seg.label ?? seg.key,
          path: drillPath.slice(0, i + 1),
        })),
      ),
    [drillPath, account],
  );

  const themeToggle = (
    <button
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className="rounded-md border border-line px-3 py-1 text-xs text-muted hover:bg-raised hover:text-ink"
      aria-label="Toggle color theme"
    >
      {theme === "dark" ? "Light theme" : "Dark theme"}
    </button>
  );

  // Welcome state -------------------------------------------------------------

  if (!accounts.length) {
    return (
      <div className="relative flex h-full flex-col items-center justify-center gap-5 px-6">
        <div className="absolute top-4 right-4">{themeToggle}</div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Mailstat</h1>
        <p className="max-w-md text-center text-sm leading-relaxed text-muted">
          Mailstat maps every message in your mailbox as a treemap, so the space hogs stand out
          at a glance. Connect over IMAP, find the heavy senders and attachments, and clean up
          in bulk. Scanning reads only sizes and headers; open any message to read its full
          content on demand, fetched live for that one message and never cached.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => setShowAdd(true)}
            className="rounded-md bg-accent px-5 py-2 text-sm font-medium text-white hover:bg-accent-strong"
          >
            Connect account
          </button>
          <button
            onClick={startDemo}
            className="rounded-md border border-line px-5 py-2 text-sm text-ink hover:bg-raised"
          >
            Try with demo data
          </button>
        </div>
        {showAdd && <AddAccountModal onClose={() => setShowAdd(false)} onAdd={addAccount} />}
        {toast && <Toast msg={toast} />}
      </div>
    );
  }

  // Main layout ----------------------------------------------------------------

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-3 py-2">
        <span className="text-sm font-semibold tracking-tight text-ink">Mailstat</span>
        <select
          value={accountId ?? undefined}
          onChange={(e) => setAccountId(Number(e.target.value))}
          className="rounded-md border border-line bg-canvas px-2 py-1 text-xs text-ink"
          aria-label="Account"
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label} · {formatBytes(a.total_size)}
            </option>
          ))}
        </select>
        <select
          value={grouping.id}
          onChange={(e) => setGrouping(GROUPINGS.find((g) => g.id === e.target.value)!)}
          className="rounded-md border border-line bg-canvas px-2 py-1 text-xs text-ink"
          aria-label="Group treemap by"
        >
          {GROUPINGS.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>

        {account?.kind === "imap" &&
          (scan ? (
            <button
              onClick={() => accountId != null && api.cancelScan(accountId)}
              className="rounded-md border border-line px-3 py-1 text-xs text-muted hover:bg-raised hover:text-ink"
            >
              Cancel scan
            </button>
          ) : (
            <button
              onClick={() =>
                accountId != null && api.startScan(accountId).catch((e) => notify(String(e)))
              }
              className="rounded-md border border-line px-3 py-1 text-xs text-muted hover:bg-raised hover:text-ink"
            >
              Rescan
            </button>
          ))}
        <button
          onClick={() => setShowAdd(true)}
          className="rounded-md border border-line px-3 py-1 text-xs text-muted hover:bg-raised hover:text-ink"
        >
          Add account
        </button>
        {account && (
          <button
            onClick={() => setRemoveConfirm(account)}
            className="rounded-md border border-line px-3 py-1 text-xs text-muted hover:bg-raised hover:text-ink"
          >
            Remove account
          </button>
        )}

        <div className="flex-1" />
        {account && (
          <span className="text-xs tabular-nums text-muted">
            {formatCount(account.msg_count)} messages · {formatBytes(account.total_size)}
          </span>
        )}
        {themeToggle}
      </header>

      {scan && (
        <div className="border-b border-line bg-surface px-3 py-1.5">
          <div className="flex items-center justify-between text-[11px] text-muted">
            <span>
              Scanning {scan.folder} ({scan.folder_index + 1} of {scan.folder_count}),{" "}
              {formatCount(Number(scan.messages_total))} messages,{" "}
              {formatBytes(Number(scan.bytes_total))} so far
            </span>
            <span>
              {scan.total_in_folder
                ? `${Math.round((scan.done_in_folder / scan.total_in_folder) * 100)}%`
                : ""}
            </span>
          </div>
          <div className="mt-1 h-1 rounded-full bg-raised">
            <div
              className="h-1 rounded-full bg-accent transition-all"
              style={{
                width: `${scan.total_in_folder ? (scan.done_in_folder / scan.total_in_folder) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="w-60 shrink-0 overflow-y-auto border-r border-line bg-surface p-2">
          <p className="px-2 pb-1 text-[11px] font-semibold tracking-wider text-faint uppercase">
            Folders
          </p>
          <FolderTree
            folders={folders}
            selectedId={drillPath[0]?.dim === "folder" ? Number(drillPath[0].key) : null}
            onSelect={folderSelect}
            loading={dataLoading && !folders.length}
          />
          <p className="px-2 pt-4 pb-1 text-[11px] font-semibold tracking-wider text-faint uppercase">
            Content types
          </p>
          <TypeLegend stats={typeStats} highlight={highlightCat} onHighlight={setHighlightCat} />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-1 border-b border-line bg-surface px-2 py-1 text-xs">
            {breadcrumb.map((b, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span className="text-faint">/</span>}
                <button
                  onClick={() => {
                    setSelected(null);
                    setDrillPath(b.path);
                  }}
                  className={`rounded-md px-1.5 py-0.5 ${
                    i === breadcrumb.length - 1
                      ? "font-medium text-ink"
                      : "text-muted hover:bg-raised hover:text-ink"
                  }`}
                >
                  {b.label}
                </button>
              </span>
            ))}
            <span className="ml-2 text-[11px] text-faint">
              Click to select. Double-click a group to drill in, a message to open it.
            </span>
          </div>
          <div className="min-h-0 flex-1">
            {nodes.length === 0 && dataLoading ? (
              <div className="grid h-full grid-cols-3 gap-1 p-1" aria-busy="true">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="animate-pulse rounded-md bg-raised" />
                ))}
              </div>
            ) : (
              <Treemap
                nodes={nodes}
                selectedKey={selected?.key ?? null}
                onSelect={setSelected}
                onDrill={drillTo}
                onOpenMessage={setDetailId}
                highlightCat={highlightCat}
                theme={theme}
              />
            )}
          </div>
        </main>

        <aside className="w-80 shrink-0 border-l border-line bg-surface">
          <TopPanel
            tab={tab}
            onTab={setTab}
            senders={senders}
            largest={largest}
            unsubscribe={unsub}
            checkedSenders={checkedSenders}
            onToggleSender={(email) =>
              setCheckedSenders((prev) => {
                const next = new Set(prev);
                if (next.has(email)) next.delete(email);
                else next.add(email);
                return next;
              })
            }
            checkedMessages={checkedMessages}
            onToggleMessage={(id) =>
              setCheckedMessages((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            onOpenUnsubscribe={openUnsubscribe}
            onFocusSender={focusSender}
            onOpenMessage={setDetailId}
            loading={dataLoading && !senders.length}
          />
        </aside>
      </div>

      {selectionActive && (
        <footer className="flex items-center gap-2 border-t border-line bg-surface px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-xs text-muted">
            {selected && selected.key !== "__other__"
              ? `Selected: ${selected.label}, ${formatCount(selected.count)} messages, ${formatBytes(selected.size)}`
              : `Checked: ${checkedSenders.size} senders, ${checkedMessages.size} messages`}
          </span>
          {selected?.key.startsWith("m:") && (
            <button
              onClick={() => setDetailId(Number(selected.key.slice(2)))}
              className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-raised"
            >
              Details
            </button>
          )}
          {(["archive", "trash", "delete"] as const).map((action) => {
            if (action === "archive" && account?.kind === "imap" && !hasArchive) return null;
            const run = () =>
              selected && selected.key !== "__other__"
                ? requestNodeAction(action)
                : requestCheckedAction(action);
            const label =
              action === "trash" ? "Move to Trash" : action === "archive" ? "Archive" : "Delete";
            const styles =
              action === "delete"
                ? "bg-danger-surface text-danger hover:opacity-85"
                : "border border-line text-ink hover:bg-raised";
            return (
              <button
                key={action}
                onClick={run}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${styles}`}
              >
                {label}
              </button>
            );
          })}
          <button
            onClick={() => {
              setSelected(null);
              setCheckedSenders(new Set());
              setCheckedMessages(new Set());
            }}
            className="rounded-md px-2 py-1.5 text-xs text-muted hover:bg-raised hover:text-ink"
          >
            Clear
          </button>
        </footer>
      )}

      {showAdd && <AddAccountModal onClose={() => setShowAdd(false)} onAdd={addAccount} />}
      {removeConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div
            role="alertdialog"
            aria-label="Remove account"
            className="w-95 rounded-lg border border-line bg-surface p-5 shadow-2xl"
          >
            <h2 className="text-[15px] font-semibold text-ink">Remove account</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-ink">
              Remove {removeConfirm.label} from Mailstat?
            </p>
            <p className="mt-1 text-xs text-muted">
              This deletes the local scan cache and, for IMAP accounts, the saved app password.
              Nothing is changed on the mail server itself.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setRemoveConfirm(null)}
                disabled={removeBusy}
                className="rounded-md px-3 py-1.5 text-[13px] text-muted hover:bg-raised hover:text-ink"
              >
                Cancel
              </button>
              <button
                onClick={confirmRemoveAccount}
                disabled={removeBusy}
                className="rounded-md bg-danger px-4 py-1.5 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-60"
              >
                {removeBusy ? "Removing" : "Remove account"}
              </button>
            </div>
          </div>
        </div>
      )}
      {pending && (
        <ConfirmDialog
          pending={pending}
          busy={actionBusy}
          onConfirm={confirmAction}
          onCancel={() => setPending(null)}
        />
      )}
      {detailId != null && (
        <MessageDetail
          messageId={detailId}
          onClose={() => setDetailId(null)}
          onNavigate={setDetailId}
          onAction={requestDetailAction}
          onShowSender={focusSender}
          onUnsubscribe={openUnsubscribe}
        />
      )}
      {toast && <Toast msg={toast} />}
    </div>
  );
}

function Toast({ msg }: { msg: string }) {
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-line bg-surface px-4 py-2 text-[13px] text-ink shadow-xl"
    >
      {msg}
    </div>
  );
}
