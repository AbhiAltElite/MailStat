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
    hint: "Create an app password in Fastmail Settings, under Privacy and Security.",
  },
  {
    name: "Yahoo",
    host: "imap.mail.yahoo.com",
    port: 993,
    hint: "Generate an app password in Yahoo Account Security settings.",
  },
  { name: "Other IMAP", host: "", port: 993, hint: "Any IMAP server with TLS on port 993." },
];

const inputClass =
  "mt-1 w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent";

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
      await onAdd({ email, label: email, host, port, username: email, password });
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <form
        onSubmit={submit}
        className="w-105 rounded-lg border border-line bg-surface p-5 shadow-2xl"
      >
        <h2 className="text-[15px] font-semibold text-ink">Add IMAP account</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Scanning reads message sizes and headers only. Full content is fetched only when you
          open a specific message, and the password is stored in your system keychain.
        </p>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              type="button"
              key={p.name}
              onClick={() => pickPreset(p)}
              className={`rounded-md px-3 py-1 text-xs ${
                preset.name === p.name
                  ? "bg-accent font-medium text-white"
                  : "border border-line text-muted hover:bg-raised hover:text-ink"
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
        <p className="mt-2 min-h-8 text-[11px] leading-snug text-faint">{preset.hint}</p>

        <label className="mt-2 block text-xs text-muted">
          Email address
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            placeholder="you@example.com"
          />
        </label>

        <div className="mt-3 flex gap-2">
          <label className="block flex-1 text-xs text-muted">
            IMAP server
            <input
              required
              value={host}
              onChange={(e) => setHost(e.target.value)}
              className={inputClass}
              placeholder="imap.example.com"
            />
          </label>
          <label className="block w-20 text-xs text-muted">
            Port
            <input
              required
              type="number"
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
              className={inputClass}
            />
          </label>
        </div>

        <label className="mt-3 block text-xs text-muted">
          App password
          <input
            required
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </label>

        {error && (
          <p className="mt-3 rounded-md bg-danger-surface px-2.5 py-1.5 text-xs text-danger">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-[13px] text-muted hover:bg-raised hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-accent px-4 py-1.5 text-[13px] font-medium text-white hover:bg-accent-strong disabled:opacity-60"
          >
            {busy ? "Connecting" : "Connect"}
          </button>
        </div>
      </form>
    </div>
  );
}
