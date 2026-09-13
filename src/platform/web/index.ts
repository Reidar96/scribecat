import { SessionError } from "@/platform/errors";
import type { Platform } from "@/platform/types";

import { posixPaths } from "./paths";
import { REMOTE_VAULT_ROOT, remoteVaultStorage } from "./remoteStorage";
import { getBasePath, onUnauthorized, serverApi } from "./serverApi";

/** API keys entered in the browser stay in memory for this tab only. */
const sessionApiKeys = new Map<string, string>();

/**
 * The browser talking to a ScribeDog server. Everything vault-related goes
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
    imagePicker: false,
    updater: false,
    voiceInput: false,
    portableMode: false,
    knowledgeIndex: false,
    spellcheckDictionary: false,
    session: true
  },

  vaultStorage: remoteVaultStorage,
  localFs: null,
  paths: posixPaths,

  vault: {
    allowFolderAccess: async () => undefined,
    allowFileAccess: async () => undefined,
    // Live updates from the server (the counterpart of the native watcher)
    // are a later stage; until then the list refreshes on the app's own
    // actions only.
    watchFolder: async () => undefined,
    // One server, one vault: nothing to choose, the session decides.
    getStartupFolderPath: async () => REMOTE_VAULT_ROOT,
    onFolderFilesChanged: async () => () => undefined,
    displayName: () => `${window.location.host}${getBasePath()}`
  },

  app: {
    getVersion: async () => __SCRIBEDOG_VERSION__
  },
  shell: {
    openUrl: async (url) => {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  },
  http: { fetch: (url, init) => window.fetch(url, init) },
  window: {
    setZoom: async (factor) => {
      document.body.style.setProperty("zoom", String(factor));
    },
    reveal: async () => undefined,
    isFullscreen: async () => document.fullscreenElement !== null,
    setFullscreen: async (fullscreen) => {
      if (fullscreen) {
        await document.documentElement.requestFullscreen();
      } else if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    }
  },
  credentials: {
    storeApiKey: async (id, apiKey) => {
      if (apiKey) {
        sessionApiKeys.set(id, apiKey);
      } else {
        sessionApiKeys.delete(id);
      }
    },
    getApiKey: async (id) => sessionApiKeys.get(id) ?? ""
  },
  portable: {
    getStatus: async () => ({ mode: "off", configDir: "" })
  },
  spellcheck: {
    // The browser brings its own dictionaries; there is nothing to install.
    checkDictionary: async () => ({ available: true, installCommand: null })
  },

  dialogs: null,
  voice: null,
  updater: null,
  knowledgeIndex: null,
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
    logout: () => serverApi.logout(),
    onUnauthorized
  }
};
