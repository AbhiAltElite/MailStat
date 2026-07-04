# Contributing to Mailstat

Thanks for considering a contribution.

## Development setup

1. Install Rust from rustup.rs and Node.js 20 or newer.
2. `npm install`
3. `npm run tauri dev` for the desktop app, or `npm run dev` for browser-only
   interface work against the mock backend.

## Before you open a pull request

- `cd src-tauri && cargo test` must pass.
- `npx tsc --noEmit` must pass.
- Test interface changes in both the light and dark themes.
- Keep the design system intact: spacing on the 4 point scale, the existing
  color tokens in `src/index.css`, 6px radius for controls and 8px for
  overlays, and no new fonts.
- Cleanup actions are destructive. Anything that deletes or moves mail must go
  through the confirmation dialog and show an exact message count and size.

## Scope notes

- The scanner must stay metadata only. Do not fetch message bodies.
- Credentials belong in the OS keychain, never in SQLite or config files.
- New providers should implement scanning and actions behind the same command
  surface used by the IMAP connector.

## Reporting bugs

Open a GitHub issue with the app version, the provider (Gmail, iCloud, other
IMAP), and what you expected to happen. Never include your app password or
message contents in an issue.
