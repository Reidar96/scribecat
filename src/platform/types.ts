/**
 * The seam between the shared React frontend and whatever runs underneath it.
 *
 * ScribeCat has one frontend and two shells: the Tauri desktop app, where the
 * Rust process owns the filesystem, dialogs and microphone,
 * and the server edition, where a browser talks to the ScribeCat server over
 * HTTP. Everything the frontend needs from its shell goes through this
 * interface. The two implementations live in `./desktop` and `./web`; the Vite
 * config decides which one the `@platform-impl` alias resolves to, so the web
 * bundle never contains a single `@tauri-apps/*` import.
 *
 * Two kinds of members:
 *
 * - Storage and paths, which every platform provides. Vault access is one
 *   `VaultStorage` object; all the logic built on top of it (versioning,
 *   image cleanup, manual order, checkpoints, chat sessions) is shared and
 *   only ever touches these primitives.
 * - Native capabilities, which are `null` where the shell cannot provide them.
 *   Each of those has a matching entry in `features`, and the UI hides the
 *   element behind it rather than showing a control that cannot work.
 */

export type DirectoryEntry = {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
};

export type FileInfo = {
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  mtime: Date | null;
  birthtime: Date | null;
};

/**
 * Filesystem primitives with the same shape as `@tauri-apps/plugin-fs`, so the
 * desktop implementation is a straight re-export and the shared modules read
 * exactly as they did before the abstraction.
 */
export type FileSystemApi = {
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<FileInfo>;
  readDir(path: string): Promise<DirectoryEntry[]>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, contents: string): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
};

export type MarkdownFileRecord = {
  /** Absolute path in the platform's own notation (see `PathApi`). */
  filePath: string;
  /** Vault-relative, forward slashes: "Notes/Idea.md". */
  relativePath: string;
  mtimeMs: number;
};

/**
 * What the storage can do beyond listing, reading and overwriting notes.
 * Every entry maps to a set of controls in the UI, which are disabled (with
 * a hint) rather than hidden while the capability is missing: a server
 * vault gains them stage by stage, and the user should see that the action
 * exists and is coming, not wonder where it went.
 */
export type VaultCapabilities = {
  /** Create notes and folders. */
  create: boolean;
  /** Rename notes and folders. */
  rename: boolean;
  /** Move notes and folders (drag and drop) and reorder them manually. */
  move: boolean;
  /** Delete notes and folders. */
  delete: boolean;
  /** Store images in the vault (paste, drop, picker). */
  images: boolean;
};

export const ALL_VAULT_CAPABILITIES: VaultCapabilities = {
  create: true,
  rename: true,
  move: true,
  delete: true,
  images: true
};

/**
 * Access to the open vault: notes, the images folder and the `.scribecat/`
 * metadata that lives next to them. Paths are absolute in the platform's own
 * notation; the web platform uses a virtual root (see `remote/remoteStorage.ts`).
 *
 * `listMarkdownFiles` is a first-class operation rather than something
 * derived from `readDir`, because a remote vault answers it in one round trip
 * instead of one per directory.
 */
export type VaultStorage = FileSystemApi & {
  capabilities: VaultCapabilities;
  listMarkdownFiles(rootPath: string): Promise<MarkdownFileRecord[]>;
  /**
   * Packs a folder of the vault (notes, images, everything but the
   * `.scribecat/` metadata) into a ZIP archive of the raw files. Null for a
   * local folder, whose files are right there in the file manager. A server
   * vault answers it in one request (`GET /api/export/zip`), which is what
   * makes "get my notes out" possible from a browser at all.
   */
  packFolder: ((folderPath: string) => Promise<Uint8Array>) | null;
};

/**
 * Path arithmetic in the platform's notation. Async because the desktop
 * implementation is Tauri's, which asks the Rust side (and knows about
 * Windows separators); the web implementation is plain POSIX.
 */
export type PathApi = {
  join(...parts: string[]): Promise<string>;
  dirname(path: string): Promise<string>;
  normalize(path: string): Promise<string>;
};

export type FileDialogFilter = {
  name: string;
  extensions: string[];
};

export type DownloadFile = {
  fileName: string;
  data: Uint8Array | string;
  mimeType: string;
};

/**
 * Hands one finished file to the user. Where it ends up is the shell's
 * business: the browser saves it the way it saves any download, the desktop
 * asks with a save dialog. Resolves to false when the user cancelled that
 * dialog; a browser download never does. This is the last inch of every
 * export that cannot write into a folder of the user's choosing.
 */
