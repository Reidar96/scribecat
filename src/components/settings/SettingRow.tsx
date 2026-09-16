import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";

import { InfoPopover } from "@/components/settings/InfoPopover";

type ControlIds = {
  /** For the control, so the label's htmlFor reaches it. */
  id: string;
  /** For aria-describedby; undefined when the row has no visible hint. */
  describedBy: string | undefined;
};

type SettingRowProps = {
  label: ReactNode;
  /**
   * One sentence, always visible: what the setting does. Anything longer —
   * background, side effects, where the value is stored — goes into `info`.
   */
  hint?: ReactNode;
  /** The long text, shown behind the (i) icon next to the label. */
  info?: string;
  /** A checkbox sits in front of its label; every other control sits below it. */
  layout?: "field" | "switch";
  /** Span both columns of the settings grid. */
  full?: boolean;
  /**
   * The control. A single element gets `id` and `aria-describedby` injected;
   * a compound control (several inputs in a row) takes a render function and
   * places them itself.
   */
  children: ReactElement | ((ids: ControlIds) => ReactNode);
};

/**
 * One setting: label, control, a one-line hint and, optionally, the long
 * explanation behind an (i) icon. Every row in the settings dialog goes
 * through here so the two-tier hints look and behave the same everywhere —
 * the exception being that a row may pass the model-class line the agent
 * switches need as its visible `hint`.
 */
export function SettingRow({ label, hint, info, layout = "field", full = false, children }: SettingRowProps) {
  const baseId = useId();
  const controlId = `${baseId}-control`;
  const hintId = hint ? `${baseId}-hint` : undefined;

  const control =
    typeof children === "function"
      ? children({ id: controlId, describedBy: hintId })
      : isValidElement(children)
        ? cloneElement(children as ReactElement<Record<string, unknown>>, {
            id: controlId,
            "aria-describedby": hintId
          })
        : children;

  const className = [
    "setting-row",
    layout === "switch" ? "setting-row--switch" : "",
    full || layout === "switch" ? "setting-row--full" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className}>
      <div className="setting-row__head">
        {layout === "switch" ? control : null}
        <label className="setting-row__label" htmlFor={controlId}>
          {label}
        </label>
        {info ? <InfoPopover text={info} /> : null}
      </div>
      {layout === "field" ? control : null}
      {hint ? (
        <p id={hintId} className="setting-row__hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
