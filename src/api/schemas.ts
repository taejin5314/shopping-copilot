import { z } from "zod";

// ──────────────────────────────────────────────
// Input validation for the API surface
// ──────────────────────────────────────────────

export const QueryInput = z.object({
  query: z.string().min(1).max(2000),
  retailer: z.string().optional(),
  countryCode: z.string().length(2).toUpperCase().optional(),
  location: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    })
    .optional(),
  cart: z
    .array(
      z.object({
        itemNo: z.string().min(1),
        quantity: z.number().int().min(1).max(99).default(1),
      }),
    )
    .optional(),
});

export type QueryInputType = z.infer<typeof QueryInput>;
