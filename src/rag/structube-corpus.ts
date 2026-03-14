import type { PolicyChunk } from "./corpus.js";
import { tokenize } from "./corpus.js";

// ──────────────────────────────────────────────
// Structube policy corpus — curated from structube.com customer service pages
// ──────────────────────────────────────────────

function chunk(
  domain: PolicyChunk["domain"],
  title: string,
  content: string,
  source: string,
): PolicyChunk {
  return {
    retailer: "structube",
    domain,
    title,
    content,
    source,
    tokens: tokenize(content + " " + title),
  };
}

const SRC_RETURNS = "https://www.structube.com/en_ca/customer-service#returns";
const SRC_DELIVERY = "https://www.structube.com/en_ca/customer-service#delivery";
const SRC_ASSEMBLY = "https://www.structube.com/en_ca/customer-service#assembly";

export const STRUCTUBE_CORPUS: PolicyChunk[] = [
  // ── Returns ──
  chunk(
    "returns",
    "Structube return policy",
    "Structube offers a 30-day return policy from the date of delivery or in-store pickup. Items must be unused, unassembled, and in their original packaging. A receipt or order confirmation is required for all returns.",
    SRC_RETURNS,
  ),
  chunk(
    "returns",
    "Structube return exceptions",
    "Final sale items, custom orders, and clearance products are not eligible for return. Mattresses may only be returned if unopened. Items showing signs of use, assembly, or damage caused by the customer cannot be returned.",
    SRC_RETURNS,
  ),
  chunk(
    "returns",
    "Structube refund process",
    "Refunds are processed to the original payment method within 5 to 10 business days after the returned item is received. In-store returns are refunded immediately. A restocking fee of 15% may apply to large furniture items.",
    SRC_RETURNS,
  ),
  // ── Delivery ──
  chunk(
    "delivery",
    "Structube delivery options",
    "Structube offers home delivery and in-store pickup. Delivery fees vary by region and order size. Standard delivery typically takes 2 to 8 weeks depending on product availability. Delivery is available across most of Canada.",
    SRC_DELIVERY,
  ),
  chunk(
    "delivery",
    "Structube white glove delivery",
    "White glove delivery service includes bringing furniture inside your home and placing it in the room of your choice. This service is available for an additional fee and includes removal of packaging materials. Assembly is not included with white glove delivery.",
    SRC_DELIVERY,
  ),
  chunk(
    "delivery",
    "Structube in-store pickup",
    "In-store pickup is available for in-stock items. You will receive a notification when your order is ready. Items must be picked up within 7 days. Large items may require a vehicle with adequate cargo space.",
    SRC_DELIVERY,
  ),
  // ── Assembly ──
  chunk(
    "assembly",
    "Structube assembly instructions",
    "Most Structube furniture requires self-assembly. Assembly instructions are included in the packaging and are also available on the product page. Common tools needed include a Phillips screwdriver and an Allen key, which is typically included.",
    SRC_ASSEMBLY,
  ),
  chunk(
    "assembly",
    "Structube assembly service",
    "Structube partners with third-party assembly providers in select cities. Assembly service can be added during checkout or arranged after delivery. Pricing depends on the item and location.",
    SRC_ASSEMBLY,
  ),
];
