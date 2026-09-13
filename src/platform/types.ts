/**
 * The seam between the shared React frontend and whatever runs underneath it.
 *
 * ScribeDog has one frontend and two shells: the Tauri desktop app, where the
 * Rust process owns the filesystem, dialogs, microphone and credential store,
 * and the server edition, where a browser talks to the ScribeDog server over
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
 * Access to the open vault: notes, the images folder and the `.scribedog/`
 * metadata that lives next to them. Paths are absolute in the platform's own
 * notation; the web platform uses a virtual root (see `web/remoteStorage.ts`).
 *
 * `listMarkdownFiles` is a first-class operation rather than something
 * derived from `readDir`, because a remote vault answers it in one round trip
 * instead of one per directory.
 */
export type VaultStorage = FileSystemApi & {
  capabilities: VaultCapabilities;
  listMarkdownFiles(rootPath: string): Promise<MarkdownFileRecord[]>;
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

/** Native file/folder pickers. Desktop only. */
export type DialogsApi = {
  chooseFolder(options: { title: string; defaultPath?: string }): Promise<string | null>;
  chooseFiles(options: { title: string; filters: FileDialogFilter[]; defaultPath?: string }): Promise<string[]>;
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

export type SpellcheckDictionaryStatus = {
  available: boolean;
  installCommand: string | null;
};

/**
 * "ready": keys can be read and written.
 * "locked": the store is there but this session cannot open it. In the
 * browser that means the session predates the encrypted storage or a password
 * change; signing in again is the way back. The desktop credential store is
 * never locked.
 */
export type CredentialsStatus = {
  state: "ready" | "locked";
  /**
   * Set when stored keys had to be discarded because the password was reset
   * (the key that encrypted them is gone with the old password). The settings
   * dialog says so once; entering a key clears it.
   */
  discardedAt: string | null;
};

/**
 * Where API keys are kept: the OS credential store on the desktop, encrypted
 * in the data volume on the server (see server/src/secrets/).
 *
 * `getApiKey` does not promise to return the key itself. The server edition
 * answers with a placeholder (see ../secretRef.ts) that stands for "a key is
 * stored", travels through the AI client unchanged and is resolved by the
 * server on its way out. Anything that displays the value has to handle that.
 */
export type CredentialsApi = {
  storeApiKey(id: string, apiKey: string): Promise<void>;
  getApiKey(id: string): Promise<string>;
  getStatus(): Promise<CredentialsStatus>;
};

/**
 * The vault search index and its per-vault vector store. Both live in the
 * Rust process on the desktop; the server edition has no equivalent yet.
 */
export type KnowledgeIndexApi = {
  call<T>(command: string, args?: Record<string, unknown>): Promise<T>;
};

export type SessionStatus = {
  authenticated: boolean;
};

/**
 * Login/logout against the ScribeDog server. Web only: the desktop app is
 * its own trusted client and has no session.
 */
export type SessionApi = {
  getStatus(): Promise<SessionStatus>;
  /** Rejects with `SessionError` on a wrong password. */
  login(password: string): Promise<void>;
  logout(): Promise<void>;
  /**
   * Replaces the password. Every other session ends (the server bumps the
   * session epoch), this one keeps working, and the stored API keys are
   * re-encrypted under the new password. Rejects with `SessionError`
   * ("invalid_password" for a wrong current password, "weak_password" for a
   * new one the server refuses).
   */
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  /** Fires when any request is refused for lack of a session. */
  onUnauthorized(handler: () => void): () => void;
};

export type WindowApi = {
  setZoom(factor: number): Promise<void>;
  /** Shows and focuses the window once the first frame is painted. */
  reveal(): Promise<void>;
  isFullscreen(): Promise<boolean>;
  setFullscreen(fullscreen: boolean): Promise<void>;
};

export type PlatformFeatures = {
  /** Open/pick local folders, recent folders, startup folder from the CLI. */
  localFolders: boolean;
  /** Import notes from files picked in a native dialog. */
  importFiles: boolean;
  /** Export to a local folder picked in a native dialog. */
  exportFiles: boolean;
  /** Toolbar image button (native file picker). Paste and drop work everywhere. */
  imagePicker: boolean;
  updater: boolean;
  voiceInput: boolean;
  portableMode: boolean;
  /** Knowledge base (vault search index, embeddings). */
  knowledgeIndex: boolean;
  /** Linux dictionary check for the spellchecker. */
  spellcheckDictionary: boolean;
  /** Password login/logout. */
  session: boolean;
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
  shell: { openUrl(url: string): Promise<void> };
  http: { fetch(url: string, init?: RequestInit): Promise<Response> };
  window: WindowApi;
  credentials: CredentialsApi;
  portable: { getStatus(): Promise<PortableStatus> };
  spellcheck: { checkDictionary(language: string): Promise<SpellcheckDictionaryStatus> };

  dialogs: DialogsApi | null;
  voice: VoiceApi | null;
  updater: UpdaterApi | null;
  knowledgeIndex: KnowledgeIndexApi | null;
  session: SessionApi | null;
};
