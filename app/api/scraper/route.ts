import { NextResponse } from 'next/server'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { getRssRecords, publisherColor, type ArticleRecord } from '../../../lib/rss'

export const dynamic = 'force-dynamic'

const SCRAPER_DIR = path.join(process.cwd(), 'scraper')
const OUTPUT_DIR = path.join(SCRAPER_DIR, 'data')
const RAW_DIR = path.join(OUTPUT_DIR, 'raw')

// Rolling window: only stories published within the last 60 days are ever
// returned. Older CSV rows (the scraper's backfill produced months of stale
// items) get dropped here so the UI can't show ancient news again.
const WINDOW_DAYS = 60
const WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000

type CrawlState = {
  running: boolean
  startedAt: string | null
  finishedAt: string | null
  lastStatus: 'idle' | 'running' | 'complete' | 'error'
  lastMessage: string
}

// Kept in module scope so it survives across requests on a long-running Node
// process (this route spawns a real child process, so it isn't meant for
// stateless/edge deployments).
const crawlState: CrawlState = {
  running: false,
  startedAt: null,
  finishedAt: null,
  lastStatus: 'idle',
  lastMessage: 'No crawl has run yet.',
}

let csvCache: { key: string; records: ArticleRecord[]; at: number } | null = null

/**
 * Minimal RFC4180-compliant CSV parser. Handles quoted fields that contain
 * commas, escaped quotes (""), and embedded newlines — all of which show up
 * routinely in scraped article text and previously corrupted row parsing
 * (the old implementation split on newlines before honoring quotes, which
 * silently truncated or mangled any article whose text wrapped a line).
 */
