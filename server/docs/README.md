# ScribeCat Server Edition: User Guide

ScribeCat Server Edition runs the ScribeCat note editor as a self-hosted web
app. Your notes live in a folder on your own server, you edit them in the
browser or in the desktop app, and one password protects the instance.

This guide goes from the first start to the details. If you only want to get
running, [Getting started](getting-started.md) is enough; the rest is here
for when you need it.

## Contents

1. [Getting started](getting-started.md): requirements, installation, first
   sign-in, the certificate warning, opening the app on a phone.
2. [Multiple users on one host](multiuser.md): fresh setup, moving a single
   instance to multi-user, adding or removing a person later.
3. [Configuration](configuration.md): every setting, running under a path
   prefix, TLS and reverse proxies.
4. [The desktop app as a client](desktop-app.md): open the server vault in
   ScribeCat on your computer, with local desktop dictation.
5. [Phones and tablets](phones-and-tablets.md): how the app lays itself out
   on a small screen, and how to dictate.
6. [Security](security.md): the password, sessions, access keys for the
   desktop app, what is and is not protected.
7. [Your data and backups](data-and-backups.md): what is in the data folder,
   editing from more than one place, how to back it up.
8. [Updating](updating.md): versions, moving forward and back.
9. [API](api.md): every route, for scripts and your own tools.
10. [Development](development.md): running from source, tests.
11. [FAQ](faq.md): short answers to the questions that come up.

## In one paragraph

Run ScribeCat with Docker and Caddy for HTTPS, mounting an ordinary folder of Markdown files. The browser client provides the core writing, file organization, calendar, tasks, graph and PDF-viewing workspace on desktops, phones and tablets. The desktop app can connect to the same server vault. Local offline dictation is a desktop feature; AI writing and chat integrations are not included in ScribeCat. Back up the mounted data folder with your own tools.
