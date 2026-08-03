# Keylet

A minimal, privacy-first TOTP (time-based one-time password) authenticator for Google Chrome. Add accounts via an `otpauth://` URL, view live codes, and copy them with one click. All data stays on your device.

## Features

- Add accounts by pasting an `otpauth://totp/...` URL — fields auto-fill
- Or enter issuer / label / secret manually
- **Import from QR** — upload a screenshot/image of a QR code, or scan live with your camera
- **Google Authenticator export support** — scan the `otpauth-migration://` QR codes that GA generates when exporting (multi-account batch import)
- Live 6- or 8-digit codes with a countdown progress bar
- One-click copy to clipboard
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
│   ├── storage.ts      # chrome.storage.local + dedupe-on-import
│   ├── base32.ts       # RFC 4648 base32 codec
│   ├── totp.ts         # TOTP (RFC 6238) via Web Crypto
│   ├── otpauth.ts      # Single otpauth:// parser
│   ├── migration.ts    # Google Authenticator otpauth-migration:// protobuf decoder
│   ├── otp-uri.ts      # Dispatcher: any otpauth* URI → accounts
│   ├── qr.ts           # BarcodeDetector wrapper for image QRs
│   ├── dom.ts          # Small DOM helpers
│   └── entries/
│       ├── popup.ts    # Popup UI (list + add/edit + import)
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

## Privacy

Secrets are stored only in `chrome.storage.local` on your machine. Keylet never makes network requests. If you remove the extension, the data is deleted with it.

## License

MIT
