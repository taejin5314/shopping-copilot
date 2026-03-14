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
  { retailer: "structube", storeId: "st-dufferin",    label: "Structube Dufferin",          city: "Toronto",      province: "ON", coords: { lat: 43.6568, lng: -79.4350 } },
  { retailer: "structube", storeId: "st-queen-west",  label: "Structube Queen West",        city: "Toronto",      province: "ON", coords: { lat: 43.6453, lng: -79.4112 } },
  { retailer: "structube", storeId: "st-yonge",       label: "Structube Yonge & Eglinton",  city: "Toronto",      province: "ON", coords: { lat: 43.7085, lng: -79.3985 } },
  { retailer: "structube", storeId: "st-heartland",   label: "Structube Heartland",         city: "Mississauga",  province: "ON", coords: { lat: 43.6332, lng: -79.7279 } },
  { retailer: "structube", storeId: "st-ottawa",      label: "Structube Ottawa Merivale",   city: "Ottawa",       province: "ON", coords: { lat: 45.3466, lng: -75.7286 } },
  { retailer: "structube", storeId: "st-burlington",  label: "Structube Burlington",        city: "Burlington",   province: "ON", coords: { lat: 43.3500, lng: -79.8100 } },
  { retailer: "structube", storeId: "st-kitchener",   label: "Structube Kitchener",         city: "Kitchener",    province: "ON", coords: { lat: 43.4268, lng: -80.4727 } },
  // Quebec
  { retailer: "structube", storeId: "st-dix30",       label: "Structube DIX30",             city: "Brossard",     province: "QC", coords: { lat: 45.4646, lng: -73.4512 } },
  { retailer: "structube", storeId: "st-laval",       label: "Structube Laval",             city: "Laval",        province: "QC", coords: { lat: 45.5618, lng: -73.7490 } },
  { retailer: "structube", storeId: "st-st-laurent",  label: "Structube Saint-Laurent",     city: "Montreal",     province: "QC", coords: { lat: 45.5017, lng: -73.6673 } },
  { retailer: "structube", storeId: "st-quebec-city", label: "Structube Quebec City",       city: "Quebec City",  province: "QC", coords: { lat: 46.8139, lng: -71.2080 } },
  // Western Canada
  { retailer: "structube", storeId: "st-vancouver",   label: "Structube Vancouver",         city: "Vancouver",    province: "BC", coords: { lat: 49.2827, lng: -123.1207 } },
  { retailer: "structube", storeId: "st-richmond",    label: "Structube Richmond",          city: "Richmond",     province: "BC", coords: { lat: 49.1666, lng: -123.1336 } },
  { retailer: "structube", storeId: "st-calgary",     label: "Structube Calgary",           city: "Calgary",      province: "AB", coords: { lat: 51.0447, lng: -114.0719 } },
  { retailer: "structube", storeId: "st-edmonton",    label: "Structube Edmonton",          city: "Edmonton",     province: "AB", coords: { lat: 53.5461, lng: -113.4938 } },
] as const;
