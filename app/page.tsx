'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  ArrowUpRight,
  Bookmark,
  CircleDot,
  Command,
  Cpu,
  Radio,
  RefreshCw,
  Search,
  Terminal,
  TrendingDown,
  TrendingUp,
  Wifi,
} from 'lucide-react'

type ArticleRecord = {
  publisher: string
  title: string
  author: string
  description: string
  url: string
  article_text: string
  published_at: string
  modified_at: string
  scraped_at: string
}

type SourceCount = { name: string; count: number; color?: string }

type CrawlState = {
  running: boolean
  startedAt: string | null
  finishedAt: string | null
  lastStatus: 'idle' | 'running' | 'complete' | 'error'
  lastMessage: string
}

type ScraperResponse = {
  status: 'ready' | 'no-output' | 'error'
  records: ArticleRecord[]
  total: number
  sources: SourceCount[]
  sourceCount: number
  lastCrawlAt: string | null
  windowDays?: number
  rssFetchedAt?: string | null
  csvLastCrawlAt?: string | null
  crawl: CrawlState
}

type Quote = {
  id: string
  label: string
  price: number | null
  change: number | null
  changePercent: number | null
  asOf: string | null
  stale: boolean
}

type RatesResponse = {
  status: 'ready' | 'error'
  quotes: Quote[]
  fetchedAt: string
}

type StockQuote = {
  symbol: string
  exchange: 'NSE' | 'BSE'
  name: string
  price: number | null
  change: number | null
  changePercent: number | null
  asOf: string | null
}

type StockResponse = {
  status: 'ready'
  quote: StockQuote | null
  records: ArticleRecord[]
  fetchedAt: string
}

const TABS = ['ALL', 'MARKETS', 'POLICY', 'ECONOMY', 'CORPORATE', 'GLOBAL', 'SAVED'] as const
type Tab = (typeof TABS)[number]

const RANGES = [
  { id: '24H', ms: 24 * 3600_000 },
  { id: '7D', ms: 7 * 24 * 3600_000 },
  { id: '30D', ms: 30 * 24 * 3600_000 },
  { id: '60D', ms: 60 * 24 * 3600_000 },
] as const
type RangeId = (typeof RANGES)[number]['id']

const FALLBACK_COLORS: Record<string, string> = {
  'Economic Times': '#ef8d73',
  Moneycontrol: '#43b9a7',
  'The Hindu BusinessLine': '#e1b54a',
  'The Hindu': '#e1b54a',
  'Business Standard': '#7499dc',
  News18: '#a48bc8',
  Mint: '#43b9a7',
  'Zee Business': '#d64545',
  'CNBC Awaaz': '#4a90d9',
}
const DEFAULT_COLOR = '#6f8a7d'

const CATEGORY_KEYWORDS: Record<'MARKETS' | 'POLICY' | 'ECONOMY' | 'CORPORATE' | 'GLOBAL', string[]> = {
  MARKETS: ['sensex', 'nifty', 'stock', 'share', 'market', 'ipo', 'equity', 'bse', 'nse', 'shares', 'rally'],
  POLICY: ['rbi', 'sebi', 'government', 'policy', 'budget', 'tax', 'regulat', 'parliament', 'ministry', 'bill'],
  ECONOMY: ['gdp', 'economy', 'inflation', 'growth', 'export', 'import', 'trade', 'capex', 'rupee', 'forex'],
  CORPORATE: ['results', 'earnings', 'profit', 'merger', 'acquisition', 'ceo', 'company', 'q1', 'q2', 'q3', 'q4', 'revenue'],
  GLOBAL: ['us ', 'china', 'global', 'asia', 'europe', 'fed ', 'dollar', 'crude', 'oil', 'wall street', 'overseas'],
}