function parseCsv(content: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const len = content.length

  for (let i = 0; i < len; i++) {
    const char = content[i]

    if (inQuotes) {
      if (char === '"') {
        if (content[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (char === '\r') {
      // swallow; \r\n and bare \r line endings both normalize via \n
    } else {
      field += char
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter((r) => !(r.length === 1 && r[0] === ''))
}

function recordTimestamp(rec: ArticleRecord): number {
  return Date.parse(rec.published_at || rec.scraped_at || '') || 0
}

function readPublisherCsv(filePath: string, cutoffMs: number): ArticleRecord[] {
  let content: string
  try {
    content = readFileSync(filePath, 'utf8')
  } catch {
    return []
  }
  if (!content.trim()) return []

  const rows = parseCsv(content)
  if (rows.length < 2) return []

  const headers = rows[0].map((h) => h.trim())
  const records: ArticleRecord[] = []

  for (const values of rows.slice(1)) {
    const rec: Record<string, string> = {}
    headers.forEach((header, index) => {
      rec[header] = (values[index] ?? '').trim()
    })
    if (!rec.url || !rec.title) continue

    const candidate: ArticleRecord = {
      publisher: rec.publisher ?? '',
      title: rec.title ?? '',
      author: rec.author ?? '',
      description: rec.description ?? '',
      url: rec.url ?? '',
      // Full article bodies from the backfill CSVs run to hundreds of MB in
      // aggregate; the UI only ever renders title + description.
      article_text: (rec.article_text ?? '').slice(0, 300),
      published_at: rec.published_at ?? '',
      modified_at: rec.modified_at ?? '',
      scraped_at: rec.scraped_at ?? '',
    }
    // Skip anything outside the 60-day window (or with no parseable date).
    const ts = recordTimestamp(candidate)
    if (!ts || ts < cutoffMs) continue
    records.push(candidate)
  }
  return records
}

function loadCsvRecords(cutoffMs: number) {
  if (!existsSync(RAW_DIR)) return { records: [] as ArticleRecord[], files: [] as string[], lastCrawlAt: null as string | null }
  const files = readdirSync(RAW_DIR).filter((name) => name.endsWith('.csv'))

  let lastCrawlAt: string | null = null
  let cacheKey = ''
  const mtimes: number[] = []
  for (const file of files) {
    const m = statSync(path.join(RAW_DIR, file)).mtimeMs
    mtimes.push(m)
    cacheKey += `${file}:${m};`
  }
  if (files.length) lastCrawlAt = new Date(Math.max(...mtimes)).toISOString()

  // The raw CSVs total ~190MB; re-parsing them on every poll made each GET
  // take 12s+ and starved the RSS fetches. Re-parse only when a file's mtime
  // changes (i.e. after a crawl) or once an hour so the sliding 60-day
  // cutoff stays honest.
  if (csvCache && csvCache.key === cacheKey && Date.now() - csvCache.at < 3600_000) {
    return { records: csvCache.records, files, lastCrawlAt }
  }

  const byUrl = new Map<string, ArticleRecord>()
  for (const file of files) {
    for (const rec of readPublisherCsv(path.join(RAW_DIR, file), cutoffMs)) {
      byUrl.set(rec.url, rec)
    }
  }
  const records = Array.from(byUrl.values())
  csvCache = { key: cacheKey, records, at: Date.now() }

  return { records, files, lastCrawlAt }
}

export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get('refresh') === '1'
  const cutoffMs = Date.now() - WINDOW_MS

  // Live RSS is the primary freshness source; the Scrapy CSV archive
  // supplements it with deep backfill inside the same 60-day window.
  const [rss, csv] = await Promise.all([getRssRecords(force), Promise.resolve(loadCsvRecords(cutoffMs))])

  const byUrl = new Map<string, ArticleRecord>()
  for (const rec of csv.records) byUrl.set(rec.url, rec)
  // RSS wins on collisions — it carries the canonical published_at.
  for (const rec of rss.records) byUrl.set(rec.url, rec)

  const records = Array.from(byUrl.values())
    .filter((rec) => {
      const ts = recordTimestamp(rec)
      return ts >= cutoffMs && ts <= Date.now() + 60_000
    })
    .sort((a, b) => recordTimestamp(b) - recordTimestamp(a))

  const sourceCounts = new Map<string, number>()
  for (const rec of records) {
    sourceCounts.set(rec.publisher, (sourceCounts.get(rec.publisher) ?? 0) + 1)
  }

  const sources = Array.from(sourceCounts.entries())
    .map(([name, count]) => ({ name, count, color: publisherColor(name) }))
    .sort((a, b) => b.count - a.count)

  return NextResponse.json(
    {
      status: records.length ? 'ready' : 'no-output',
      records: records.slice(0, 200),
      total: records.length,
      sources,
      sourceCount: sources.length,
      lastCrawlAt: rss.fetchedAt,
      windowDays: WINDOW_DAYS,
      rssFetchedAt: rss.fetchedAt,
      csvLastCrawlAt: csv.lastCrawlAt,
      crawl: crawlState,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

// Windows boxes almost never have a `python3` on PATH (only `python`, or the
// `py` launcher); macOS/Linux almost always use `python3`. Rather than
// hardcode one and fail silently with ENOENT on the other platform, try a
// short list of candidates in order and fall back automatically.
const PYTHON_CANDIDATES = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python']

function trySpawnCrawl(candidates: string[], attempted: string[] = []): void {
  const [cmd, ...rest] = candidates
  if (!cmd) {
    crawlState.running = false
    crawlState.finishedAt = new Date().toISOString()
    crawlState.lastStatus = 'error'
    crawlState.lastMessage = `Couldn't find a Python interpreter (tried: ${attempted.join(', ')}). Install Python 3.10+ and make sure it's on PATH, then run "pip install -e ./scraper[test]".`
    return
  }

  const args =
    cmd === 'py'
      ? ['-3', '-m', 'india_news.cli', '--days', '60', '--output', 'data', '--log-level', 'WARNING']
      : ['-m', 'india_news.cli', '--days', '60', '--output', 'data', '--log-level', 'WARNING']

  const child = spawn(cmd, args, { cwd: SCRAPER_DIR, shell: false })

  let stderr = ''
  let spawnFailed = false

  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString()
  })
  child.on('close', (code) => {
    if (spawnFailed) return
    crawlState.running = false
    crawlState.finishedAt = new Date().toISOString()
    crawlState.lastStatus = code === 0 ? 'complete' : 'error'
    crawlState.lastMessage = code === 0 ? `Crawl complete (via "${cmd}").` : stderr.slice(-800) || 'Crawl failed.'
  })
  child.on('error', (error: NodeJS.ErrnoException) => {
    spawnFailed = true
    if (error.code === 'ENOENT') {
      // This interpreter isn't installed/on PATH — try the next candidate.
      trySpawnCrawl(rest, [...attempted, cmd])
    } else {
      crawlState.running = false
      crawlState.finishedAt = new Date().toISOString()
      crawlState.lastStatus = 'error'
      crawlState.lastMessage = `Failed to launch "${cmd}": ${error.message}`
    }
  })
}

export async function POST() {
  if (crawlState.running) {
    return NextResponse.json(
      { status: 'already-running', message: 'A crawl is already in progress.', crawl: crawlState },
      { status: 409 },
    )
  }

  // Always refresh the live RSS cache when the user hits "refresh", even if
  // the Python deep-crawl can't run on this machine.
  getRssRecords(true).catch(() => {})

  const initPy = path.join(SCRAPER_DIR, 'india_news', '__init__.py')
  if (!existsSync(initPy)) {
    crawlState.running = false
    crawlState.finishedAt = new Date().toISOString()
    crawlState.lastStatus = 'complete'
    crawlState.lastMessage = 'Live feeds refreshed (deep crawl unavailable: scraper source missing).'
    return NextResponse.json({ status: 'started', message: 'Live feeds refreshing.', crawl: crawlState })
  }

  crawlState.running = true
  crawlState.startedAt = new Date().toISOString()
  crawlState.finishedAt = null
  crawlState.lastStatus = 'running'
  crawlState.lastMessage = 'Crawl in progress…'

  // Run as a module (`-m india_news.cli`) rather than as a bare script, and
  // without a bogus "crawl" positional argument — cli.py's argparse only
  // defines flags (--sources/--days/...), so passing an extra positional
  // token, or invoking the file directly (which breaks its relative
  // imports), always failed before any network request was made.
  trySpawnCrawl(PYTHON_CANDIDATES)

  // Respond immediately — a real crawl across 7 publishers with polite
  // rate limiting can take well past typical HTTP/serverless timeouts.
  // The UI polls GET /api/scraper to pick up fresh data and crawl status.
  return NextResponse.json({ status: 'started', message: 'Crawl started in background.', crawl: crawlState })
}
