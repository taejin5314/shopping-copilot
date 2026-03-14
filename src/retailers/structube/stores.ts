import type { StoreRef } from "../../core/types.js";

// ──────────────────────────────────────────────
// Static Structube store data
// Source: structube.com/en_ca/storelocator (public store locator)
// Structube operates ~40 stores, all in Canada.
// ──────────────────────────────────────────────

export interface StructubeStore extends StoreRef {
  city: string;
  province: string;
}

export const STRUCTUBE_STORES: readonly StructubeStore[] = [
  // Ontario
  { retailer: "structube", storeId: "st-dufferin",    label: "Structube Dufferin",          city: "Toronto",      province: "ON" },
  { retailer: "structube", storeId: "st-queen-west",  label: "Structube Queen West",        city: "Toronto",      province: "ON" },
  { retailer: "structube", storeId: "st-yonge",       label: "Structube Yonge & Eglinton",  city: "Toronto",      province: "ON" },
  { retailer: "structube", storeId: "st-heartland",   label: "Structube Heartland",         city: "Mississauga",  province: "ON" },
  { retailer: "structube", storeId: "st-ottawa",      label: "Structube Ottawa Merivale",   city: "Ottawa",       province: "ON" },
  { retailer: "structube", storeId: "st-burlington",  label: "Structube Burlington",        city: "Burlington",   province: "ON" },
  { retailer: "structube", storeId: "st-kitchener",   label: "Structube Kitchener",         city: "Kitchener",    province: "ON" },
  // Quebec
  { retailer: "structube", storeId: "st-dix30",       label: "Structube DIX30",             city: "Brossard",     province: "QC" },
  { retailer: "structube", storeId: "st-laval",       label: "Structube Laval",             city: "Laval",        province: "QC" },
  { retailer: "structube", storeId: "st-st-laurent",  label: "Structube Saint-Laurent",     city: "Montreal",     province: "QC" },
  { retailer: "structube", storeId: "st-quebec-city", label: "Structube Quebec City",       city: "Quebec City",  province: "QC" },
  // Western Canada
  { retailer: "structube", storeId: "st-vancouver",   label: "Structube Vancouver",         city: "Vancouver",    province: "BC" },
  { retailer: "structube", storeId: "st-richmond",    label: "Structube Richmond",          city: "Richmond",     province: "BC" },
  { retailer: "structube", storeId: "st-calgary",     label: "Structube Calgary",           city: "Calgary",      province: "AB" },
  { retailer: "structube", storeId: "st-edmonton",    label: "Structube Edmonton",          city: "Edmonton",     province: "AB" },
] as const;
