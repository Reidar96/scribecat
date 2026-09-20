import { useState } from "react";
import { useTranslation } from "react-i18next";

import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { Check, ChevronDown, Copy } from "lucide-react";

import {
  Menu,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger
} from "@/components/ui/menu";
import { CODE_LANGUAGES } from "@/lib/codeLanguages";

const PLAIN_VALUE = "";

export function CodeBlockView({ node, updateAttributes, selected }: ReactNodeViewProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const language = ((node.attrs.language as string | null) ?? "").trim();
  const known = CODE_LANGUAGES.find((entry) => entry.value === language);
  // A fence language outside the curated set (```haskell) stays selectable so
  // switching away from it is possible without losing the fence info first.
  const label = known?.label ?? (language || t("codeBlock.plain"));

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(node.textContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (e.g. missing permission)
    }
  };

  return (
    <NodeViewWrapper className="code-block-wrapper">
      {/* Two small badges on the block's top edge instead of a button bar
          overlaying the first line: the content area stays free. The
          language badge opens the switch menu; it is the trigger, never the
          block itself, so a click into the code still only places the
          caret. Copy sits next to it as its own one-click button. */}
      <div
        className={
          selected || copied ? "code-block-wrapper__badge code-block-wrapper__badge--visible" : "code-block-wrapper__badge"
        }
        contentEditable={false}
      >
        <Menu>
          <MenuTrigger
            render={
              <button
                type="button"
                className="code-block-wrapper__badge-button"
                aria-label={t("codeBlock.language")}
                title={t("codeBlock.language")}
              >
                {label}
                <ChevronDown size={12} aria-hidden="true" />
              </button>
            }
          />
          <MenuPortal>
            <MenuPositioner align="end">
              <MenuPopup className="max-h-72 overflow-y-auto">
                <MenuRadioGroup
                  value={language}
                  onValueChange={(value) =>
                    updateAttributes({ language: value === PLAIN_VALUE ? null : (value as string) })
                  }
                >
                  <MenuRadioItem value={PLAIN_VALUE}>
                    {t("codeBlock.plain")}
                    <MenuRadioItemIndicator />
                  </MenuRadioItem>
                  {!known && language ? (
                    <MenuRadioItem value={language}>
                      {language}
                      <MenuRadioItemIndicator />
                    </MenuRadioItem>
                  ) : null}
                  {CODE_LANGUAGES.map((entry) => (
                    <MenuRadioItem key={entry.value} value={entry.value}>
                      {entry.label}
                      <MenuRadioItemIndicator />
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuPopup>
            </MenuPositioner>
          </MenuPortal>
        </Menu>
        <button
          type="button"
          className="code-block-wrapper__badge-button"
          onClick={handleCopy}
          aria-label={t("codeBlock.copy")}
          title={t("codeBlock.copy")}
        >
          {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
        </button>
      </div>
      <pre>
        <NodeViewContent<"code"> as="code" />
      </pre>
    </NodeViewWrapper>
  );
}
