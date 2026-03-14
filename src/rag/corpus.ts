import type { RetailerId } from "../core/types.js";

// ──────────────────────────────────────────────
// Policy corpus — curated chunks with metadata
// ──────────────────────────────────────────────

export interface PolicyChunk {
  retailer: RetailerId;
  domain: "returns" | "delivery" | "assembly";
  title: string;
  content: string;
  source: string;
  /** Pre-computed lowercase tokens for matching. */
  tokens: string[];
}

function chunk(
  domain: PolicyChunk["domain"],
  title: string,
  content: string,
  source: string,
): PolicyChunk {
  return {
    retailer: "ikea",
    domain,
    title,
    content,
    source,
    tokens: tokenize(content + " " + title),
  };
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

// ── IKEA Policy Corpus (US) ──

const RETURNS_URL = "https://www.ikea.com/us/en/customer-service/returns-claims/";
const DELIVERY_URL = "https://www.ikea.com/us/en/customer-service/services/delivery/";
const ASSEMBLY_URL = "https://www.ikea.com/us/en/customer-service/services/assembly/";

export const IKEA_CORPUS: PolicyChunk[] = [
  // ── Returns ──
  chunk("returns", "IKEA return policy — 365-day window",
    "Most IKEA products can be returned within 365 days of purchase with proof of purchase for a full refund. Items must be unused, in original packaging, and with all parts included. Opened mattresses have a 90-day return window.",
    RETURNS_URL),
  chunk("returns", "IKEA return policy — exceptions",
    "Custom countertops, modified or assembled kitchen products, cut fabric, plants, food items, and as-is products cannot be returned. Items purchased at a reduced clearance price are final sale.",
    RETURNS_URL),
  chunk("returns", "IKEA return methods",
    "Returns can be made in-store at the Returns & Exchanges counter or by scheduling a pickup for large items. Online orders can be returned in-store or through a scheduled home pickup (fees may apply for large items). Bring your receipt or order confirmation email.",
    RETURNS_URL),
  chunk("returns", "IKEA refund process",
    "Refunds are issued to the original payment method within 7-10 business days for credit/debit cards. Cash purchases over $250 are refunded by check mailed within 2-3 weeks. IKEA gift card purchases are refunded to a new gift card.",
    RETURNS_URL),
  chunk("returns", "IKEA exchange policy",
    "Exchanges can be made in-store for the same item or a different product. If the replacement has a higher price, you pay the difference. If lower, the difference is refunded. The 365-day return window applies to exchanges as well.",
    RETURNS_URL),

  // ── Delivery ──
  chunk("delivery", "IKEA delivery options overview",
    "IKEA offers several delivery options: standard truck delivery for large items (starting at $69), small parcel delivery via carrier for smaller items (starting at $5.99), and express/scheduled delivery where available. Delivery availability and pricing depend on your zip code and order contents.",
    DELIVERY_URL),
  chunk("delivery", "IKEA truck delivery details",
    "Truck delivery is available for large furniture and heavy items. Standard truck delivery typically arrives within 1-7 business days depending on location. You can choose a preferred delivery date during checkout. Delivery includes placement in a room of your choice on the ground floor.",
    DELIVERY_URL),
  chunk("delivery", "IKEA small parcel delivery",
    "Smaller items ship via standard parcel carriers (e.g. FedEx, UPS). Typical delivery time is 2-5 business days. Tracking information is emailed once the order ships. Free parcel delivery may be available on orders over a certain threshold.",
    DELIVERY_URL),
  chunk("delivery", "IKEA delivery area and fees",
    "Delivery is available to most US addresses. Delivery fees depend on your distance from the nearest IKEA store or distribution center. Remote areas may have higher fees or longer delivery windows. Check your zip code at checkout for exact pricing.",
    DELIVERY_URL),
  chunk("delivery", "IKEA Click & Collect",
    "Click & Collect lets you order online and pick up at your nearest IKEA store. Orders are typically ready within 2-4 hours during store hours. You will receive an email notification when your order is ready. Click & Collect is free of charge.",
    DELIVERY_URL),

  // ── Assembly ──
  chunk("assembly", "IKEA assembly service overview",
    "IKEA offers professional assembly through TaskRabbit. You can add assembly to your order during checkout or book it separately after purchase. Assembly pricing is based on the product category and complexity, typically starting at $36 for small items.",
    ASSEMBLY_URL),
  chunk("assembly", "IKEA assembly — TaskRabbit partnership",
    "TaskRabbit provides vetted and reviewed assemblers for IKEA furniture. You can choose your Tasker based on reviews, availability, and pricing. Assembly is covered by the TaskRabbit Happiness Pledge — if you're not satisfied, TaskRabbit will work to make it right.",
    ASSEMBLY_URL),
  chunk("assembly", "IKEA assembly tools and instructions",
    "Most IKEA furniture includes all necessary hardware and an Allen key. Common tools needed for assembly include a Phillips screwdriver, hammer, and level. Assembly instructions are included in the packaging and available online at IKEA.com by searching the product article number.",
    ASSEMBLY_URL),
  chunk("assembly", "IKEA assembly tips",
    "Read all instructions before starting. Identify all parts using the parts list. Assemble on a soft surface to avoid scratching. Never fully tighten screws until all pieces in a step are in place. Two people are recommended for large items like wardrobes, beds, and shelving units.",
    ASSEMBLY_URL),
  chunk("assembly", "IKEA assembly — wall anchoring",
    "All dressers, bookshelves, and storage units must be anchored to the wall for safety. IKEA includes tip-over restraint hardware with applicable products. Wall anchoring instructions are included in the assembly manual. If you lose the hardware, free replacement kits are available at any IKEA store.",
    ASSEMBLY_URL),
];
