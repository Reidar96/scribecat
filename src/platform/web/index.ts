import { guessImageMimeType } from "@/lib/imageMimeTypes";
import { SessionError } from "@/platform/errors";
import type { Platform } from "@/platform/types";

import { browserDownloads } from "./downloads";
import { subscribeToVaultChanges } from "./liveUpdates";
import { posixPaths } from "@/platform/remote/paths";
import { REMOTE_VAULT_ROOT, remoteVaultStorage } from "./remoteStorage";
import {
  ApiError,
  getBasePath,
  onUnauthorized,
  serverApi
} from "./serverApi";

/**
 * The browser talking to a ScribeCat server. Everything vault-related goes
 * over the server API; everything the desktop shell provides natively is
 * either replaced by a browser equivalent (fullscreen, window.open, CSS
 * zoom) or declared unavailable so the UI hides it.
 */
export const platform: Platform = {
  kind: "web",
  features: {
    localFolders: false,
    importFiles: false,
    exportFiles: false,
    downloads: true,
    updater: false,
    voiceInput: false,
    portableMode: false,
    spellcheckDictionary: false,
    session: true,
    remoteVaults: false
  },

  vaultStorage: remoteVaultStorage,
  localFs: null,
  paths: posixPaths,

  vault: {
    allowFolderAccess: async () => undefined,
    allowFileAccess: async () => undefined,
    // The change stream is per tab, not per folder (there is only one), so
    // subscribing is what "watching" means here.
    watchFolder: async () => undefined,
    // One server, one vault: nothing to choose, the session decides.
    getStartupFolderPath: async () => REMOTE_VAULT_ROOT,
    onFolderFilesChanged: async (handler) => subscribeToVaultChanges(() => handler(REMOTE_VAULT_ROOT)),
    displayName: () => `${window.location.host}${getBasePath()}`
  },

  app: {
    getVersion: async () => __SCRIBECAT_VERSION__
  },
  shell: {
    openUrl: async (url) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    openFolderInFileManager: null
  },
  http: {
    fetch: (url, init) => window.fetch(url, init)
  },
  window: {
    setZoom: async (factor) => {
      // The stylesheet decides what the factor scales (responsive.css): the
      // whole page on a wide viewport, only the document text on a narrow
      // one, where a body-level zoom fights the pinch zoom and the viewport.
      document.documentElement.style.setProperty("--app-zoom", String(factor));
    },
    reveal: async () => undefined,
    // A tab has no close request to intercept; hooks that need the moment
    // before unload listen to pagehide themselves.
    onCloseRequested: async () => () => undefined,
    isFullscreen: async () => document.fullscreenElement !== null,
    setFullscreen: async (fullscreen) => {
      if (fullscreen) {
        await document.documentElement.requestFullscreen();
      } else if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    }
  },
  portable: {
    getStatus: async () => ({ mode: "off", configDir: "" })
  },
  spellcheck: {
    // The browser brings its own dictionaries; there is nothing to install.
    checkDictionary: async () => ({ available: true, installCommand: null })
  },

  dialogs: null,
  imagePicker: {
    pickImages: ({ extensions }) =>
      new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.multiple = true;
        // The extensions keep a desktop browser to what the editor renders;
        // "image/*" is what makes a phone offer the camera and the library.
        input.accept = [...extensions.map((extension) => `.${extension}`), "image/*"].join(",");
        input.addEventListener("change", () => {
          resolve(
            Array.from(input.files ?? []).map((file) => ({
              fileName: file.name,
              read: async () => ({
                mimeType: file.type || guessImageMimeType(file.name),
                data: new Uint8Array(await file.arrayBuffer())
              })
            }))
          );
        });
        // Dismissing the picker: browsers have fired this since 2023; where
        // one does not, the promise simply never settles, and nothing waits
        // on it but the click handler.
        input.addEventListener("cancel", () => resolve([]));
        input.click();
      })
  },
  downloads: browserDownloads,
  voice: null,
  updater: null,
  session: {
    getStatus: () => serverApi.session(),
    login: async (password) => {
      try {
        await serverApi.login(password);
      } catch (error) {
        if (error instanceof SessionError) {
          throw error;
        }

        throw new SessionError("error", error instanceof Error ? error.message : String(error));
      }
    },
    logout: async () => {
      await serverApi.logout();
    },
    changePassword: async (currentPassword, newPassword) => {
      try {
        await serverApi.changePassword(currentPassword, newPassword);
      } catch (error) {
        if (error instanceof SessionError) {
          throw error;
        }

        if (error instanceof ApiError) {
          throw new SessionError(error.code === "weak_password" ? "weak_password" : "error", error.message);
        }

        throw new SessionError("error", error instanceof Error ? error.message : String(error));
      }

    },
    listDevices: () => serverApi.listTokens(),
    revokeDevice: (id) => serverApi.revokeToken(id),
    onUnauthorized
  },
  remoteVaults: null
};
