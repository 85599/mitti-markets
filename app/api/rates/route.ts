import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

type Instrument = {
  id: string
  label: string
  symbol: string
}

// Yahoo Finance's public chart endpoint doesn't need an API key and carries
// the fields we need (regularMarketPrice + previousClose) for indices and FX.
const INSTRUMENTS: Instrument[] = [
  { id: 'nifty50', label: 'NIFTY 50', symbol: '%5ENSEI' },
  { id: 'sensex', label: 'SENSEX', symbol: '%5EBSESN' },
  { id: 'usdinr', label: 'USD / INR', symbol: 'INR%3DX' },
]

type Quote = {
  id: string
  label: string
  price: number | null
  change: number | null
  changePercent: number | null
  asOf: string | null
  stale: boolean
  error?: string
}

async function fetchQuote(instrument: Instrument): Promise<Quote> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${instrument.symbol}?interval=1d&range=1d`
  try {
    const res = await fetch(url, {
      headers: {
        // Yahoo's chart endpoint occasionally 429s requests with no UA.
        'User-Agent': 'Mozilla/5.0 (compatible; MittiMarkets/1.0; +https://github.com)',
        Accept: 'application/json',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) throw new Error(`upstream ${res.status}`)
    const data = await res.json()
    const meta = data?.chart?.result?.[0]?.meta
    if (!meta || typeof meta.regularMarketPrice !== 'number') throw new Error('no quote in response')

    const price: number = meta.regularMarketPrice
    const prevClose: number = typeof meta.previousClose === 'number' ? meta.previousClose : meta.chartPreviousClose
    const change = typeof prevClose === 'number' ? price - prevClose : null
    const changePercent = typeof prevClose === 'number' && prevClose !== 0 ? (change! / prevClose) * 100 : null

    return {
      id: instrument.id,
      label: instrument.label,
      price,
      change,
      changePercent,
      asOf: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : new Date().toISOString(),
      stale: false,
    }
  } catch (error) {
    return {
      id: instrument.id,
      label: instrument.label,
      price: null,
      change: null,
      changePercent: null,
      asOf: null,
      stale: true,
      error: error instanceof Error ? error.message : 'fetch failed',
    }
  }
}

export async function GET() {
  const quotes = await Promise.all(INSTRUMENTS.map(fetchQuote))
  const anyLive = quotes.some((q) => !q.stale)

  return NextResponse.json(
    { status: anyLive ? 'ready' : 'error', quotes, fetchedAt: new Date().toISOString() },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
