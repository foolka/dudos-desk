# Changelog

## 0.3.4

- Fixed the uncovered taskbar-height strip under desktop effects. Windows now receives the full selected monitor bounds again after creating the hidden window, including monitors with nonzero coordinates and display scaling.
- Preserved passive effects without focus requests, interactive captcha input, emergency stop and OBS mirroring. Profiles, rewards, source URLs and taskbar shortcuts are unchanged.
- Added native hidden-window geometry and edge-pixel regression checks, plus taskbar-side and scaled-coordinate unit tests. The checks do not show desktop effects or install input hooks.

## 0.3.3

- Added an explicit Windows taskbar pin button and live status in the standalone app settings, in RU/UK/EN. Windows asks for confirmation; unsupported systems show manual instructions.
- Kept installer identity, executable path and shortcut icon stable across updates. A shortcut belonging to another app copy is never silently redirected.
- Added isolated pinning tests for consent cancellation, duplicate clicks, shortcuts and trusted renderer access. OBS plugins and profiles are unchanged.

## 0.3.2

- Added independent size sliders for text and arrow captchas: 50-200%, in 5% steps, with a live preview. The entire card scales together, including text, input, arrows and countdown.
- Desktop effects and the OBS mirror use the same size. Saved changes apply to new activations, without resizing an already accepted effect or resetting its input.
- Existing profiles retain the original 100% size and all other settings. Added legacy-profile, persistence, preview, geometry and scaled desktop-to-OBS input regression checks.

## 0.3.1

- The OBS mirror now shows live arrow-captcha progress, resets after a wrong arrow, and text-captcha typing, deletion and incorrect-code feedback.
- Existing captcha frames update without replaying their sound, rebuilding the card or resetting the countdown. Reconnecting OBS restores the current input state.
- A solved captcha keeps its final frame visible for up to 750 ms, without extending its deadline; mouse blocking is released immediately on completion.
- Captcha input is accepted only from the trusted desktop effect window, remains in memory and is not written to history. The OBS API remains read-only.
- Existing profiles, Twitch rewards, media and OBS URLs are unchanged.

## 0.3.0

- Both captchas request focus as soon as their input is ready and block mouse input for at most five seconds. Keyboard input and emergency stop remain available.
- A separate short-lived mouse helper releases on timeout, lost focus, completion, stop, window closure or missing app heartbeat. Previews and automated tests never install input hooks.
- Prominent three-language OBS source-name guidance explains exact names, enabling the mode guard, refunds and pending purchases during connection/configuration errors.
- Inactive-game and blocked-mode refunds are announced in Twitch chat from the channel account only after cancellation is confirmed, with the outcome recorded in activity. Existing users can grant the additional chat permission by signing in again.
- Mode refunds are checked even when the OBS mirror is hidden; allowed effects still wait for a ready mirror. Duplicate purchases do not repeat announcements.
- Existing profiles, reward bindings, media and OBS source URLs are preserved.

## 0.2.1

- Disabled reward limits no longer send a placeholder value of 1 to Twitch; configured positive limits and cooldowns remain unchanged.
- The main status shows when rewards are waiting for the OBS browser source, including before the first purchase.
- Held purchases and processing retries are recorded in activity with their reason, without repeating the same entry every 15 seconds.
- Added regression coverage for disabled limits, OBS waiting/reconnection and real reward processing without desktop effects.

## 0.2.0

- Direct Twitch authorization and reward creation, editing and deletion; removed external bot trigger code and HTTP trigger endpoint.
- EventSub plus 15-second reconciliation of pending purchases, persistent deduplication and retryable fulfillment/refund requests.
- Editable reward price, color, prompt, pause, limits and cooldown; local drafts do not publish themselves.
- Default wait for OBS before reward activation, and one-button local OBS setup.
- Bounded recovery of this profile's active OBS source without changing scenes, streaming or recording.
- Updated three-language interface, documentation and screenshots; existing profiles and effects are preserved.

## 0.1.0

- Independent Dudos Desk desktop app with EXE installer and portable ZIP.
- Five local visual effects, two weighted categories, custom audio and monitor selection.
- Safe embedded preview, ten-second delayed tests, bounded durations and emergency stop.
- Persistent redemption deduplication, optional read-only OBS mode guard, authenticated loopback integration.
- OBS mirror reconnects after app restarts; private stable source URL.
- Russian, Ukrainian and English interface; light and dark themes.
- Prominent warning about game/captcha focus changes.
- Stable profile identity, transactional settings, backups and separate copied audio files.
