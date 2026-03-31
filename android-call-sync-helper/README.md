# Call Sync Helper

Private Android helper app for ServiZephyr manual billing call auto-fill.

What it does:
- listens for incoming phone call state changes on Android
- sends the detected caller number to `POST /api/call-sync/push`
- the ServiZephyr web app mirrors that event into Firebase RTDB
- the manual billing page auto-fills the customer phone field for the paired outlet

Before use:
1. Open ServiZephyr owner settings and generate a `Call Sync Token`.
2. Install this helper app on the Android phone that receives calls.
3. Enter your server base URL and the token inside the app.
4. Grant phone permissions when prompted.

Notes:
- This is intended for private/sideloaded use.
- Incoming caller number access depends on Android version, OEM behavior, and granted permissions.
- This workspace does not currently have Java/Gradle/Android SDK installed, so an APK was not built here.
