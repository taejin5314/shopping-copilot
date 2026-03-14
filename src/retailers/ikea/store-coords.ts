// Static lat/lng for every IKEA store tracked by ikea-mcp.
// Coordinates sourced from IKEA store finder pages (Google Maps pins).
// Used for client-side radius filtering before calling the stock API.

export const IKEA_STORE_COORDS: Record<string, { lat: number; lng: number }> = {
  // ── United States ──
  "026": { lat: 42.3072, lng: -83.4345 },  // Canton, MI
  "027": { lat: 30.5619, lng: -97.6701 },  // Round Rock, TX
  "028": { lat: 45.5066, lng: -122.4169 }, // Portland, OR
  "042": { lat: 27.9614, lng: -82.4931 },  // Tampa, FL
  "064": { lat: 39.5725, lng: -104.8715 }, // Centennial, CO
  "067": { lat: 35.2171, lng: -80.7564 },  // Charlotte, NC
  "103": { lat: 40.5317, lng: -111.8637 }, // Draper, UT
  "145": { lat: 28.3884, lng: -81.4239 },  // Orlando, FL
  "152": { lat: 39.2018, lng: -76.6721 },  // Baltimore, MD
  "153": { lat: 40.3960, lng: -79.8959 },  // Pittsburgh, PA
  "154": { lat: 40.6780, lng: -74.1709 },  // Elizabeth, NJ
  "156": { lat: 40.7491, lng: -73.1756 },  // Long Island, NY
  "157": { lat: 38.5739, lng: -121.5399 }, // West Sacramento, CA
  "158": { lat: 42.1145, lng: -71.0904 },  // Stoughton, MA
  "162": { lat: 33.8255, lng: -118.2646 }, // Carson, CA
  "165": { lat: 37.8382, lng: -122.2910 }, // Emeryville, CA
  "166": { lat: 32.7881, lng: -117.1547 }, // San Diego, CA
  "167": { lat: 33.6861, lng: -117.8873 }, // Costa Mesa, CA
  "168": { lat: 38.6559, lng: -77.2703 },  // Woodbridge, VA
  "170": { lat: 41.7183, lng: -88.0792 },  // Bolingbrook, IL
  "175": { lat: 39.3311, lng: -84.3949 },  // West Chester, OH
  "183": { lat: 33.1148, lng: -96.8195 },  // Frisco, TX
  "207": { lat: 26.1493, lng: -80.2861 },  // Sunrise, FL
  "209": { lat: 33.3827, lng: -111.9468 }, // Tempe, AZ
  "210": { lat: 42.0104, lng: -88.0611 },  // Schaumburg, IL
  "211": { lat: 40.0703, lng: -75.3174 },  // Conshohocken, PA
  "212": { lat: 44.8635, lng: -93.2412 },  // Minneapolis, MN
  "213": { lat: 41.3246, lng: -72.8654 },  // New Haven, CT
  "215": { lat: 39.9198, lng: -75.1485 },  // South Philadelphia, PA
  "257": { lat: 33.7825, lng: -84.3636 },  // Atlanta, GA
  "327": { lat: 25.7817, lng: -80.3193 },  // Miami, FL
  "347": { lat: 37.4509, lng: -122.1316 }, // East Palo Alto, CA
  "374": { lat: 38.9936, lng: -94.6915 },  // Merriam, KS
  "379": { lat: 29.7930, lng: -95.4191 },  // Houston, TX
  "399": { lat: 34.1608, lng: -118.3013 }, // Burbank, CA
  "409": { lat: 40.9291, lng: -74.0760 },  // Paramus, NJ
  "410": { lat: 38.6356, lng: -90.3412 },  // St. Louis, MO
  "411": { lat: 38.9953, lng: -76.9137 },  // College Park, MD
  "413": { lat: 34.0758, lng: -117.8872 }, // Covina, CA
  "462": { lat: 36.1215, lng: -115.1739 }, // Las Vegas, NV
  "488": { lat: 47.4580, lng: -122.1929 }, // Renton, WA
  "508": { lat: 35.0837, lng: -89.8495 },  // Memphis, TN
  "511": { lat: 40.0539, lng: -82.8866 },  // Columbus, OH
  "535": { lat: 32.7332, lng: -97.0039 },  // Grand Prairie, TX
  "536": { lat: 39.9608, lng: -86.0126 },  // Fishers, IN
  "537": { lat: 30.2454, lng: -81.5181 },  // Jacksonville, FL
  "560": { lat: 42.8700, lng: -87.8834 },  // Oak Creek, WI
  "569": { lat: 36.8281, lng: -76.1802 },  // Norfolk, VA
  "570": { lat: 29.5578, lng: -98.3473 },  // Live Oak, TX
  "921": { lat: 40.6729, lng: -73.9961 },  // Brooklyn, NY
  "1099": { lat: 32.8524, lng: -96.7955 }, // University Park, TX
  "1129": { lat: 43.0875, lng: -76.0780 }, // Syracuse, NY
  // ── Canada ──
  "003": { lat: 49.1744, lng: -123.0890 }, // Richmond, BC
  "004": { lat: 45.3381, lng: -75.7559 },  // Ottawa, ON
  "039": { lat: 45.4467, lng: -73.6756 },  // Montreal, QC
  "040": { lat: 43.3633, lng: -79.7595 },  // Burlington, ON
  "149": { lat: 43.7641, lng: -79.4085 },  // North York, ON
  "216": { lat: 51.0942, lng: -114.0172 }, // Calgary, AB
  "249": { lat: 49.8605, lng: -97.2688 },  // Winnipeg, MB
  "256": { lat: 43.6509, lng: -79.5671 },  // Etobicoke, ON
  "313": { lat: 49.2479, lng: -122.8015 }, // Coquitlam, BC
  "349": { lat: 53.4652, lng: -113.5592 }, // Edmonton, AB
  "372": { lat: 43.7926, lng: -79.5307 },  // Vaughan, ON
  "414": { lat: 45.5686, lng: -73.4337 },  // Boucherville, QC
  "529": { lat: 44.6724, lng: -63.5890 },  // Halifax, NS
  "559": { lat: 46.8498, lng: -71.2504 },  // Quebec City, QC
  "659": { lat: 43.6449, lng: -79.3856 },  // Toronto Downtown, ON
};
