# Keylet

A minimal, privacy-first TOTP (time-based one-time password) authenticator for Google Chrome. Add accounts via an `otpauth://` URL, view live codes, and copy them with one click. All data stays on your device.

## Features

- **Master password + AES-GCM encryption at rest** — secrets never touch disk in plaintext; the derived key is cached only in `chrome.storage.session` (RAM, cleared on browser close)
- Add accounts by pasting an `otpauth://totp/...` URL — fields auto-fill
- Or enter issuer / label / secret manually
- **Import from QR** — upload a screenshot/image of a QR code, or scan live with your camera
- **Google Authenticator export support** — scan the `otpauth-migration://` QR codes that GA generates when exporting (multi-account batch import)
- Live 6- or 8-digit codes with a countdown progress bar
- One-click copy to clipboard
- Lock-now button, change master password, and full reset
- Multiple accounts supported
- Everything stored locally via `chrome.storage.local` — no servers, no tracking
- TOTP (RFC 6238) using Web Crypto HMAC-SHA1

## Install (developer mode)

1. `npm install`
2. `npm run build`
3. Open `chrome://extensions`
4. Toggle **Developer mode** (top right)
5. Click **Load unpacked**
6. Select the **`dist/`** folder

Pin the Keylet icon to your toolbar, click it, then **+** to add your first account.

## Development

| Command | Purpose |
|---|---|
| `npm run watch` | Rebuild JS bundles on save (asset edits still need a re-run) |
| `npm run typecheck` | Type-check `src/` without emitting |
| `npm run build` | Production build into `dist/` |
| `npm run clean` | Remove `dist/` |

Load `dist/` (not the repo root) as the unpacked extension.

## Add an account

**Option A — paste a URL:** click **+**, paste:

```
otpauth://totp/Issuer:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Issuer
```

Click **Parse**, then **Save**.

**Option B — import from Google Authenticator:**

1. In Google Authenticator: **⋮ → Transfer accounts → Export accounts**
2. In Keylet: click **⇪ (Import)** → **Scan with camera** (or **Upload QR image** if you screenshot the QR)
3. Confirm the preview list → **Import**. Repeat for each batch QR if GA showed multiple.

## Project structure

```
.
├── src/                # TypeScript source
│   ├── types.ts        # Shared types (Account, NewAccount, ParseResult)
│   ├── storage.ts      # Low-level raw I/O on chrome.storage.local
│   ├── vault.ts        # Encryption orchestrator (setup/unlock/load/save)
│   ├── crypto.ts       # PBKDF2 + AES-GCM + verifier primitives
│   ├── base32.ts       # RFC 4648 base32 codec
│   ├── base64.ts       # Base64 codec for crypto artifacts
│   ├── totp.ts         # TOTP (RFC 6238) via Web Crypto
│   ├── otpauth.ts      # Single otpauth:// parser
│   ├── migration.ts    # Google Authenticator otpauth-migration:// protobuf decoder
│   ├── otp-uri.ts      # Dispatcher: any otpauth* URI → accounts
│   ├── qr.ts           # BarcodeDetector wrapper for image QRs
│   ├── dom.ts          # Small DOM helpers
│   └── entries/
│       ├── popup.ts    # Popup UI (list + add/edit + import + settings)
│       └── scan.ts     # Camera scan page (opened in a tab)
├── public/             # Copied verbatim into dist/ at build time
│   ├── manifest.json
│   ├── popup.html / popup.css
│   ├── scan.html / scan.css
│   └── icons/
├── build.mjs           # esbuild bundler + asset copy
├── tsconfig.json       # strict TS config
└── package.json
```

The extension is loaded from `dist/` (built from `src/` + `public/`).

## Privacy & security

- **Secrets at rest** are AES-GCM-256 encrypted under a key derived from your master password (PBKDF2-SHA256, 600,000 iterations). Only salt + an encrypted verifier are stored on disk — never the password or the key.
- **In-memory key caching**: after unlocking, the derived key lives in `chrome.storage.session`, which is RAM-only and cleared when Chrome closes. Click the 🔒 icon to drop it immediately.
- **No network**: Keylet makes zero `fetch`/XHR/WebSocket calls. Verified by grep on every build.
- **No recovery**: if you forget the master password, the only option is **Reset everything** (Settings → Danger zone), which wipes all accounts. There is no backdoor.
- **Migration**: if you upgrade from a pre-vault version, the first time you set a master password all existing plaintext secrets are encrypted in place.

Sources of risk that remain: anyone with access to your unlocked Chrome profile can read live codes while the popup is unlocked. For higher assurance, click 🔒 after copying a code.

## License

MIT
