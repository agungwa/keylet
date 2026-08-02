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

1. Open `chrome://extensions`
2. Toggle **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this folder

Pin the Keylet icon to your toolbar, click it, then **+** to add your first account.

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
├── manifest.json   # MV3 manifest
├── shared.js       # Shared logic: TOTP, base32, otpauth + GA-migration parsers
├── popup.html      # Popup UI (list + add/edit + import)
├── popup.css       # Styles
├── popup.js        # Popup logic
├── scan.html       # Camera-scan page (opened in a tab)
├── scan.css        # Scan-page styles
├── scan.js         # Camera + QR decode + import flow
└── icons/          # Extension icons (16/32/48/128)
```

## Privacy

Secrets are stored only in `chrome.storage.local` on your machine. Keylet never makes network requests. If you remove the extension, the data is deleted with it.

## License

MIT
