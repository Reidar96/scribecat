# FAQ

## Setting up

**Do I need a domain?**
No. On a home network, `SCRIBEDOG_SITE_ADDRESS` can be the box's name or IP
and Caddy signs the certificate with its own CA; import that CA once per
device (see [Getting started](getting-started.md)). A domain only matters if
you want Let's Encrypt or reach the server from the internet.

**The browser says the connection is not private.**
That is Caddy's local CA, which the browser does not know yet. Accept the
warning, or import `caddy-root.crt` so it stops. Details in
[Getting started](getting-started.md).

**I can reach the app on the server but not from my laptop.**
Caddy answers only for the addresses in `SCRIBEDOG_SITE_ADDRESS`. Add the
name or IP your laptop uses, run `docker compose up -d`, and check that
ports 443 (and 80) are open on the box's firewall.

**Can I use my existing nginx or Traefik?**
Yes. Proxy to the container's port 3000, forward the WebSocket upgrade for
`/api/events`, do not strip a path prefix, and set `SCRIBEDOG_TRUST_PROXY`
to the number of proxies. See [Configuration](configuration.md).

**Can two people use one server?**
Each person gets their own instance under a path prefix, with their own
password and folder; [`examples/multi-instance/`](../examples/multi-instance/)
is a ready compose file. There are no shared vaults or accounts, on purpose.

## The password and signing in

**I forgot the password.**
Delete `.scribedog/server/auth.json`, set `SCRIBEDOG_INIT_PASSWORD` and
restart. Notes are untouched; stored AI API keys have to be entered again;
desktop apps sign in again. See [Security](security.md).

**Why am I locked out after a few wrong tries?**
Brute-force protection: a minute after five failures, then five, then
fifteen. Wait, or fix the password. The numbers are configurable.

**How long do I stay signed in?**
In the browser, 60 days of use; every visit extends it. The desktop app's
access key does not expire until it is revoked.

**Does changing the password sign out my phone?**
Yes, every browser and every desktop app except the one you changed it on.
To sign out one device only, revoke it in the device list instead.

## The desktop app

**Can I use the desktop app with the server?**
Yes: "Add server vault…" in the vault menu. Notes stay on the server; AI,
dictation, import and export run on your computer. See
[The desktop app as a client](desktop-app.md).

**The desktop app says the server cannot be reached, but the browser works.**
Usually the certificate: the desktop app trusts the operating system's
certificate store, and accepting a warning in the browser does not put the CA
there. Import `caddy-root.crt` into the system store. On Linux, the app
does not use Firefox's store.

**Can I add a server over plain HTTP?**
Only `localhost`. Everything else must be HTTPS, because the password and the
access key would otherwise cross the network in clear text.

**Where is my access key stored?**
In the operating system's credential store (Windows Credential Manager,
macOS Keychain, Linux Secret Service), never in a file the app writes. The
server keeps only a fingerprint of it.

**I lost a laptop that had the server added.**
Revoke its key: Settings → Account in the browser, or Settings → Servers in
another desktop app. Its next request is refused. The password stays.

**Why is the knowledge base greyed out for a server vault?**
Its index runs inside the desktop app and reads the notes from your disk. A
server vault is not on your disk. The chat agent's own search works.

**Can I open the same vault in the browser and the desktop app at once?**
Yes, and each sees the other's changes live. Just do not type in the same
note in both at the same time: there is no locking, and the later save wins.
See [Your data and backups](data-and-backups.md).

## Notes and data

**Where are my notes?**
In `./scribedog-data` next to the compose file, as plain `.md` files.
Everything the app knows is in that folder. See
[Your data and backups](data-and-backups.md).

**Can I edit the files directly on the server?**
Yes, with any editor, over SSH, with a sync tool. Open browsers and desktop
apps see the change within a second.

**How do I back up?**
Back up the folder with restic, kopia or whatever you use, encrypted and with
history, from a cron job on the host. Backing up while the app runs is fine.

**Are the notes encrypted?**
Not by ScribeDog: they are plain Markdown on purpose. Use full-disk
encryption or gocryptfs below the folder if the box's location calls for it.
API keys and password are protected (encrypted, hashed).

**Will images show up on my phone?**
Yes: the web app resolves the relative image paths itself, unlike some
third-party Markdown apps used with a sync folder.

## AI

**Which AI providers work in the browser?**
OpenAI, Anthropic and Mistral through the server (the key never reaches the
browser), and Ollama, Jan.ai or LM Studio running on the device you browse
from, if they allow the page's origin. See [AI](ai.md).

**Can the server use the Ollama on my home server?**
Not yet: the server only forwards to the cloud providers, and a browser
reaches a local model server directly. The desktop app with a server vault
uses the model on your computer, as always.

**Where are my API keys?**
Encrypted on the server, under a key derived from your password. The browser
sees a placeholder that says "stored". A password reset (not a change) makes
them unreadable; enter them again then.

**Is there dictation?**
Not in the web app; use the system's dictation (Win+H, the macOS dictation
key, the keyboard microphone on phones), which types straight into the
editor. The desktop app's Whisper dictation works with a server vault.

## Updating

**How do I update?**
Set the new version in `SCRIBEDOG_IMAGE`, then `docker compose pull` and
`docker compose up -d`, or `git pull` and `docker compose up -d --build`.
Nobody is signed out. See [Updating](updating.md).

**The server refuses to start after I went back to an older version.**
The data folder was written by a newer server and its layout moved on. Start
the newer version again, or restore a backup from before the upgrade.

**Do the desktop app and the server have to match?**
Keep them at the same version where you can. The release notes say when a
release needs both updated together.
