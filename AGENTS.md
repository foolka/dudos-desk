# Dudos Desk

- Keep the repository and releases private until explicitly authorized.
- This is a local entertainment overlay, not a network attack utility.
- Independent product in F:/Publik/dudos-desk. No runtime imports from other projects.
- Installed and portable builds use the same %APPDATA%/DudosDesk profile and application ID.
- Never import, modify or package the legacy DDOS profile automatically.
- Never commit profiles, credentials, integration keys, history or personal OBS source names.
- Keep the focus-loss warning prominent in README and the app, in RU, UK and EN.
- Desktop effect tests require explicit consent; automated tests use an isolated profile and no desktop windows.
- Preserve the emergency stop, bounded effect duration, queue limit, atomic saves and profile identity checks.
- Captcha mouse blocking is limited to five seconds, keeps the keyboard available, and releases on lost focus, stop, completion or process/heartbeat loss. Native self-tests must never install input hooks. Source: owner request, 2026-10-25.
- Loopback API stays authenticated; the read-only OBS key must never authorize triggers or settings.
- Captcha changes require a two-page desktop-to-OBS regression test for live input, wrong-input resets, same-event updates and reconnection. Mirror only transient captcha state through trusted desktop IPC; do not restart sound/timers on input or persist typed text. Source: verified missing OBS input defect, 2026-10-26.
- Twitch activation is direct (EventSub and pending-redemption reconciliation); do not restore external bot trigger endpoints. Never auto-adopt another client's rewards. Source: owner request, 2026-10-23.
- Before a release run tests, UI checks, dependency audit, packaging and packaged smoke tests.