function categoryFor(story: ArticleRecord): string {
  const text = `${story.title} ${story.description}`.toLowerCase()
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => text.includes(kw))) return category
  }
  return 'MARKETS'
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return '—'
  const diffMs = Date.now() - then
  if (diffMs < 0) return 'NOW'
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'NOW'
  if (minutes < 60) return `${minutes}M`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}H`
  const days = Math.floor(hours / 24)
  return `${days}D`
}

function clockStamp(iso: string | null | undefined): string {
  if (!iso) return '--:--'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '--:--'
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
}

function formatPrice(value: number | null): string {
  if (value === null) return '—'
  return value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const NEWS_POLL_MS = 45_000
const RATES_POLL_MS = 20_000

export default function Page() {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<Tab>('ALL')
  const [range, setRange] = useState<RangeId>('60D')
  const [saved, setSaved] = useState<string[]>([])
  // Starts null so server and client render identically; the ticking clock
  // mounts client-side only (a server-rendered timestamp hydrates mismatched).
  const [now, setNow] = useState<Date | null>(null)

  const [newsData, setNewsData] = useState<ScraperResponse | null>(null)
  const [newsLoading, setNewsLoading] = useState(true)
  const [newsError, setNewsError] = useState(false)
  const [triggering, setTriggering] = useState(false)

  const [rates, setRates] = useState<RatesResponse | null>(null)
  const fastPollUntil = useRef(0)

  const [stockInput, setStockInput] = useState('')
  const [stockSymbol, setStockSymbol] = useState<string | null>(null)
  const [stockData, setStockData] = useState<StockResponse | null>(null)
  const [stockLoading, setStockLoading] = useState(false)
  const [stockError, setStockError] = useState<string | null>(null)

  useEffect(() => {
    setNow(new Date())
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const loadNews = useCallback(async (refresh = false) => {
    try {
      const res = await fetch(`/api/scraper${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      const data: ScraperResponse = await res.json()
      // Never blank a populated terminal on a transient empty response.
      setNewsData((prev) => (data.records.length === 0 && prev && prev.records.length > 0 ? prev : data))
      setNewsError(false)
    } catch {
      setNewsError(true)
    } finally {
      setNewsLoading(false)
    }
  }, [])

  const loadRates = useCallback(async () => {
    try {
      const res = await fetch('/api/rates', { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      const data: RatesResponse = await res.json()
      setRates(data)
    } catch {
      // keep last known values
    }
  }, [])

  useEffect(() => {
    loadNews()
    loadRates()
    const newsTimer = setInterval(() => loadNews(), NEWS_POLL_MS)
    const ratesTimer = setInterval(loadRates, RATES_POLL_MS)
    return () => {
      clearInterval(newsTimer)
      clearInterval(ratesTimer)
    }
  }, [loadNews, loadRates])

  const runRefresh = async () => {
    setTriggering(true)
    fastPollUntil.current = Date.now() + 3 * 60_000
    try {
      await fetch('/api/scraper', { method: 'POST' })
    } catch {
      // surfaced via crawl status on next poll
    }
    await loadNews(true)
    setTriggering(false)
  }

  const loadStock = async (raw: string) => {
    const symbol = raw.trim().toUpperCase()
    if (!symbol) return
    setStockLoading(true)
    setStockError(null)
    try {
      const res = await fetch(`/api/stock?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' })
      if (res.status === 404) {
        setStockError(`No NSE/BSE listing matched "${symbol}"`)
        return
      }
      if (!res.ok) throw new Error(String(res.status))
      const data: StockResponse = await res.json()
      setStockData(data)
      setStockSymbol(symbol)
    } catch {
      setStockError('Stock lookup failed — retry')
    } finally {
      setStockLoading(false)
    }
  }

  const exitStockMode = () => {
    setStockSymbol(null)
    setStockData(null)
    setStockError(null)
  }

  const stories = newsData?.records ?? []
  const isCrawling = newsData?.crawl?.running ?? false
  const quotes = rates?.quotes ?? []
  const quoteById = (id: string) => quotes.find((q) => q.id === id) ?? null
  const inStockMode = stockSymbol !== null
  const feedStories = inStockMode ? (stockData?.records ?? []) : stories

  const colorFor = useCallback(
    (publisher: string) =>
      newsData?.sources?.find((s) => s.name === publisher)?.color ??
      FALLBACK_COLORS[publisher] ??
      DEFAULT_COLOR,
    [newsData],
  )

  const rangeMs = RANGES.find((r) => r.id === range)?.ms ?? RANGES[RANGES.length - 1].ms

  const filtered = useMemo(() => {
    const cutoff = Date.now() - rangeMs
    const q = query.trim().toLowerCase()
    return feedStories.filter((story) => {
      const ts = Date.parse(story.published_at || story.scraped_at || '') || 0
      const inRange = ts >= cutoff
      const inTab = inStockMode
        ? true
        : active === 'SAVED'
          ? saved.includes(story.url)
          : active === 'ALL' || categoryFor(story) === active
      const haystack = `${story.title} ${story.description} ${story.publisher}`.toLowerCase()
      return inRange && inTab && (!q || haystack.includes(q))
    })
  }, [active, query, saved, feedStories, rangeMs, inStockMode])

  const newestStamp = filtered.length ? clockStamp(filtered[0].published_at) : null

  return (
    <div className="min-h-screen bg-[#070b09] font-mono text-[#cfe3d8] selection:bg-[#2ee08a]/30">
      {/* ===== command bar ===== */}
      <header className="sticky top-0 z-30 border-b border-[#1c2b24] bg-[#080d0b]/95 backdrop-blur">
        <div className="flex h-14 items-center justify-between gap-3 px-3 sm:px-5">
          <div className="flex items-center gap-3">
            <div className="grid size-8 place-items-center rounded border border-[#2ee08a]/40 bg-[#2ee08a]/10 text-[#2ee08a]">
              <Terminal className="size-4" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-bold tracking-[.18em] text-[#e6f4ec]">
                MITTI<span className="text-[#2ee08a]">::</span>TERMINAL
              </div>
              <div className="text-[10px] tracking-[.22em] text-[#5f7a6d]">INDIA MARKET DESK</div>
            </div>
          </div>

          <div className="hidden items-center gap-4 text-[11px] text-[#6f8a7d] md:flex">
            <span className="flex items-center gap-1.5">
              <Wifi className={`size-3.5 ${newsError ? 'text-[#ff5c5c]' : 'text-[#2ee08a]'}`} />
              {newsError ? 'FEED ERROR' : 'LIVE'}
            </span>
            <span className="text-[#3a4f45]">|</span>
            <span>
              IST{' '}
              <strong className="text-[#e6f4ec]">
                {now
                  ? now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Kolkata' })
                  : '--:--:--'}
              </strong>
            </span>
            <span className="text-[#3a4f45]">|</span>
            <span>
              {now
                ? now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).toUpperCase()
                : '-- --- ----'}
            </span>
          </div>

          <button
            onClick={runRefresh}
            disabled={triggering || isCrawling}
            className="flex items-center gap-2 rounded border border-[#2ee08a]/40 bg-[#2ee08a]/10 px-3 py-1.5 text-[11px] font-bold tracking-wider text-[#2ee08a] transition hover:bg-[#2ee08a]/20 disabled:opacity-60"
          >
            {triggering || isCrawling ? <RefreshCw className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            {isCrawling ? 'SYNCING' : 'REFRESH'}
          </button>
        </div>

        {/* ===== ticker tape ===== */}
        <div className="relative overflow-hidden border-t border-[#16231d] bg-[#0a100d]">
          <div className="ticker-track gap-0 py-1.5">
            {[0, 1].map((dup) => (
              <div key={dup} className="flex shrink-0">
                {quotes.map((q) => {
                  const up = (q.changePercent ?? 0) >= 0
                  const stale = q.stale || q.price === null
                  return (
                    <div key={`${dup}-${q.id}`} className="flex items-center gap-2 border-r border-[#16231d] px-4 text-[11px] whitespace-nowrap">
                      <span className="tracking-wider text-[#7f9a8c]">{q.label}</span>
                      <span className={`font-bold ${stale ? 'text-[#5f7a6d]' : 'text-[#e6f4ec]'}`}>{formatPrice(q.price)}</span>
                      <span className={`flex items-center gap-0.5 ${stale ? 'text-[#5f7a6d]' : up ? 'text-[#2ee08a]' : 'text-[#ff5c5c]'}`}>
                        {stale ? '—' : up ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                        {stale ? 'N/A' : `${up ? '+' : ''}${q.changePercent?.toFixed(2)}%`}
                      </span>
                    </div>
                  )
                })}
                <div className="flex items-center gap-2 px-4 text-[11px] whitespace-nowrap text-[#7f9a8c]">
                  <CircleDot className="size-3 text-[#2ee08a]" /> {newsData?.total ?? 0} STORIES IN {newsData?.windowDays ?? 60}D WINDOW
                  <span className="text-[#3a4f45]">·</span> {newsData?.sourceCount ?? 0} SOURCES
                </div>
              </div>
            ))}
          </div>
        </div>
      </header>

      {/* ===== body ===== */}
      <main className="mx-auto grid max-w-[1600px] gap-4 p-3 sm:p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ---- left: news console ---- */}
        <section className="flex min-w-0 flex-col gap-3">
          {/* control strip */}
          <div className="rounded border border-[#1c2b24] bg-[#0b120e] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[180px] flex-1">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[#5f7a6d]" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="grep headlines..."
                  className="h-8 w-full rounded border border-[#1c2b24] bg-[#070b09] pl-8 pr-3 text-[12px] text-[#d6e6dd] placeholder-[#4a6157] outline-none focus:border-[#2ee08a]/50"
                />
              </div>
              <div className="flex min-w-[220px] items-center gap-1.5">
                <div className="relative flex-1">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold tracking-wider text-[#f0b429]">
                    NSE/BSE
                  </span>
                  <input
                    value={stockInput}
                    onChange={(e) => setStockInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && loadStock(stockInput)}
                    placeholder="RELIANCE, TATAMOTORS..."
                    className="h-8 w-full rounded border border-[#1c2b24] bg-[#070b09] pl-[62px] pr-3 text-[12px] uppercase text-[#d6e6dd] placeholder-[#4a6157] outline-none focus:border-[#f0b429]/50"
                  />
                </div>
                <button
                  onClick={() => loadStock(stockInput)}
                  disabled={stockLoading}
                  className="h-8 shrink-0 rounded border border-[#f0b429]/40 bg-[#f0b429]/10 px-3 text-[10px] font-bold tracking-wider text-[#f0b429] transition hover:bg-[#f0b429]/20 disabled:opacity-60"
                >
                  {stockLoading ? '...' : 'LOAD'}
                </button>
              </div>
              <div className="flex items-center gap-1 rounded border border-[#1c2b24] bg-[#070b09] p-1">
                {RANGES.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setRange(r.id)}
                    className={`rounded px-2 py-1 text-[10px] font-bold tracking-wider transition ${
                      range === r.id ? 'bg-[#2ee08a]/15 text-[#2ee08a]' : 'text-[#6f8a7d] hover:text-[#cfe3d8]'
                    }`}
                  >
                    {r.id}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1 term-scroll">
              {TABS.map((tab) => {
                const count =
                  tab === 'ALL'
                    ? newsData?.total ?? 0
                    : tab === 'SAVED'
                      ? saved.length
                      : stories.filter((s) => categoryFor(s) === tab).length
                const isActive = active === tab
                return (
                  <button
                    key={tab}
                    onClick={() => setActive(tab)}
                    className={`flex shrink-0 items-center gap-1.5 rounded border px-2.5 py-1 text-[10px] font-bold tracking-wider transition ${
                      isActive
                        ? 'border-[#2ee08a]/50 bg-[#2ee08a]/10 text-[#2ee08a]'
                        : 'border-[#1c2b24] bg-[#070b09] text-[#6f8a7d] hover:border-[#2b4038] hover:text-[#cfe3d8]'
                    }`}
                  >
                    {isActive && <CircleDot className="size-2.5 fill-current" />}
                    {tab}
                    <span className={isActive ? 'text-[#2ee08a]/70' : 'text-[#41584c]'}>{count}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* stock mode banner */}
          {(inStockMode || stockError) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded border border-[#f0b429]/40 bg-[#f0b429]/5 px-3 py-2">
              {inStockMode && stockData ? (
                <>
                  <span className="text-[13px] font-bold tracking-wider text-[#f0b429]">
                    {stockData.quote?.symbol ?? stockSymbol}
                  </span>
                  {stockData.quote && (
                    <span className="rounded-sm border border-[#2b4038] bg-[#0d1712] px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-[#7f9a8c]">
                      {stockData.quote.exchange}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-[11px] text-[#9fb8aa]">
                    {stockData.quote?.name ?? 'Live quote unavailable — showing news'}
                  </span>
                  {stockData.quote && (
                    <>
                      <span className="text-[13px] font-bold text-[#e6f4ec]">{formatPrice(stockData.quote.price)}</span>
                      <span
                        className={`flex items-center gap-1 text-[12px] font-bold ${
                          (stockData.quote.changePercent ?? 0) >= 0 ? 'text-[#2ee08a]' : 'text-[#ff5c5c]'
                        }`}
                      >
                        {(stockData.quote.changePercent ?? 0) >= 0 ? (
                          <TrendingUp className="size-3.5" />
                        ) : (
                          <TrendingDown className="size-3.5" />
                        )}
                        {(stockData.quote.changePercent ?? 0) >= 0 ? '+' : ''}
                        {stockData.quote.changePercent?.toFixed(2)}%
                      </span>
                    </>
                  )}
                  <span className="text-[10px] text-[#5f7a6d]">{stockData.records.length} NEWS</span>
                </>
              ) : (
                <span className="text-[11px] text-[#ff5c5c]">{stockError}</span>
              )}
              <button
                onClick={exitStockMode}
                className="ml-auto rounded border border-[#2b4038] px-2 py-1 text-[10px] font-bold tracking-wider text-[#9fb8aa] transition hover:border-[#ff5c5c]/50 hover:text-[#ff5c5c]"
              >
                EXIT ✕
              </button>
            </div>
          )}

          {/* feed header */}
          <div className="flex items-center justify-between px-1 text-[10px] tracking-wider text-[#5f7a6d]">
            <span className="flex items-center gap-1.5">
              <Radio className={`size-3 ${newsError ? 'text-[#ff5c5c]' : 'text-[#2ee08a] blink-dot'}`} />
              {inStockMode ? `SYMBOL FEED · ${stockSymbol}` : 'NEWS FEED'} · {filtered.length} ROWS · RANGE {range}
            </span>
            {newestStamp && <span>NEWEST {newestStamp} IST</span>}
          </div>

          {/* rows */}
          <div className="term-scroll flex max-h-[calc(100vh-260px)] min-h-[300px] flex-col gap-1 overflow-y-auto pr-1">
            {newsLoading && !inStockMode && <TerminalRow skeleton>Loading feed...</TerminalRow>}

            {stockLoading && <TerminalRow skeleton>Pulling {stockInput.toUpperCase() || 'SYMBOL'} quote + news…</TerminalRow>}

            {!newsLoading && newsError && (
              <TerminalRow skeleton tone="error">
                FEED UNREACHABLE — retrying automatically
              </TerminalRow>
            )}

            {!newsLoading && !newsError && !inStockMode && feedStories.length === 0 && (
              <TerminalRow skeleton>No data. Hit REFRESH to pull live feeds.</TerminalRow>
            )}

            {inStockMode && !stockLoading && feedStories.length === 0 && (
              <TerminalRow skeleton>No news for {stockSymbol} in this range.</TerminalRow>
            )}

            {!newsLoading && !newsError && feedStories.length > 0 && filtered.length === 0 && (
              <TerminalRow skeleton>No rows match this filter.</TerminalRow>
            )}

            {filtered.map((story) => {
              const color = colorFor(story.publisher)
              const isSaved = saved.includes(story.url)
              return (
                <article
                  key={story.url}
                  className="group grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3 rounded border border-[#16231d] bg-[#0a100d] px-3 py-2.5 transition hover:border-[#2b4038] hover:bg-[#0d1712]"
                >
                  {/* time + source rail */}
                  <div className="flex w-[68px] shrink-0 flex-col gap-1 pt-0.5">
                    <span className="text-[11px] font-bold text-[#e6f4ec]">{clockStamp(story.published_at)}</span>
                    <span className="text-[10px] text-[#5f7a6d]">{timeAgo(story.published_at || story.scraped_at)} AGO</span>
                    <span className="mt-1 flex items-center gap-1 text-[9px] font-bold tracking-wide" style={{ color }}>
                      <span className="size-1.5 rounded-full" style={{ background: color }} />
                      {story.publisher.replace('The Hindu BusinessLine', 'BL').replace('Business Standard', 'BS').toUpperCase()}
                    </span>
                  </div>

                  {/* headline */}
                  <div className="min-w-0">
                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                      <span className="rounded-sm border border-[#2b4038] bg-[#0d1712] px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-[#7f9a8c]">
                        {categoryFor(story)}
                      </span>
                    </div>
                    <a
                      href={story.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-[13px] font-semibold leading-snug text-[#dcefe5] transition group-hover:text-[#2ee08a]"
                    >
                      {story.title}
                    </a>
                    {story.description && (
                      <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-[#6f8a7d]">{story.description}</p>
                    )}
                  </div>

                  {/* actions */}
                  <div className="flex shrink-0 flex-col items-end justify-between gap-2">
                    <button
                      onClick={() =>
                        setSaved((prev) => (prev.includes(story.url) ? prev.filter((x) => x !== story.url) : [...prev, story.url]))
                      }
                      aria-label="Save story"
                      className={`rounded p-1 transition ${isSaved ? 'text-[#f0b429]' : 'text-[#41584c] hover:text-[#cfe3d8]'}`}
                    >
                      <Bookmark className={`size-3.5 ${isSaved ? 'fill-current' : ''}`} />
                    </button>
                    <a
                      href={story.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-0.5 text-[10px] text-[#41584c] opacity-0 transition group-hover:opacity-100 hover:text-[#2ee08a]"
                    >
                      OPEN <ArrowUpRight className="size-3" />
                    </a>
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        {/* ---- right rail ---- */}
        <aside className="flex flex-col gap-3">
          <Panel title="MARKET DATA" icon={<Cpu className="size-3.5" />}>
            <div className="flex flex-col gap-2">
              {(['nifty50', 'sensex', 'usdinr'] as const).map((id) => (
                <MarketLine key={id} quote={quoteById(id)} />
              ))}
              {quotes.length === 0 && <div className="py-3 text-center text-[11px] text-[#5f7a6d]">Connecting to exchange…</div>}
            </div>
          </Panel>

          <Panel title="SOURCE MONITOR" icon={<Activity className="size-3.5" />}>
            <div className="flex flex-col gap-1.5">
              {(newsData?.sources?.length ? newsData.sources : []).map((s) => (
                <div key={s.name} className="flex items-center gap-2 text-[11px]">
                  <span className="size-1.5 rounded-full" style={{ background: s.color ?? FALLBACK_COLORS[s.name] ?? DEFAULT_COLOR }} />
                  <span className="flex-1 truncate text-[#9fb8aa]">{s.name}</span>
                  <span className="font-bold text-[#e6f4ec]">{s.count}</span>
                </div>
              ))}
              {!newsData?.sources?.length && <div className="py-2 text-center text-[11px] text-[#5f7a6d]">No sources online</div>}
            </div>
          </Panel>

          <Panel title="SYSTEM LOG" icon={<Command className="size-3.5" />}>
            <div className="flex flex-col gap-1.5 text-[11px]">
              <LogLine label="STATUS" value={isCrawling ? 'SYNCING…' : newsData?.total ? 'OPERATIONAL' : 'STANDBY'} tone={isCrawling ? 'amber' : newsData?.total ? 'green' : 'muted'} />
              <LogLine label="WINDOW" value={`${newsData?.windowDays ?? 60} DAYS`} tone="muted" />
              <LogLine label="RSS SYNC" value={newsData?.rssFetchedAt ? `${timeAgo(newsData.rssFetchedAt)} AGO` : '—'} tone="green" />
              <LogLine label="ARCHIVE" value={newsData?.csvLastCrawlAt ? clockStamp(newsData.csvLastCrawlAt) : 'NONE'} tone="muted" />
              <div className="mt-1 break-words rounded border border-[#16231d] bg-[#070b09] p-2 text-[10px] leading-relaxed text-[#6f8a7d]">
                <span className="text-[#2ee08a]">&gt;</span> {newsData?.crawl?.lastMessage ?? 'Terminal ready.'}
              </div>
            </div>
          </Panel>

          <div className="rounded border border-[#16231d] bg-[#0a100d] p-3 text-[10px] leading-relaxed text-[#5f7a6d]">
            <span className="text-[#2ee08a]">TIP</span> · Live RSS keeps headlines fresh to the minute. Deep 60-day archive
            refreshes when you run REFRESH (requires the local Scrapy pipeline).
          </div>
        </aside>
      </main>
    </div>
  )
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded border border-[#1c2b24] bg-[#0b120e]">
      <div className="flex items-center gap-2 border-b border-[#16231d] px-3 py-2 text-[10px] font-bold tracking-[.18em] text-[#7f9a8c]">
        <span className="text-[#2ee08a]">{icon}</span>
        {title}
      </div>
      <div className="p-3">{children}</div>
    </div>
  )
}

function MarketLine({ quote }: { quote: Quote | null }) {
  const up = (quote?.changePercent ?? 0) >= 0
  const stale = !quote || quote.stale || quote.price === null
  return (
    <div className="flex items-center justify-between rounded border border-[#16231d] bg-[#070b09] px-2.5 py-2">
      <div className="flex flex-col">
        <span className="text-[10px] tracking-wider text-[#7f9a8c]">{quote?.label ?? '—'}</span>
        <span className={`text-[15px] font-bold ${stale ? 'text-[#5f7a6d]' : 'text-[#e6f4ec]'}`}>{formatPrice(quote?.price ?? null)}</span>
      </div>
      <div className={`flex items-center gap-1 text-[12px] font-bold ${stale ? 'text-[#5f7a6d]' : up ? 'text-[#2ee08a]' : 'text-[#ff5c5c]'}`}>
        {stale ? 'N/A' : up ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
        {stale ? '' : `${up ? '+' : ''}${quote?.changePercent?.toFixed(2)}%`}
      </div>
    </div>
  )
}

function LogLine({ label, value, tone }: { label: string; value: string; tone: 'green' | 'amber' | 'muted' }) {
  const color = tone === 'green' ? 'text-[#2ee08a]' : tone === 'amber' ? 'text-[#f0b429]' : 'text-[#9fb8aa]'
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[#5f7a6d]">{label}</span>
      <span className={`truncate font-bold ${color}`}>{value}</span>
    </div>
  )
}

function TerminalRow({ children, skeleton, tone = 'muted' }: { children: React.ReactNode; skeleton?: boolean; tone?: 'muted' | 'error' }) {
  return (
    <div
      className={`rounded border border-dashed px-3 py-8 text-center text-[11px] ${
        tone === 'error' ? 'border-[#ff5c5c]/40 text-[#ff5c5c]' : 'border-[#1c2b24] text-[#5f7a6d]'
      }`}
    >
      {children}
    </div>
  )
}
