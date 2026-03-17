// ──────────────────────────────────────────────
// Shopilot event logger
// Emits lightweight analytics events to stderr as structured JSON.
// GCP Cloud Run writes stderr to Cloud Logging automatically.
// Set up a Log Sink with filter:  jsonPayload._log_type="shopilot_event"
// to stream events into BigQuery.
// ──────────────────────────────────────────────

export type EventType =
  | "query_submitted"
  | "result_shown"
  | "no_results_shown"
  | "product_clicked"
  | "store_card_clicked"
  | "feedback_submitted"
  | "query_rewritten"
  | "session_ended";

export interface ShopilotEvent {
  _log_type: "shopilot_event";
  event_type: EventType;
  session_id: string;
  ts: string;           // ISO 8601 UTC
  query_text?: string;
  intent_detected?: string;
  retailer_routed?: string;
  item_no?: string;
  item_rank?: number;
  store_id?: string;
  retailer?: string;
  response_ms?: number;
  result_count?: number;
  feedback?: "thumbs_up" | "thumbs_down" | "no_results";
  country_code?: string;
  radius_km?: number;
  rewritten_to?: string;  // only for query_rewritten
}

const ENABLED = process.env.ENABLE_EVENTS === "true";

export function logEvent(fields: Omit<ShopilotEvent, "_log_type">): void {
  if (!ENABLED) return;
  const event: ShopilotEvent = { _log_type: "shopilot_event", ...fields };
  console.error(JSON.stringify(event));
}
