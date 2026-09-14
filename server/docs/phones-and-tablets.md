# Phones and tablets

The same app, laid out for the screen it is on.

## On a phone

Below about 640 px wide:

- The file list is a sheet behind the button at the top left. It comes up by
  itself while no note is open and closes when you choose one.
- The formatting toolbar sits at the bottom, above the keyboard, and scrolls
  sideways.
- The save button is the status pill in the header.
- Everything else the toolbar offers on the desktop (find and replace,
  details, zoom, zen mode, print, spell check, versions, back and forward)
  is in the header's menu.
- The chat and the details panel open as full-screen sheets.

## On a tablet

Up to about 920 px (a tablet in portrait) the file list stays next to the
note and the chat comes in from the right. Above that the layout is the
desktop one.

## Touch

On a touch screen every row in the file tree has a "…" button for its menu
(a long press works on Android too), and **Move to…** in that menu does what
dragging does with a mouse.

## Like an app

Add the site to the home screen (Chrome: "Add to Home screen", Safari: share
sheet, "Add to Home Screen") and it opens without the browser chrome. The
session lasts 60 days of use, so the password is asked for rarely.

Chrome and Safari on phones show a certificate warning for Caddy's local CA
just like the desktop browsers; import `caddy-root.crt` on the device once
(see [Getting started](getting-started.md)) or accept the warning.

## Dictation

The desktop app's dictation runs Whisper on your computer; the server does
not transcribe, and the web app has no microphone button. Use what the device
already has, all of which type straight into the editor:

- **Windows:** press Win+H with the cursor in the note (voice typing, needs a
  one-time download of the language pack under Settings, Time & language,
  Speech).
- **macOS:** press the dictation key or Fn twice (System Settings, Keyboard,
  Dictation). Recent macOS versions transcribe on the device.
- **Phones and tablets:** the microphone key on the keyboard (Gboard, iOS).

The one thing the app could add on its own is a button on the browser's Web
Speech API, and it deliberately does not: in Chrome and Edge that API sends
the audio to Google's servers, Firefox does not support it at all, and the
system dictation above is on every device already, offline where the system
does it offline.

If you want Whisper, use the [desktop app](desktop-app.md) with the server
vault: its dictation works there as with a local folder.
