/**
 * Deterministic synthetic demo data for Mercury — Amazon Seller Intelligence.
 * All values are synthetic. Demand patterns deliberately differ per product
 * (rising / declining / stable / seasonal) so analytics produce variety.
 */
import { mulberry32 } from '../../../shared/analytics.js'

export const SELLER_ID = 'SELLER001'
export const SELLER_NAME = 'Mercury Traders'
export const DAYS = 120

// ---------- product blueprints ----------
const BLUEPRINTS = [
  {
    id: 'P001',
    title: 'Wireless Earbuds Pro X2',
    category: 'Electronics',
    subcategory: 'Wireless Earbuds',
    seed: 101,
    basePrice: 1599,
    rating: 4.3,
    discount: 10,
    inventory: 220,
    priceDriftPct: -0.06, // seller cut price gradually over the window
    demand: { base: 25, slopePerDay: 0.35, weekly: { 5: 1.25, 6: 1.15 }, noise: 0.18, events: { 100: 2.2 } },
    competitorBasePrice: 1549,
    competitors: [
      { id: 'C001', title: 'SoundCore Air Buds', rating: 4.1, discount: 15, jitter: 40 },
      { id: 'C002', title: 'boAt Airdopes 451', rating: 4.0, discount: 20, jitter: 60 },
      { id: 'C003', title: 'Noise Buds VS104', rating: 4.2, discount: 10, jitter: 30 },
      { id: 'C004', title: 'realme Buds T300', rating: 4.3, discount: 12, jitter: 45 },
      { id: 'C005', title: 'pTron Bassbuds Zen', rating: 3.8, discount: 25, jitter: 70 },
    ],
  },
  {
    id: 'P002',
    title: 'Smart Watch Fit Plus',
    category: 'Electronics',
    subcategory: 'Smart Watches',
    seed: 202,
    basePrice: 2499,
    rating: 4.1,
    discount: 5,
    inventory: 160,
    priceDriftPct: 0.03, // seller nudged price up
    demand: { base: 20, slopePerDay: -0.08, weekly: { 0: 1.1 }, noise: 0.22, events: {} },
    competitorBasePrice: 2399,
    competitors: [
      { id: 'C006', title: 'Noise ColorFit Pulse', rating: 4.2, discount: 18, jitter: 55 },
      { id: 'C007', title: 'Fire-Boltt Ninja Call 2', rating: 4.0, discount: 22, jitter: 80 },
      { id: 'C008', title: 'boAt Wave Call 2', rating: 4.0, discount: 15, jitter: 65 },
      { id: 'C009', title: 'Fastrack Reflex Vox', rating: 3.9, discount: 12, jitter: 50 },
      { id: 'C010', title: 'pTron Pulsefit P1', rating: 3.7, discount: 28, jitter: 90 },
    ],
  },
  {
    id: 'P003',
    title: 'ErgoLift Laptop Stand',
    category: 'Accessories',
    subcategory: 'Laptop Stands',
    seed: 303,
    basePrice: 899,
    rating: 4.5,
    discount: 0,
    inventory: 340,
    priceDriftPct: 0,
    demand: { base: 30, slopePerDay: 0.02, weekly: { 3: 1.12 }, noise: 0.15, events: {} },
    competitorBasePrice: 879,
    competitors: [
      { id: 'C011', title: 'Portronics My Buddy K2', rating: 4.3, discount: 8, jitter: 25 },
      { id: 'C012', title: 'Tukzer Zero-D Lapdesk', rating: 4.0, discount: 10, jitter: 35 },
      { id: 'C013', title: 'AmazonBasics Laptop Stand', rating: 4.1, discount: 0, jitter: 20 },
      { id: 'C014', title: 'STRIFF Adjustable Stand', rating: 3.9, discount: 15, jitter: 45 },
      { id: 'C015', title: 'Portronics My Buddy Plus', rating: 4.2, discount: 5, jitter: 30 },
    ],
  },
  {
    id: 'P004',
    title: 'USB-C Hub 7-in-1',
    category: 'Electronics',
    subcategory: 'USB Hubs',
    seed: 404,
    basePrice: 2199,
    rating: 4.2,
    discount: 8,
    inventory: 120,
    priceDriftPct: -0.04,
    demand: { base: 18, slopePerDay: 0.12, weekly: { 2: 1.15, 3: 1.08 }, noise: 0.2, events: { 45: 1.6, 88: 1.5 } },
    competitorBasePrice: 2149,
    competitors: [
      { id: 'C016', title: 'Mi 8-in-1 Type-C Hub', rating: 4.1, discount: 12, jitter: 55 },
      { id: 'C017', title: 'Portronics Mport 31C', rating: 4.0, discount: 15, jitter: 70 },
      { id: 'C018', title: 'Zebronics 9-in-1 Hub', rating: 3.9, discount: 10, jitter: 40 },
      { id: 'C019', title: 'Amkette Multiport Pro', rating: 4.2, discount: 8, jitter: 30 },
      { id: 'C020', title: 'AmazonBasics 6-in-1 Hub', rating: 4.0, discount: 5, jitter: 45 },
    ],
  },
  {
    id: 'P005',
    title: 'Portable Bluetooth Speaker',
    category: 'Electronics',
    subcategory: 'Bluetooth Speakers',
    seed: 505,
    basePrice: 1799,
    rating: 4.0,
    discount: 12,
    inventory: 95,
    priceDriftPct: 0.02,
    demand: { base: 22, slopePerDay: 0.1, weekly: { 5: 1.35, 6: 1.4, 0: 1.2 }, noise: 0.25, events: { 60: 1.8, 95: 1.9 } },
    competitorBasePrice: 1749,
    competitors: [
      { id: 'C021', title: 'boAt Stone 350', rating: 4.1, discount: 20, jitter: 60 },
      { id: 'C022', title: 'JBL Go 3', rating: 4.3, discount: 5, jitter: 90 },
      { id: 'C023', title: 'Sony SRS-XB12', rating: 4.2, discount: 8, jitter: 75 },
      { id: 'C024', title: 'Zebronics County', rating: 3.8, discount: 30, jitter: 55 },
      { id: 'C025', title: 'Artis Soundpro 20', rating: 3.9, discount: 25, jitter: 40 },
    ],
  },
]

