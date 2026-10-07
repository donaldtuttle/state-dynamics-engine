import { BASINS, type BasinProjectionEvent } from "../../../src/engine.ts";

/** Retain the ledger's three-decimal precision without inventing missing data. */
export function projectionMetrics(event: BasinProjectionEvent): { primary: string; secondary?: string } {
  const primary = event.projectionDistance === undefined
    ? `Norm drop ${event.energyDrop.toFixed(3)}`
    : `State change ${event.projectionDistance.toFixed(3)}`;
  if (event.normChange === undefined) return { primary };
  const rounded = event.normChange.toFixed(3);
  const signed = Number(rounded) === 0 ? "0.000" : event.normChange > 0 ? `+${rounded}` : rounded;
  return { primary, secondary: `Norm change ${signed}` };
}

export function createProjectionLedgerItem(event: BasinProjectionEvent): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "event-item";
  const header = document.createElement("header");
  const label = document.createElement("span");
  label.textContent = `t=${event.step}  /  ${BASINS[event.basinId]?.label ?? `basin ${event.basinId}`}`;
  const metrics = projectionMetrics(event);
  const values = document.createElement("span");
  values.className = "event-metrics";
  const primary = document.createElement("span");
  primary.className = "event-delta";
  primary.textContent = metrics.primary;
  primary.title = event.projectionDistance === undefined
    ? "Clamped decrease in vector norm. Projection displacement was not recorded."
    : "Euclidean displacement caused by the basin projection alone.";
  values.append(primary);
  if (metrics.secondary !== undefined) {
    const secondary = document.createElement("span");
    secondary.className = "event-norm";
    secondary.textContent = metrics.secondary;
    secondary.title = "Post-projection norm minus pre-projection norm; positive means increased magnitude.";
    values.append(secondary);
  }
  header.append(label, values);
  const detail = document.createElement("p");
  detail.append(event.reason, document.createElement("br"), `${event.preHash} to ${event.postHash}`);
  item.append(header, detail);
  return item;
}
