export type GlobalKeyAction = "toggle-run" | null;

const INTERACTIVE_SELECTOR =
  "input, select, textarea, button, a[href], summary, canvas, [contenteditable='true']";

type ClosestTarget = {
  closest: (selector: string) => unknown;
};

export function routeGlobalKey(
  code: string,
  target: ClosestTarget | null,
): GlobalKeyAction {
  if (target?.closest(INTERACTIVE_SELECTOR)) return null;
  return code === "Space" ? "toggle-run" : null;
}
