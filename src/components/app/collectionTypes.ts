export type CollectionViewRequest =
  | {
      kind: "tag";
      tag: string;
      filePaths: string[];
    }
  | {
      kind: "folder";
      relativePath: string;
    };
