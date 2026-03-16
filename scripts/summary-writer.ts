/**
 * Summary file writer for GitHub Actions job summaries.
 *
 * Resolves where to write the markdown summary (GITHUB_STEP_SUMMARY env var,
 * explicit --summary-file flag, or nowhere) and appends the markdown there.
 *
 * Design goals:
 *   - Non-throwing — failures are returned as Error, never thrown, so the
 *     main CLI result is never hidden by a summary write failure.
 *   - Optional — when no target is configured, writeSummary is a no-op.
 *   - Minimal — only appendFileSync; no streams, no queuing.
 */

/// <reference types="node" />

import { appendFileSync } from "node:fs";

// ── Target model ──

export type SummaryTarget =
  | { kind: "github" }            // use GITHUB_STEP_SUMMARY env var at write time
  | { kind: "file"; path: string }// explicit path (--summary-file=<path>)
  | { kind: "none" };             // disabled

// ── Target resolver ──

/**
 * Resolve the summary write target from argv and environment.
 *
 * Priority: --summary-file=<path> flag > $GITHUB_STEP_SUMMARY env > none.
 *
 * @param argv  Argument array to scan (e.g. process.argv.slice(2)).
 * @param env   Environment object (default: process.env).
 */
export function resolveSummaryTarget(
  argv: string[],
  env: Readonly<Record<string, string | undefined>> = process.env as Record<string, string | undefined>,
): SummaryTarget {
  for (const arg of argv) {
    const m = arg.match(/^--summary-file=(.+)$/);
    if (m) return { kind: "file", path: m[1] };
  }
  if (env["GITHUB_STEP_SUMMARY"]) return { kind: "github" };
  return { kind: "none" };
}

// ── Writer ──

/**
 * Append markdown to the resolved summary target.
 *
 * Uses appendFileSync so multiple writes (e.g. in a multi-step job) are
 * safe — consistent with how GitHub Actions itself recommends writing to
 * $GITHUB_STEP_SUMMARY.
 *
 * @param markdown  GFM markdown string to append.
 * @param target    Resolved target (from resolveSummaryTarget).
 * @param env       Environment object (default: process.env).
 * @returns         null on success or no-op, Error on write failure.
 */
export function writeSummary(
  markdown: string,
  target: SummaryTarget,
  env: Readonly<Record<string, string | undefined>> = process.env as Record<string, string | undefined>,
): Error | null {
  if (target.kind === "none") return null;

  const filePath =
    target.kind === "file"
      ? target.path
      : (env["GITHUB_STEP_SUMMARY"] ?? "");

  if (!filePath) return null;

  try {
    appendFileSync(filePath, markdown + "\n");
    return null;
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err));
  }
}
