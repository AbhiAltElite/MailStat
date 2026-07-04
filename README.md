# Mailstat

Mailstat is a mailbox space analyzer and cleanup assistant. It reads the metadata of
every message in an email account, draws the mailbox as a treemap where tile area
equals message size, and lets you archive or delete the heavy parts in bulk.

It is free, open source, and local first. Scanning never downloads message content;
it only reads sizes and headers. You can still read the full content of any single
message on demand, fetched live at the moment you open it. Nothing is sent to any
third party service.

## Major features

- Treemap of the whole mailbox, grouped by folder and sender, sender only,
  year and sender, or content type and sender. Double click a group to drill in,
  double click a message tile to open it.
- Folder panel with size, message count, and share bars.
- Content type list showing where the bytes sit: images, PDFs, archives, video,
  spreadsheets, presentations, plain mail. Selecting a type highlights it in the
  treemap.
- Top lists: heaviest senders, largest messages, and unsubscribe candidates taken
  from List-Unsubscribe headers.
- Message detail view with attachments, the surrounding conversation, and other
  large mail from the same sender, so related messages are one click away.
  Content can be loaded on demand to read the message itself: plain text is
  shown as is, HTML is sanitized and rendered in a sandboxed frame with remote
  images blocked.
- Cleanup actions: Archive, Move to Trash, and permanent delete. Every action shows
  the exact message count and total size before it runs.
- Light and dark themes.
- Incremental rescans. Only new messages are fetched on subsequent scans, and
  messages removed on the server are removed from the local cache.
- An email address can only be added once. Trying to add it again is rejected
  before Mailstat even attempts to connect.

## Privacy

Scanning fetches message sizes, envelopes, body structure, and the
List-Unsubscribe header. It never fetches message content in bulk. All of that
is cached in a local SQLite database in the application data directory. Account
passwords are stored in the operating system keychain, not in the database.
There is no telemetry.

Opening a message's content is a separate, explicit action. It fetches only
that one message from the server at that moment, is never written to the local
cache, and is discarded once you close or navigate away from it. HTML content
is sanitized (scripts, forms, and embeds are stripped) and rendered in a
sandboxed frame with scripting disabled; remote images are removed outright so
opening a message can never confirm to a sender that it was read.

## Supported providers

Any IMAP server with TLS on port 993. Built-in presets cover Gmail, iCloud,
Fastmail, and Yahoo, all of which require an app password:

- Gmail: enable 2-step verification, then create a password at
  myaccount.google.com/apppasswords
- iCloud: create an app-specific password at appleid.apple.com
- Fastmail: Settings, Privacy and Security, app passwords
- Yahoo: Account Security settings, app passwords

Gmail accounts are scanned through All Mail, Trash, and Spam so that labels do not
count the same message twice.

A Gmail API connector with label support is planned. It will use a bring your own
OAuth client model, because publishing a verified app for restricted Gmail scopes
requires a paid security assessment, and this project intends to stay free.

## Building

Prerequisites: Rust (rustup.rs) and Node.js 20 or newer.

```sh
git clone https://github.com/<your-user>/mailstat.git
cd mailstat
npm install
npm run tauri dev      # run the desktop app
npm run tauri build    # produce a release bundle
```

`npm run dev` serves the interface in a plain browser with an in-memory mock
backend, which is useful for interface work and demos. IMAP accounts require the
desktop app.

If you just want to look around, start the app and choose "Try with demo data".

## Tests

```sh
cd src-tauri && cargo test   # parsing and data layer tests
npx tsc --noEmit             # frontend type check
```

## Roadmap

- Gmail API connector (bring your own OAuth client)
- Microsoft 365 support through Graph
- Duplicate and near-duplicate detection
- Saved cleanup rules, for example newsletters older than one year
- Signed release builds for macOS, Windows, and Linux

## Copyright and licenses

Mailstat is distributed under the MIT license. See [LICENSE](LICENSE).

Mailstat contains no code from WinDirStat or any other disk usage analyzer. The
treemap is an independent implementation built on the squarified treemap layout
from d3-hierarchy (ISC license). HTML message content is sanitized with ammonia
(MIT/Apache 2.0). All other dependencies are available under MIT, Apache 2.0, or
ISC licenses.

## Acknowledgements

The idea of pairing a treemap with a cleanup workflow was popularized by
WinDirStat, KDirStat, and SequoiaView for disk usage. Mailstat applies the same
idea to mailboxes. It is an independent project and is not affiliated with or
endorsed by any of them.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for
how to get a development environment running and what to check before submitting.
