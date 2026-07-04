# Mailstat

**WinDirStat for your email.** See where the gigabytes in your mailbox live as an
interactive treemap — then clean them up in bulk. Free, local-first, multi-provider.

## What it does

- **Treemap of your mailbox** — tile area = message size, grouped by
  Folder → Sender, Sender, Year → Sender, or Type → Sender. Double-click to
  drill in, click to select.
- **Folder tree** with size/count/% bars (the WinDirStat directory panel).
- **Content-type legend** — the email analogue of WinDirStat's extension list:
  images, PDFs, archives, video… click to highlight in the treemap.
- **Top lists** — heaviest senders, largest messages, unsubscribe candidates
  (from `List-Unsubscribe` headers).
- **Cleanup** — select a tile, a sender, or check rows in the lists, then
  Archive / Move to Trash / Delete permanently. Always behind a confirmation
  that shows exact message count and size.
- **Scan is metadata-only**: sizes, envelopes, body *structure*, and one header
  field. Message bodies are never downloaded. Everything stays in a local
  SQLite cache; passwords live in the OS keychain.

## Providers

- **Any IMAP server** (TLS, port 993) — Gmail, iCloud, Fastmail, Yahoo,
  self-hosted. Gmail/iCloud/Yahoo need an app password (built-in presets
  explain where to create one).
- Gmail is scanned via `[Gmail]/All Mail` + Trash + Spam so labels don't
  double-count messages.
- A **Gmail API connector** (faster scans, label-aware) is planned as
  bring-your-own-OAuth-client, since publishing a verified Gmail-API app
  requires a paid security assessment — this project stays free.

## Run it

```sh
# prerequisites: Rust (rustup), Node 20+
npm install
npm run tauri dev      # desktop app
npm run dev            # UI only in a browser, with an in-memory mock backend
```

No account handy? Click **“Try with demo data”** on the welcome screen.

## Tests

```sh
cd src-tauri && cargo test   # metadata parsing + data-layer integration tests
npx tsc --noEmit             # frontend type check
```

## Architecture

```
React + Vite + Tailwind          Rust (Tauri 2)
  treemap canvas (d3-hierarchy)    IMAP scan engine (metadata-only, resumable)
  folder tree · top lists          SQLite cache + SQL aggregation
  cleanup basket + confirm         action executor (MOVE / COPY+EXPUNGE)
                                   keychain secrets (keyring)
```

Scans are incremental (UIDVALIDITY/UIDNEXT), cancellable, and stream progress
events to the UI. Remote deletions are reconciled via `UID SEARCH ALL`.
