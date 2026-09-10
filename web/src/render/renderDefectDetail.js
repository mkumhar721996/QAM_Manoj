import { escapeHtml } from "./htmlEscape.js";

const FIELDS = [
  { id: "title", label: "Title" },
  { id: "description", label: "Description" },
  { id: "severity", label: "Severity" },
  { id: "reporter", label: "Reporter" },
  { id: "stepsToReproduce", label: "Steps to reproduce" },
  { id: "environment", label: "Environment" },
];

export function renderDefectDetail(defect) {
  const rows = FIELDS.map(
    (field) => `
      <div class="field">
        <span class="field-label">${field.label}</span>
        <span id="defect-${field.id}">${escapeHtml(defect[field.id])}</span>
      </div>
    `,
  ).join("");

  return `
    <section id="defect-detail">
      <h2>Defect ${escapeHtml(defect.id)}</h2>
      <div class="field">
        <span class="field-label">Status</span>
        <span id="defect-status">${escapeHtml(defect.status)}</span>
      </div>
      ${rows}
    </section>
  `;
}
