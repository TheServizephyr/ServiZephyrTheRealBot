# Kiosk Printing Setup (Windows)

This setup is for auto-printing bills without the browser print confirmation dialog.

## 1. Prerequisites

- Windows machine with Google Chrome or Microsoft Edge installed.
- Printer connected and set as **Default Printer** in Windows.
- App URL ready (local or deployed).

Important:
- In kiosk mode, print goes to the default printer.
- If default printer is wrong, bill will print on wrong device.

## 2. One-time startup setup

From project root, run:

```powershell
npm run kiosk:install-startup
```

Optional (custom URL):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-kiosk-startup.ps1 -Url "https://www.servizephyr.com/owner-dashboard/custom-bill"
```

This creates a startup shortcut so kiosk browser opens automatically after Windows sign-in.

## 3. Launch immediately (manual test)

```powershell
npm run kiosk:launch
```

Optional with custom URL/browser:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/launch-kiosk-printing.ps1 -Browser chrome -Url "http://localhost:3000/owner-dashboard/custom-bill"
```

## 4. Remove startup setup

```powershell
npm run kiosk:remove-startup
```

## 5. Exit kiosk window

- Press `Alt + F4` to close kiosk browser.

