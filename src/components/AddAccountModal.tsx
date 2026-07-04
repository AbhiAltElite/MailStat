import { useState } from "react";
import type { NewAccount } from "../lib/api";

interface Preset {
  name: string;
  host: string;
  port: number;
  hint: string;
}

const PRESETS: Preset[] = [
  {
    name: "Gmail",
    host: "imap.gmail.com",
    port: 993,
    hint: "Turn on 2-step verification, then create an app password at myaccount.google.com/apppasswords and use it here.",
  },
  {
    name: "iCloud",
    host: "imap.mail.me.com",
    port: 993,
    hint: "Create an app-specific password at appleid.apple.com.",
  },
  {
    name: "Fastmail",
    host: "imap.fastmail.com",
    port: 993,
    hint: "Create an app password in Fastmail Settings → Privacy & Security.",
  },
  {
    name: "Yahoo",
    host: "imap.mail.yahoo.com",
    port: 993,
    hint: "Generate an app password in Yahoo Account Security settings.",
  },
  { name: "Other IMAP", host: "", port: 993, hint: "Any IMAP server with TLS (port 993)." },
];

interface Props {
  onClose: () => void;
  onAdd: (cfg: NewAccount) => Promise<void>;
}

export default function AddAccountModal({ onClose, onAdd }: Props) {
  const [preset, setPreset] = useState<Preset>(PRESETS[0]);
  const [email, setEmail] = useState("");
  const [host, setHost] = useState(PRESETS[0].host);
  const [port, setPort] = useState(993);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickPreset = (p: Preset) => {
    setPreset(p);
    setHost(p.host);
    setPort(p.port);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onAdd({
        email,
        label: email,
        host,
        port,
        username: email,
        password,
      });
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <form
        onSubmit={submit}
        className="w-[420px] rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-2xl"
      >
        <h2 className="text-[15px] font-semibold text-slate-100">Add IMAP account</h2>
        <p className="mt-1 text-[12px] text-slate-400">
          Mailstat reads message sizes and headers only — never bodies. Credentials stay in your
          OS keychain.
        </p>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              type="button"
              key={p.name}
              onClick={() => pickPreset(p)}
              className={`rounded-full px-3 py-1 text-[12px] ${
                preset.name === p.name
                  ? "bg-sky-700 text-white"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
        <p className="mt-2 min-h-8 text-[11px] leading-snug text-slate-500">{preset.hint}</p>

        <label className="mt-2 block text-[12px] text-slate-300">
          Email address
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-[13px] text-slate-100 outline-none focus:border-sky-600"
            placeholder="you@example.com"
          />
        </label>

        <div className="mt-3 flex gap-2">
          <label className="block flex-1 text-[12px] text-slate-300">
            IMAP server
            <input
              required
              value={host}
              onChange={(e) => setHost(e.target.value)}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-[13px] text-slate-100 outline-none focus:border-sky-600"
              placeholder="imap.example.com"
            />
          </label>
          <label className="block w-20 text-[12px] text-slate-300">
            Port
            <input
              required
              type="number"
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-[13px] text-slate-100 outline-none focus:border-sky-600"
            />
          </label>
        </div>

        <label className="mt-3 block text-[12px] text-slate-300">
          App password
          <input
            required
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-[13px] text-slate-100 outline-none focus:border-sky-600"
          />
        </label>

        {error && (
          <p className="mt-3 rounded border border-red-900 bg-red-950/60 px-2.5 py-1.5 text-[12px] text-red-300">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1.5 text-[13px] text-slate-300 hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-sky-700 px-4 py-1.5 text-[13px] font-medium text-white hover:bg-sky-600 disabled:opacity-50"
          >
            {busy ? "Connecting…" : "Connect"}
          </button>
        </div>
      </form>
    </div>
  );
}
