/**
 * GitHub Actions job summary renderer for offline quality review.
 *
 * Converts PipelineRunResult + optional GateResult into GitHub-flavored
 * markdown suitable for $GITHUB_STEP_SUMMARY.
 *
 * Design goals:
 *   - Pure / deterministic — no I/O, no LLM, no network.
 *   - Safe for zero-data runs — all sections render cleanly when counts are 0.
 *   - Concise — fits on one screen in typical CI use; details live in the log.
 */

import type { PipelineRunResult } from "./review-pipeline.js";
import type { GateResult } from "./quality-gate.js";

// ── Helpers ──

function fmtActual(name: string, actual: number): string {
  return name === "maxFallbackRate"
    ? `${(actual * 100).toFixed(1)}%`
    : String(actual);
}

function fmtThreshold(n: number): string {
  return isFinite(n) ? String(n) : "∞";
}

// ── Renderer ──

/**
 * Render a concise GitHub-flavored markdown summary of a review + gate run.
 *
 * @param result   Full pipeline run result (required).
 * @param gate     Gate result, or null when the gate was not enabled.
 * @returns        A GFM string suitable for appending to $GITHUB_STEP_SUMMARY.
 *
 * Never throws.
 */
export function renderJobSummary(
  result: PipelineRunResult,
  gate: GateResult | null = null,
): string {
  const lines: string[] = [];
  const { reviewSummary: rs, importDiagnostics: diag, suggestionSummary: ss } = result;

  // ── Heading ──

  const passed = gate === null || gate.passed;
  const statusIcon = passed ? "✅" : "❌";

  if (gate === null) {
    lines.push(`## ${statusIcon} Quality Review`);
  } else {
    const label = gate.passed ? "PASSED" : "FAILED";
    lines.push(`## ${statusIcon} Quality Gate — ${label}`);
  }
  lines.push("");

  // ── Failed checks (prominent block, only when gate failed) ──

  if (gate !== null && !gate.passed) {
    lines.push("### ❌ Failed Checks");
    lines.push("");
    lines.push("| Check | Actual | Threshold | Override |");
    lines.push("|-------|--------|-----------|----------|");
    for (const c of gate.failedChecks) {
      lines.push(
        `| \`${c.name}\` | **${fmtActual(c.name, c.actual)}** | ${fmtThreshold(c.threshold)} | \`${c.hint}\` |`,
      );
    }
    lines.push("");
  }

  // ── Review summary table ──

  lines.push("### Review Summary");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|--------|-------|");
  lines.push(`| Reviewed | ${rs.totalReviewed} |`);
  lines.push(`| Imported | ${diag.importedCount} |`);
  if (diag.skippedCount > 0) {
    lines.push(`| Skipped | ${diag.skippedCount} |`);
  }
  if (diag.partialImports > 0) {
    lines.push(`| Partial imports | ${diag.partialImports} |`);
  }
  lines.push(`| Total findings | ${rs.totalFindings} |`);
  lines.push(`| Queries with failures | ${rs.queriesWithFailures} |`);
  lines.push(`| Queries with warnings | ${rs.queriesWithWarnings} |`);
  lines.push(`| Fallback rate (Route B) | ${(rs.fallbackRate * 100).toFixed(0)}% |`);
  lines.push(`| Fixture suggestions | ${ss.total} (${ss.needingManualReview} need review) |`);
  lines.push("");

  // ── Passing gate checks (compact, only finite-threshold ones) ──

  if (gate !== null && gate.passed) {
    const finiteChecks = gate.passingChecks.filter((c) => isFinite(c.threshold));
    if (finiteChecks.length > 0) {
      lines.push("### ✅ Gate Checks");
      lines.push("");
      lines.push("| Check | Actual | Threshold |");
      lines.push("|-------|--------|-----------|");
      for (const c of finiteChecks) {
        lines.push(
          `| \`${c.name}\` | ${fmtActual(c.name, c.actual)} | ${fmtThreshold(c.threshold)} |`,
        );
      }
      lines.push("");
    }
  }

  // ── Top issue categories ──

  if (rs.topCategories.length > 0) {
    lines.push("### Top Issue Categories");
    lines.push("");
    for (const { category, count } of rs.topCategories.slice(0, 5)) {
      lines.push(`- \`${category}\`: ${count}`);
    }
    lines.push("");
  }

  // ── Common warnings ──

  if (rs.commonWarnings.length > 0) {
    lines.push("### Common Warnings");
    lines.push("");
    for (const { warning, count } of rs.commonWarnings.slice(0, 5)) {
      lines.push(`- ${warning} (×${count})`);
    }
    lines.push("");
  }

  // ── Gate meta-warnings (e.g. "all thresholds are Infinity") ──

  if (gate !== null && gate.warnings.length > 0) {
    for (const w of gate.warnings) {
      lines.push(`> **Note:** ${w}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
