export type ArticleRecord = {
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

export type RssSource = {
  publisher: string
  url: string
  color: string
}

// Freshness verified 2026-09-29: every feed below returns items dated within
// the last few hours. Moneycontrol / Zee Business / CNBC RSS endpoints were
// removed because they either 403/404 or are frozen on 2024 content, which is
// exactly the "stale news" problem we're fixing.
export const RSS_SOURCES: RssSource[] = [
  {
    publisher: 'Economic Times',
    url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms',
    color: '#ef8d73',
  },
  {
    publisher: 'Economic Times',
    url: 'https://economictimes.indiatimes.com/rssfeedstopstories.cms',
    color: '#ef8d73',
  },
  {
    publisher: 'Business Standard',
    url: 'https://www.business-standard.com/rss/markets-106.rss',
    color: '#7499dc',
  },
  {
    publisher: 'The Hindu BusinessLine',
    url: 'https://www.thehindubusinessline.com/markets/feeder/default.rss',
    color: '#e1b54a',
  },
  {
    publisher: 'News18',
    url: 'https://www.news18.com/rss/business.xml',
    color: '#a48bc8',
  },
  {
    publisher: 'Mint',
    url: 'https://www.livemint.com/rss/markets',
    color: '#43b9a7',
  },
]

function decodeEntities(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&')
}

function stripHtml(input: string): string {
  return decodeEntities(input)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Grab the inner text of the first occurrence of <tag>...</tag>, honoring
// CDATA and attributes (e.g. atom-style). Returns '' when absent.
function pickTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i')
  const match = block.match(re)
  if (!match) return ''
  return match[1].trim()
}

// Some feeds (News18, BusinessLine, Mint) wrap link in CDATA or use
// <link href="..."/>. Handle both shapes.
function pickLink(block: string): string {
  const href = block.match(/<link[^>]*href=["']([^"']+)["']/i)
  if (href) return href[1].trim()
  const inner = pickTag(block, 'link')
  return decodeEntities(inner).trim()
}

function parseDate(raw: string): string {
  const cleaned = decodeEntities(raw).trim()
  if (!cleaned) return ''
  const ts = Date.parse(cleaned)
  if (Number.isNaN(ts)) return ''
  return new Date(ts).toISOString()
}

export function parseFeed(xml: string, publisher: string): ArticleRecord[] {
  const now = new Date().toISOString()
  const items = xml.split(/<item[\s>]/i).slice(1)
  const records: ArticleRecord[] = []

  for (const rawItem of items) {
    const block = rawItem.split(/<\/item>/i)[0]
    const title = stripHtml(pickTag(block, 'title'))
    const url = pickLink(block)
    if (!title || !url) continue

    const description = stripHtml(pickTag(block, 'description'))
    const pubRaw = pickTag(block, 'pubDate') || pickTag(block, 'published') || pickTag(block, 'updated')
    const published_at = parseDate(pubRaw)
    const author = stripHtml(pickTag(block, 'author') || pickTag(block, 'creator'))
    // Aggregator feeds (Google News) carry the real outlet in <source>.
    const sourceTag = stripHtml(pickTag(block, 'source'))

    records.push({
      publisher: sourceTag || publisher,
      title,
      author,
      description: description.slice(0, 400),
      url,
      article_text: description,
      published_at: published_at || now,
      modified_at: published_at || now,
      scraped_at: now,
    })
  }

  return records
}

async function fetchSource(source: RssSource): Promise<ArticleRecord[]> {
  try {
    const res = await fetch(source.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 MittiMarkets/1.0',
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) {
      console.log(`[rss] ${source.publisher} HTTP ${res.status}`)
      return []
    }
    const xml = await res.text()
    const parsed = parseFeed(xml, source.publisher)
    if (parsed.length === 0) console.log(`[rss] ${source.publisher} parsed 0 items (len ${xml.length})`)
    return parsed
  } catch (err) {
    console.log(`[rss] ${source.publisher} fetch failed:`, err instanceof Error ? err.message : String(err))
    return []
  }
}

export type RssResult = {
  records: ArticleRecord[]
  fetchedAt: string
  perSource: { name: string; count: number }[]
}

// In-memory cache so the frontend's 45s polling doesn't hammer upstream feeds
// on every request. Feeds update on the order of minutes, so a 5-minute TTL
// keeps news effectively live while staying polite to publishers.
const CACHE_TTL_MS = 5 * 60_000
let cache: { result: RssResult; at: number } | null = null
let lastGood: RssResult | null = null
let inflight: Promise<RssResult> | null = null

export async function getRssRecords(force = false): Promise<RssResult> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.result
  }
  if (inflight) return inflight

  inflight = (async () => {
    const fetched = await Promise.all(RSS_SOURCES.map(fetchSource))
    const byUrl = new Map<string, ArticleRecord>()
    for (const batch of fetched) {
      for (const rec of batch) {
        // keep the record with the newest timestamp on URL collision
        const prev = byUrl.get(rec.url)
        if (!prev || Date.parse(rec.published_at) > Date.parse(prev.published_at)) {
          byUrl.set(rec.url, rec)
        }
      }
    }

    const counts = new Map<string, number>()
    for (const rec of byUrl.values()) {
      counts.set(rec.publisher, (counts.get(rec.publisher) ?? 0) + 1)
    }

    const result: RssResult = {
      records: Array.from(byUrl.values()),
      fetchedAt: new Date().toISOString(),
      perSource: Array.from(counts.entries()).map(([name, count]) => ({ name, count })),
    }
    // Only cache a successful (non-empty) fetch. A cold-start or transient
    // network blip that returns zero items must not be cached for the full
    // TTL, or the UI would stay blank even after upstream recovers.
    if (result.records.length > 0) {
      cache = { result, at: Date.now() }
      lastGood = result
      return result
    }
    // Upstream was unreachable this round — serve the last known-good batch
    // so a forced refresh can never blank the terminal.
    return lastGood ?? result
  })().finally(() => {
    inflight = null
  })

  return inflight
}

export function publisherColor(publisher: string): string {
  return RSS_SOURCES.find((s) => s.publisher === publisher)?.color ?? '#9aa9a1'
}
