# Keylet

A minimal, privacy-first TOTP (time-based one-time password) authenticator for Google Chrome. Add accounts via an `otpauth://` URL, view live codes, and copy them with one click. All data stays on your device.

## Features

- Add accounts by pasting an `otpauth://totp/...` URL — fields auto-fill
- Or enter issuer / label / secret manually
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

Paste a URL like:

```
otpauth://totp/Issuer:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Issuer
```

Click **Parse**, then **Save**. The live code appears in the list immediately.

## Project structure

```
.
├── manifest.json   # MV3 manifest
├── popup.html      # Popup UI (list + add/edit form)
├── popup.css       # Styles
├── popup.js        # TOTP logic, storage, UI
└── icons/          # Extension icons (16/32/48/128)
```

## Privacy

Secrets are stored only in `chrome.storage.local` on your machine. Keylet never makes network requests. If you remove the extension, the data is deleted with it.

## License

MIT
