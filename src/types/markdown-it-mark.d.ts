declare module "markdown-it-mark" {
  import type MarkdownIt from "markdown-it";

  const insPlugin: (md: MarkdownIt) => void;
  export default insPlugin;
}
