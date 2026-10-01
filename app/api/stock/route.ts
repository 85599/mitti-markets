import { NextResponse } from 'next/server'
import { parseFeed, type ArticleRecord } from '../../../lib/rss'

export const dynamic = 'force-dynamic'

const WINDOW_MS = 60 * 24 * 60 * 60 * 1000
const CACHE_TTL_MS = 5 * 60_000

type StockQuote = {
  symbol: string
  exchange: 'NSE' | 'BSE'
  name: string
  price: number | null
  change: number | null
  changePercent: number | null
  asOf: string | null
}

type StockResult = {
  status: 'ready'
  quote: StockQuote | null
  records: ArticleRecord[]
  fetchedAt: string
}

const cache = new Map<string, { at: number; data: StockResult }>()

async function fetchYahooMeta(ticker: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; MittiMarkets/1.0; +https://github.com)',
      Accept: 'application/json',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`upstream ${res.status}`)
  const data = await res.json()
  const meta = data?.chart?.result?.[0]?.meta
  if (!meta || typeof meta.regularMarketPrice !== 'number') throw new Error('no quote in response')
  return meta
}

async function resolveQuote(symbol: string, exchange: string | null): Promise<StockQuote | null> {
  const direct =
    exchange === 'BSE' ? [`${symbol}.BO`] : exchange === 'NSE' ? [`${symbol}.NS`] : [`${symbol}.NS`, `${symbol}.BO`]

  for (const ticker of direct) {
    const quote = await tryChart(ticker, symbol)
    if (quote) return quote
  }

  // Yahoo renames tickers after corporate actions (e.g. TATAMOTORS.NS became
  // TMCV.NS post-demerger), so fall back to Yahoo's search endpoint and take
  // the first NSE/BSE-listed match.
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=8&newsCount=0`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MittiMarkets/1.0; +https://github.com)', Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      },
    )
    if (res.ok) {
      const data = await res.json()
      const candidates: { symbol?: string }[] = data?.quotes ?? []
      const wanted = exchange === 'BSE' ? '.BO' : exchange === 'NSE' ? '.NS' : null
      const match = candidates.find(
        (q) =>
          typeof q.symbol === 'string' &&
          (wanted ? q.symbol.endsWith(wanted) : q.symbol.endsWith('.NS') || q.symbol.endsWith('.BO')),
      )
      if (match?.symbol) {
        const quote = await tryChart(match.symbol, symbol)
        if (quote) return quote
      }
    }
  } catch {
    // fall through to not-found
  }
  return null
}

async function tryChart(ticker: string, userSymbol: string): Promise<StockQuote | null> {
  try {
    const meta = await fetchYahooMeta(ticker)
    const price: number = meta.regularMarketPrice
    const prevClose: number = typeof meta.previousClose === 'number' ? meta.previousClose : meta.chartPreviousClose
    const change = typeof prevClose === 'number' ? price - prevClose : null
    const changePercent = typeof prevClose === 'number' && prevClose !== 0 ? (change! / prevClose) * 100 : null
    return {
      symbol: userSymbol,
      exchange: ticker.endsWith('.BO') ? 'BSE' : 'NSE',
      name: meta.longName || meta.shortName || userSymbol,
      price,
      change,
      changePercent,
      asOf: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : new Date().toISOString(),
    }
  } catch {
    return null
  }
}

async function fetchStockNews(name: string | null, symbol: string): Promise<ArticleRecord[]> {
  // Google News' boolean operators return sparse results here; a plain
  // "<name|symbol> stock" query consistently yields 100+ fresh items.
  const query = `${name ?? symbol} stock`
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 MittiMarkets/1.0',
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return []
    const xml = await res.text()
    return parseFeed(xml, name ?? symbol)
  } catch {
    return []
  }
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const rawSymbol = (params.get('symbol') ?? '').trim().toUpperCase()
  const exchange = (params.get('exchange') ?? '').toUpperCase()

  if (!rawSymbol || !/^[A-Z0-9&.-]{1,15}$/.test(rawSymbol)) {
    return NextResponse.json({ status: 'error', message: 'Invalid symbol.' }, { status: 400 })
  }

  const cacheKey = `${rawSymbol}:${exchange}`
  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.data, { headers: { 'Cache-Control': 'no-store' } })
  }

  const quote = await resolveQuote(rawSymbol, exchange === 'NSE' || exchange === 'BSE' ? exchange : null)

  // News is the point of this endpoint; the live quote is a bonus that
  // Yahoo can't always provide (renamed/delisted tickers), so never 404
  // just because the quote lookup failed.
  const cutoffMs = Date.now() - WINDOW_MS
  const news = await fetchStockNews(quote?.name ?? null, rawSymbol)
  const records = news
    .filter((rec) => {
      const ts = Date.parse(rec.published_at || rec.scraped_at || '') || 0
      return ts >= cutoffMs
    })
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
    .slice(0, 60)

  if (!quote && records.length === 0) {
    return NextResponse.json(
      { status: 'not-found', message: `No NSE/BSE listing or news matched "${rawSymbol}".` },
      { status: 404 },
    )
  }

  const data: StockResult = { status: 'ready', quote, records, fetchedAt: new Date().toISOString() }
  cache.set(cacheKey, { at: Date.now(), data })

  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
}
