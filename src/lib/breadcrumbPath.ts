/**
 * The title row's breadcrumb: a vault-relative label split into the folders
 * leading to it plus the note itself. Pure string arithmetic on the label the
 * UI already shows (`selectedFileLabel`), not on a filesystem path — a folder
 * note is labelled by its folder, so its last crumb is the folder's name and
 * the crumbs before it are that folder's parents.
 *
 * The folder crumbs carry the vault-relative path of the folder, which is what
 * `openFolderNote` needs once the vault root is joined in front of it.
 */

export type PathCrumb = {
  /** The segment's own name, as shown. */
  name: string;
  /**
   * Vault-relative path of the folder this crumb stands for, or null for the
   * last crumb — that one is the open document and leads nowhere.
   */
  folderRelativePath: string | null;
};

/**
 * Splits a vault-relative label into its crumbs. Separators are always "/"
 * here: the label comes from `getRelativeDisplayPath`, which already
 * normalizes them. Empty segments (a doubled or trailing slash) are dropped,
 * so a directory label like "Ideas/Notes/" yields the two folders and no
 * empty leaf.
 */
export function getPathCrumbs(label: string): PathCrumb[] {
  const segments = label.split("/").filter((segment) => segment.length > 0);

  return segments.map((name, index) => ({
    name,
    folderRelativePath:
      index === segments.length - 1 ? null : segments.slice(0, index + 1).join("/")
  }));
}
