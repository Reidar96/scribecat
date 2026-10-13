import { getRelativeDisplayPath, isPathInsideVault, readMarkdownFile } from "@/lib/fileSystem";
import { readFile } from "@/platform/vaultFs";
import { pluginById, pluginPolicyForPath, type PluginCapability, type PluginId } from "@/plugins/registry";
import { useAppStore } from "@/store/useAppStore";
import { usePluginStore } from "@/store/usePluginStore";

/** Bundled Plugin API v1. External code execution requires a future sandbox. */
export type PluginApiV1 = {
  readonly apiVersion: 1;
  readonly id: PluginId;
  listMarkdown: () => string[];
  readMarkdown: (absolutePath: string) => Promise<string>;
  readAttachment: (absolutePath: string) => Promise<Uint8Array>;
  saveMarkdown: (absolutePath: string, markdown: string) => Promise<boolean>;
  openMarkdown: (absolutePath: string) => void;
  policyFor: (absolutePath: string) => ReturnType<typeof pluginPolicyForPath>;
};

export function createPluginApi(id: PluginId, vaultPath: string, onOpen: (path: string) => void): PluginApiV1 {
  const manifest = pluginById(id);
  if (!manifest) throw new Error("Unknown plugin");
  const current = () => {
    const { config, vaultPath: activeVault, ready } = usePluginStore.getState();
    if (!ready || activeVault !== vaultPath || !config.plugins[id]?.enabled) throw new Error("Plugin is disabled");
    return config;
  };
  const requireCapability = (capability: PluginCapability) => {
    if (!manifest.capabilities.includes(capability)) throw new Error(`Missing plugin capability: ${capability}`);
  };
  const ownPath = (absolutePath: string): string => {
    if (!isPathInsideVault(vaultPath, absolutePath)) throw new Error("Document is outside the vault");
    const relative = getRelativeDisplayPath(vaultPath, absolutePath).replace(/\\/g, "/");
    const folder = current().plugins[id]?.folder;
    if (!relative || relative.startsWith("/") || relative.split("/").some((part) => !part || part === ".." || part === ".") || !relative.toLowerCase().endsWith(".md")) {
      throw new Error("Invalid plugin document path");
    }
    if (folder && !relative.startsWith(`${folder}/`)) throw new Error("Document is outside the plugin folder");
    return relative;
  };
  return {
    apiVersion: 1,
    id,
    listMarkdown: () => {
      requireCapability("vaultRead");
      const { filePaths, folderPath } = useAppStore.getState();
      if (folderPath !== vaultPath) throw new Error("Vault changed");
      return filePaths.filter((path) => {
        try { ownPath(path); return true; } catch { return false; }
      });
    },
    readMarkdown: async (path) => {
      requireCapability("vaultRead");
      ownPath(path);
      return readMarkdownFile(path);
    },
    readAttachment: async (attachmentPath) => {
      requireCapability("attachments");
      const config = current();
      const folder = config.plugins[id]?.folder;
      if (!folder || !isPathInsideVault(vaultPath, attachmentPath)) throw new Error("Invalid attachment path");
      const relative = getRelativeDisplayPath(vaultPath, attachmentPath).replace(/\\/g, "/");
      if (!relative.startsWith(`${folder}/`) || !relative.split("/").includes("_attachments") || relative.split("/").includes("..")) throw new Error("Attachment is outside the plugin folder");
      return readFile(attachmentPath);
    },
    saveMarkdown: async (path, markdown) => {
      requireCapability("markdownWrite");
      ownPath(path);
      if (useAppStore.getState().folderPath !== vaultPath) throw new Error("Vault changed");
      return useAppStore.getState().createFileAtPath(path, markdown);
    },
    openMarkdown: (path) => { ownPath(path); onOpen(path); },
    policyFor: (path) => pluginPolicyForPath(current(), getRelativeDisplayPath(vaultPath, path))
  };
}
