/**
 * Empty catalog boot. The app ships with no products: the seller adds every
 * product through the UI (POST /api/products) and every observation through
 * CSV upload (POST /api/data/upload). Tests create their own fixture rows
 * through the real API; nothing here is demo data.
 */
export function getEmptyDataset() {
  return { products: [], sales_history: {}, competitors: {} }
}
