import { invoke } from "@tauri-apps/api/core";

export interface Account {
  id: number;
  kind: "imap" | "demo";
  email: string;
  label: string;
  host: string;
  port: number;
  username: string;
  last_sync: number | null;
  msg_count: number;
  total_size: number;
}

export interface NewAccount {
  email: string;
  label: string;
  host: string;
  port: number;
  username: string;
  password: string;
}

export interface FolderInfo {
  id: number;
  path: string;
  name: string;
  special: string | null;
  msg_count: number;
  total_size: number;
}

export interface PathSeg {
  dim: string;
  key: string;
  /** display only, not sent to backend queries' filters */
  label?: string;
}

export interface TreeNode {
  key: string;
  label: string;
  sublabel: string;
  size: number;
  count: number;
  cat: string;
  leaf: boolean;
  children: TreeNode[];
}

export interface SenderStat {
  email: string;
  name: string;
  count: number;
  size: number;
  unsubscribe: string | null;
}

export interface MessageRow {
  id: number;
  subject: string;
  from_email: string;
  from_name: string;
  folder: string;
  date: number | null;
  size: number;
  cat: string;
}

export interface TypeStat {
  cat: string;
  count: number;
  size: number;
}

export interface AccountStats {
  msg_count: number;
  total_size: number;
  attach_size: number;
  last_sync: number | null;
}

export interface ScanProgress {
  account_id: number;
  folder: string;
  folder_index: number;
  folder_count: number;
  done_in_folder: number;
  total_in_folder: number;
  messages_total: number;
  bytes_total: number;
}

export interface ActionResult {
  affected: number;
  bytes: number;
}

const strip = (path: PathSeg[]) => path.map(({ dim, key }) => ({ dim, key }));

export const isTauri = "__TAURI_INTERNALS__" in window;

const tauriApi = {
  listAccounts: () => invoke<Account[]>("list_accounts"),
  addAccount: (cfg: NewAccount) => invoke<number>("add_account", { cfg }),
  removeAccount: (accountId: number) => invoke<void>("remove_account", { accountId }),
  startScan: (accountId: number) => invoke<void>("start_scan", { accountId }),
  cancelScan: (accountId: number) => invoke<void>("cancel_scan", { accountId }),
  getFolders: (accountId: number) => invoke<FolderInfo[]>("get_folders", { accountId }),
  getTreemap: (accountId: number, groupBy: string[], path: PathSeg[]) =>
    invoke<TreeNode[]>("get_treemap", { accountId, groupBy, path: strip(path) }),
  topSenders: (accountId: number, limit = 100) =>
    invoke<SenderStat[]>("get_top_senders", { accountId, limit }),
  unsubscribeCandidates: (accountId: number, limit = 100) =>
    invoke<SenderStat[]>("get_unsubscribe_candidates", { accountId, limit }),
  largestMessages: (accountId: number, limit = 100) =>
    invoke<MessageRow[]>("get_largest_messages", { accountId, limit }),
  typeStats: (accountId: number) => invoke<TypeStat[]>("get_type_stats", { accountId }),
  accountStats: (accountId: number) => invoke<AccountStats>("get_account_stats", { accountId }),
  idsForPath: (accountId: number, path: PathSeg[]) =>
    invoke<number[]>("ids_for_path", { accountId, path: strip(path) }),
  idsForSenders: (accountId: number, senders: string[]) =>
    invoke<number[]>("ids_for_senders", { accountId, senders }),
  performAction: (accountId: number, messageIds: number[], action: "trash" | "archive" | "delete") =>
    invoke<ActionResult>("perform_action", { accountId, messageIds, action }),
  seedDemo: () => invoke<number>("seed_demo"),
};

// Outside Tauri (plain vite dev / web demo) fall back to an in-browser mock
// so the whole UI stays usable and testable.
import { mockApi } from "./mock";

export const api: typeof tauriApi = isTauri ? tauriApi : (mockApi as unknown as typeof tauriApi);