export type DownloadsApi = {
  saveFile(file: DownloadFile): Promise<boolean>;
};

/** Native file/folder pickers. Desktop only. */
export type DialogsApi = {
  chooseFolder(options: { title: string; defaultPath?: string }): Promise<string | null>;
  chooseFiles(options: { title: string; filters: FileDialogFilter[]; defaultPath?: string }): Promise<string[]>;
};

/**
 * One file the user picked for insertion. The bytes are read on request
 * rather than up front, so a file that cannot be read is reported by name
 * without taking the others down with it.
 */
export type PickedImageFile = {
  fileName: string;
  read(): Promise<{ mimeType: string; data: Uint8Array }>;
};

export type ImagePickerOptions = {
  /** Where the native dialog opens. The browser's picker has no such notion. */
  defaultPath?: string;
  title: string;
  filterName: string;
  /** Without the dot. */
  extensions: string[];
};

/**
 * The toolbar's image button. Both shells have one: the desktop opens the
 * native dialog and reads the files from disk, the browser uses an
 * `<input type="file">`, which on a phone is what offers the camera and the
 * photo library. Paste and drop bypass this and hand the bytes over directly.
 */
export type ImagePickerApi = {
  pickImages(options: ImagePickerOptions): Promise<PickedImageFile[]>;
};

/**
 * What the shell does around a vault folder: widening its filesystem scope,
 * watching it for changes made outside the app, and telling the frontend
 * which vault to open at startup.
 */
export type VaultAccessApi = {
  allowFolderAccess(folderPath: string): Promise<void>;
  allowFileAccess(filePath: string): Promise<void>;
  watchFolder(folderPath: string): Promise<void>;
  /** Called once at startup; null means "no vault to open automatically". */
  getStartupFolderPath(): Promise<string | null>;
  /**
   * Subscribes to "files in this folder changed outside the editor". The
   * handler receives the watched folder path. Resolves to the unsubscribe.
   */
  onFolderFilesChanged(handler: (folderPath: string) => void): Promise<() => void>;
  /** Human-readable name of the open vault for the sidebar header. */
  displayName(folderPath: string): string;
};

export type VoiceModelStatus = {
  downloaded: boolean;
  downloading: boolean;
};

export type VoiceModelDownloadProgress = {
  downloadedBytes: number;
  totalBytes: number | null;
};

/** Whisper dictation through the native recorder. Desktop only. */
export type VoiceApi = {
  getModelStatus(): Promise<VoiceModelStatus>;
  downloadModel(): Promise<void>;
  startRecording(): Promise<void>;
  stopRecording(language: string | null): Promise<string>;
  cancelRecording(): Promise<void>;
  onModelDownloadProgress(handler: (progress: VoiceModelDownloadProgress) => void): Promise<() => void>;
  onLevel(handler: (rms: number) => void): Promise<() => void>;
};

export type AppUpdate = {
  version: string;
  downloadAndInstall(): Promise<void>;
};

/** The Windows in-app updater. Desktop only. */
export type UpdaterApi = {
  check(): Promise<AppUpdate | null>;
  relaunch(): Promise<void>;
};

/**
 * "on": the app keeps its own files next to the executable.
 * "readOnly": the portable marker was found, but that folder cannot be
 * written to (`C:\Program Files`, a read-only medium). The app falls back to
 * the OS directories, which is worth telling the user about: they expected the
 * machine to stay clean.
 */
export type PortableMode = "off" | "on" | "readOnly";

export type PortableStatus = {
  mode: PortableMode;
  /** Where the frontend writes the files it owns (shortcuts.json). */
  configDir: string;
};

export type SessionStatus = {
  authenticated: boolean;
};

/** A device holding an access token for this server; never the token itself. */
export type SessionDevice = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export type RemoteRequestInit = {
  method: string;
  headers: Record<string, string>;
  body?: string | Uint8Array;
};

/**
 * What the shell provides for opening a vault on a ScribeCat server: the
 * request path (the webview itself may not talk to an arbitrary host, see
 * src-tauri/src/remote_vault.rs), the credential store for the access
 * tokens, and the live-update connection. Desktop only; in the browser the
 * server is the one origin the page already lives on. The registry of added
 * servers and the token flow live above this, in lib/remoteVaults.ts.
 */
