// In-browser mock backend, used when the app runs outside Tauri (plain
// `vite dev`, web demos, UI tests). Mirrors the Rust demo seeder.

import type {
  Account,
  AccountStats,
  ActionResult,
  FolderInfo,
  MessageRow,
  NewAccount,
  PathSeg,
  SenderStat,
  TreeNode,
  TypeStat,
} from "./api";

interface MockMsg {
  id: number;
  folderId: number;
  folderName: string;
  subject: string;
  fromEmail: string;
  fromName: string;
  date: number;
  size: number;
  cat: string;
  unsub: string | null;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SENDERS = [
  { email: "newsletter@techdigest.io", name: "Tech Digest", newsletter: true, volume: 640, avgKb: 95, attach: 0.02 },
  { email: "deals@shopmart.com", name: "ShopMart Deals", newsletter: true, volume: 580, avgKb: 210, attach: 0.01 },
  { email: "no-reply@linkedpro.com", name: "LinkedPro", newsletter: true, volume: 470, avgKb: 60, attach: 0 },
  { email: "updates@newsroom.co", name: "The Newsroom", newsletter: true, volume: 390, avgKb: 130, attach: 0 },
  { email: "hello@designweekly.dev", name: "Design Weekly", newsletter: true, volume: 210, avgKb: 340, attach: 0.05 },
  { email: "team@cloudphotos.app", name: "CloudPhotos", newsletter: false, volume: 85, avgKb: 2600, attach: 0.9 },
  { email: "sarah.chen@acmecorp.com", name: "Sarah Chen", newsletter: false, volume: 320, avgKb: 450, attach: 0.35 },
  { email: "raj.patel@acmecorp.com", name: "Raj Patel", newsletter: false, volume: 260, avgKb: 380, attach: 0.3 },
  { email: "mom.family@gmail.com", name: "Mom", newsletter: false, volume: 150, avgKb: 1800, attach: 0.6 },
  { email: "invoices@utilityco.ae", name: "UtilityCo Billing", newsletter: false, volume: 96, avgKb: 240, attach: 0.95 },
  { email: "receipts@rideshare.com", name: "RideShare Receipts", newsletter: true, volume: 310, avgKb: 45, attach: 0.1 },
  { email: "noreply@bankmail.ae", name: "BankMail Statements", newsletter: false, volume: 72, avgKb: 520, attach: 0.9 },
  { email: "video-share@bigfiles.net", name: "BigFiles Transfer", newsletter: false, volume: 18, avgKb: 14000, attach: 1 },
  { email: "alerts@statuspage.dev", name: "StatusPage Alerts", newsletter: true, volume: 420, avgKb: 22, attach: 0 },
  { email: "james.w@freelancehub.com", name: "James Whitfield", newsletter: false, volume: 88, avgKb: 900, attach: 0.5 },
];

const SUBJECTS = [
  "Weekly roundup", "Your invoice is ready", "Re: project timeline", "Photos from the weekend",
  "Action required: verify your account", "Q3 report draft", "Meeting notes", "Your receipt",
  "New sign-in detected", "Holiday plans", "Contract for review", "Design feedback",
  "Statement available", "Re: budget approval", "Team offsite details", "Your order shipped",
];

const ATTACH_KINDS: [string, number][] = [
  ["pdf", 320], ["image", 1400], ["image", 800], ["doc", 260],
  ["sheet", 180], ["archive", 4200], ["video", 16000], ["slides", 2400],
];

const FOLDERS = [
  { id: 1, name: "INBOX", special: null as string | null },
  { id: 2, name: "Newsletters", special: null },
  { id: 3, name: "Work", special: null },
  { id: 4, name: "Personal", special: null },
  { id: 5, name: "Receipts", special: null },
  { id: 6, name: "Sent", special: "sent" },
  { id: 7, name: "Archive", special: "archive" },
  { id: 8, name: "Trash", special: "trash" },
];

let messages: MockMsg[] = [];
let seeded = false;

function seed() {
  if (seeded) return;
  seeded = true;
  const rng = mulberry32(42);
  const now = 1751600000;
  const fourYears = 4 * 365 * 24 * 3600;
  let id = 0;
  for (const s of SENDERS) {
    for (let i = 0; i < s.volume; i++) {
      id++;
      let folder = 1;
      if (s.newsletter) folder = rng() < 0.7 ? 2 : 1;
      else if (s.email.includes("acmecorp")) folder = 3;
      else if (/invoices|receipts|bankmail/.test(s.email)) folder = 5;
      else folder = rng() < 0.5 ? 1 : 4;
      let size = Math.round(s.avgKb * 1024 * (0.3 + rng() * 1.9));
      let cat = "plain";
      if (rng() < s.attach) {
        const kinds = rng() < 0.2 ? 2 : 1;
        let biggest = 0;
        for (let k = 0; k < kinds; k++) {
          const [kcat, avg] = ATTACH_KINDS[Math.floor(rng() * ATTACH_KINDS.length)];
          const asize = Math.round(avg * 1024 * (0.2 + rng() * 2.8));
          size += asize;
          if (asize > biggest) {
            biggest = asize;
            cat = kcat;
          }
        }
      }
      messages.push({
        id,
        folderId: folder,
        folderName: FOLDERS[folder - 1].name,
        subject: SUBJECTS[Math.floor(rng() * SUBJECTS.length)],
        fromEmail: s.email,
        fromName: s.name,
        date: now - Math.floor(rng() * fourYears),
        size,
        cat,
        unsub: s.newsletter ? `<https://unsubscribe.example.com/${s.email}>` : null,
      });
    }
  }
}

function filtered(path: PathSeg[]): MockMsg[] {
  return messages.filter((m) =>
    path.every((seg) => {
      switch (seg.dim) {
        case "folder":
          return String(m.folderId) === seg.key;
        case "sender":
          return m.fromEmail === seg.key;
        case "type":
          return m.cat === seg.key;
        case "year":
          return String(new Date(m.date * 1000).getUTCFullYear()) === seg.key;
        default:
          return true;
      }
    }),
  );
}

function keyOf(m: MockMsg, dim: string): [string, string] {
  switch (dim) {
    case "folder":
      return [String(m.folderId), m.folderName];
    case "sender":
      return [m.fromEmail, m.fromName || m.fromEmail];
    case "type":
      return [m.cat, m.cat];
    case "year": {
      const y = String(new Date(m.date * 1000).getUTCFullYear());
      return [y, y];
    }
    default:
      return ["", ""];
  }
}

function groupNodes(msgs: MockMsg[], dim: string, cap: number): TreeNode[] {
  const map = new Map<string, TreeNode & { msgs: MockMsg[] }>();
  for (const m of msgs) {
    const [key, label] = keyOf(m, dim);
    let n = map.get(key);
    if (!n) {
      n = { key, label, sublabel: "", size: 0, count: 0, cat: "mixed", leaf: false, children: [], msgs: [] };
      map.set(key, n);
    }
    n.size += m.size;
    n.count += 1;
    n.msgs.push(m);
  }
  const sorted = [...map.values()].sort((a, b) => b.size - a.size);
  const kept = sorted.slice(0, cap);
  const rest = sorted.slice(cap);
  const out: TreeNode[] = kept.map(({ msgs: _m, ...n }) => n);
  if (rest.length) {
    out.push({
      key: "__other__",
      label: `${rest.reduce((a, r) => a + r.count, 0)} more…`,
      sublabel: "",
      size: rest.reduce((a, r) => a + r.size, 0),
      count: rest.reduce((a, r) => a + r.count, 0),
      cat: "other",
      leaf: true,
      children: [],
    });
  }
  // stash msgs for level-2 pass
  (out as (TreeNode & { msgs?: MockMsg[] })[]).forEach((n, i) => {
    if (n.key !== "__other__") (n as TreeNode & { msgs?: MockMsg[] }).msgs = kept[i].msgs;
  });
  return out;
}

function msgNodes(msgs: MockMsg[], cap: number): TreeNode[] {
  const sorted = [...msgs].sort((a, b) => b.size - a.size);
  const kept = sorted.slice(0, cap);
  const out: TreeNode[] = kept.map((m) => ({
    key: `m:${m.id}`,
    label: m.subject,
    sublabel: m.fromName || m.fromEmail,
    size: m.size,
    count: 1,
    cat: m.cat,
    leaf: true,
    children: [],
  }));
  const rest = sorted.slice(cap);
  if (rest.length) {
    out.push({
      key: "__other__",
      label: `${rest.length} more…`,
      sublabel: "",
      size: rest.reduce((a, r) => a + r.size, 0),
      count: rest.length,
      cat: "other",
      leaf: true,
      children: [],
    });
  }
  return out;
}

export const mockApi = {
  async listAccounts(): Promise<Account[]> {
    if (!seeded) return [];
    return [
      {
        id: 1,
        kind: "demo",
        email: "demo@mailstat.app",
        label: "Demo mailbox",
        host: "",
        port: 993,
        username: "",
        last_sync: Math.floor(Date.now() / 1000),
        msg_count: messages.length,
        total_size: messages.reduce((a, m) => a + m.size, 0),
      },
    ];
  },
  async addAccount(_cfg: NewAccount): Promise<number> {
    throw "IMAP accounts need the desktop app (this is the browser demo).";
  },
  async removeAccount(): Promise<void> {
    messages = [];
    seeded = false;
  },
  async startScan(): Promise<void> {
    throw "Demo accounts have no server to scan";
  },
  async cancelScan(): Promise<void> {},
  async getFolders(): Promise<FolderInfo[]> {
    return FOLDERS.map((f) => {
      const ms = messages.filter((m) => m.folderId === f.id);
      return {
        id: f.id,
        path: f.name,
        name: f.name,
        special: f.special,
        msg_count: ms.length,
        total_size: ms.reduce((a, m) => a + m.size, 0),
      };
    }).sort((a, b) => b.total_size - a.total_size);
  },
  async getTreemap(_a: number, groupBy: string[], path: PathSeg[]): Promise<TreeNode[]> {
    const msgs = filtered(path);
    const depth = path.length;
    if (depth >= groupBy.length) return msgNodes(msgs, 1200);
    const nodes = groupNodes(msgs, groupBy[depth], 300) as (TreeNode & { msgs?: MockMsg[] })[];
    const nextDim = groupBy[depth + 1];
    for (const n of nodes) {
      if (!n.msgs) continue;
      n.children = nextDim ? groupNodes(n.msgs, nextDim, 25) : msgNodes(n.msgs, 25);
      delete n.msgs;
    }
    return nodes.map(({ ...n }) => n);
  },
  async topSenders(_a: number, limit = 100): Promise<SenderStat[]> {
    return senderStats(() => true).slice(0, limit);
  },
  async unsubscribeCandidates(_a: number, limit = 100): Promise<SenderStat[]> {
    return senderStats((m) => m.unsub !== null)
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  },
  async largestMessages(_a: number, limit = 100): Promise<MessageRow[]> {
    return [...messages]
      .sort((a, b) => b.size - a.size)
      .slice(0, limit)
      .map((m) => ({
        id: m.id,
        subject: m.subject,
        from_email: m.fromEmail,
        from_name: m.fromName,
        folder: m.folderName,
        date: m.date,
        size: m.size,
        cat: m.cat,
      }));
  },
  async typeStats(): Promise<TypeStat[]> {
    const map = new Map<string, TypeStat>();
    for (const m of messages) {
      const t = map.get(m.cat) ?? { cat: m.cat, count: 0, size: 0 };
      t.count++;
      t.size += m.size;
      map.set(m.cat, t);
    }
    return [...map.values()].sort((a, b) => b.size - a.size);
  },
  async accountStats(): Promise<AccountStats> {
    return {
      msg_count: messages.length,
      total_size: messages.reduce((a, m) => a + m.size, 0),
      attach_size: 0,
      last_sync: Math.floor(Date.now() / 1000),
    };
  },
  async idsForPath(_a: number, path: PathSeg[]): Promise<number[]> {
    const last = path[path.length - 1];
    if (last?.dim === "msg") return [Number(last.key.replace("m:", ""))];
    return filtered(path).map((m) => m.id);
  },
  async idsForSenders(_a: number, senders: string[]): Promise<number[]> {
    return messages.filter((m) => senders.includes(m.fromEmail)).map((m) => m.id);
  },
  async performAction(_a: number, ids: number[]): Promise<ActionResult> {
    const set = new Set(ids);
    const removed = messages.filter((m) => set.has(m.id));
    messages = messages.filter((m) => !set.has(m.id));
    return { affected: removed.length, bytes: removed.reduce((a, m) => a + m.size, 0) };
  },
  async seedDemo(): Promise<number> {
    seed();
    return 1;
  },
};

function senderStats(pred: (m: MockMsg) => boolean): SenderStat[] {
  const map = new Map<string, SenderStat>();
  for (const m of messages) {
    if (!pred(m)) continue;
    const s =
      map.get(m.fromEmail) ??
      ({ email: m.fromEmail, name: m.fromName || m.fromEmail, count: 0, size: 0, unsubscribe: null } as SenderStat);
    s.count++;
    s.size += m.size;
    if (m.unsub) s.unsubscribe = m.unsub;
    map.set(m.fromEmail, s);
  }
  return [...map.values()].sort((a, b) => b.size - a.size);
}