// ---------- date helpers ----------
export function buildDates(days = DAYS) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dates = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    dates.push(d)
  }
  return dates
}

function isoDate(d) {
  return d.toISOString().slice(0, 10)
}

// ---------- generators ----------
export function generateProductSales(bp, dates) {
  const rnd = mulberry32(bp.seed)
  const { base, slopePerDay, weekly, noise, events } = bp.demand
  const series = []
  for (let i = 0; i < dates.length; i++) {
    const priceFactor = 1 + bp.priceDriftPct * (i / (dates.length - 1))
    const slopeFactor = 1 + (slopePerDay * i) / base
    const dow = dates[i].getDay()
    const week = weekly[dow] || 1
    const event = events[i] || 1
    const noiseFactor = 1 + (rnd() * 2 - 1) * noise
    const units = Math.max(0, Math.round(base * priceFactor * slopeFactor * week * event * noiseFactor))
    series.push({
      date: isoDate(dates[i]) + 'T00:00:00.000Z',
      units_sold: units,
      price: Math.round(bp.basePrice * priceFactor),
    })
  }
  return series
}

export function generateCompetitors(bp, dates) {
  const rnd = mulberry32(bp.seed + 7)
  const all = []
  for (const comp of bp.competitors) {
    let walk = 0
    for (let i = 0; i < dates.length; i++) {
      walk = walk * 0.85 + (rnd() - 0.5) * 0.03
      const price = Math.max(99, Math.round((bp.competitorBasePrice + comp.jitter) * (1 + walk)))
      all.push({
        competitor_id: comp.id,
        product_id: bp.id,
        title: comp.title,
        category: bp.category,
        price,
        rating: comp.rating,
        discount: comp.discount,
        observation_date: isoDate(dates[i]) + 'T00:00:00.000Z',
      })
    }
  }
  return all
}

// ---------- assembled demo dataset (memoized) ----------
let cachedDataset = null

export function getDemoDataset() {
  if (cachedDataset) return cachedDataset
  const dates = buildDates()
  const products = []
  const salesHistory = {}
  const competitorsByProduct = {}
  for (const bp of BLUEPRINTS) {
    const sales = generateProductSales(bp, dates)
    const comps = generateCompetitors(bp, dates)
    products.push({
      product_id: bp.id,
      title: bp.title,
      category: bp.category,
      subcategory: bp.subcategory,
      price: sales[sales.length - 1].price,
      discount: bp.discount,
      rating: bp.rating,
      inventory: bp.inventory,
      created_at: isoDate(dates[0]) + 'T00:00:00.000Z',
    })
    salesHistory[bp.id] = sales
    competitorsByProduct[bp.id] = comps
  }
  cachedDataset = {
    seller_id: SELLER_ID,
    seller_name: SELLER_NAME,
    generated_at: new Date().toISOString(),
    days: DAYS,
    products,
    sales_history: salesHistory,
    competitors: competitorsByProduct,
  }
  return cachedDataset
}