export type RemoteVaultsApi = {
  /**
   * Registers a server the user added. The shell refuses requests to any
   * other origin, the way it refuses files outside the opened folder.
   */
  allowServer(origin: string): Promise<void>;
  /** Sends one request; rejects when the server cannot be reached at all. */
  fetch(url: string, init: RemoteRequestInit): Promise<Response>;
  storeToken(vaultRoot: string, token: string): Promise<void>;
  getToken(vaultRoot: string): Promise<string | null>;
  deleteToken(vaultRoot: string): Promise<void>;
  /**
   * Keeps a live-update connection to the server's event stream and reports
   * changes through `vault.onFolderFilesChanged` with the vault root as the
   * folder path, so the watcher hook cannot tell it from a local folder.
   * Replaces the previous watch, local or remote.
   */
  watch(vaultRoot: string, eventsUrl: string, token: string): Promise<void>;
  /** Fires with the vault root when the live connection is refused for lack of a valid token. */
  onUnauthorized(handler: (vaultRoot: string) => void): Promise<() => void>;
};

/**
 * Login/logout against the ScribeCat server. Web only: the desktop app is
 * its own trusted client and has no session.
 */
export type SessionApi = {
  getStatus(): Promise<SessionStatus>;
  /** Rejects with `SessionError` on a wrong password. */
  login(password: string): Promise<void>;
  logout(): Promise<void>;
  /**
   * Replaces the password. Every other session ends (the server bumps the
   * session epoch), while this one receives a fresh session. Rejects with
   * `SessionError` for a wrong current password or a rejected new password.
   */
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  /** The devices (desktop apps) that hold an access token for this server. */
  listDevices(): Promise<SessionDevice[]>;
  /** Ends that device's access; its next request is refused. */
  revokeDevice(id: string): Promise<void>;
  /** Fires when any request is refused for lack of a session. */
  onUnauthorized(handler: () => void): () => void;
};

export type WindowApi = {
  setZoom(factor: number): Promise<void>;
  /** Shows and focuses the window once the first frame is painted. */
  reveal(): Promise<void>;
  isFullscreen(): Promise<boolean>;
  setFullscreen(fullscreen: boolean): Promise<void>;
  /**
   * Runs `handler` when the user closes the window, and closes it once the
   * handler has settled, whether it resolved or rejected: the app must always
   * let itself be closed. Desktop only; in the browser a tab closes without
   * asking, and the pending work is written on `pagehide` instead. Resolves
   * to the function that removes the handler.
   */
  onCloseRequested(handler: () => Promise<void>): Promise<() => void>;
};

export type PlatformFeatures = {
  /** Open/pick local folders, recent folders, startup folder from the CLI. */
  localFolders: boolean;
  /** Import notes from files picked in a native dialog. */
  importFiles: boolean;
  /** Export to a local folder picked in a native dialog. */
  exportFiles: boolean;
  /** Hand a finished file to the user without choosing a folder first (see DownloadsApi). */
  downloads: boolean;
  updater: boolean;
  voiceInput: boolean;
  portableMode: boolean;
  /** Password login/logout. */
  session: boolean;
  /** Vaults on a ScribeCat server next to local folders (see RemoteVaultsApi). */
  remoteVaults: boolean;
};

export type Platform = {
  kind: "desktop" | "web";
  features: PlatformFeatures;

  vaultStorage: VaultStorage;
  /**
   * The machine's own filesystem, for everything that is not the vault:
   * export targets, import sources, the app's config directory. Null in the
   * browser.
   */
  localFs: FileSystemApi | null;
  paths: PathApi;
  vault: VaultAccessApi;

  app: { getVersion(): Promise<string | null> };
  shell: {
    openUrl(url: string): Promise<void>;
    /**
     * Opens the OS file manager (Explorer/Finder/…) positioned inside the
     * given folder. Null where there is no native file manager to hand off
     * to (the browser in the web edition).
     */
    openFolderInFileManager: ((folderPath: string) => Promise<void>) | null;
  };
  http: { fetch(url: string, init?: RequestInit): Promise<Response> };
  window: WindowApi;
  portable: { getStatus(): Promise<PortableStatus> };

  dialogs: DialogsApi | null;
  imagePicker: ImagePickerApi;
  downloads: DownloadsApi | null;
  voice: VoiceApi | null;
  updater: UpdaterApi | null;
  session: SessionApi | null;
  remoteVaults: RemoteVaultsApi | null;
};
