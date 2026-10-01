# India Market News Scraper

A modular Scrapy crawler for Indian financial/market news. Each publisher is a separate spider, while shared extraction and normalization live in `india_news/`.

## Included publishers

- Moneycontrol
- Economic Times
- Business Standard
- The Hindu
- News18
- Zee Business
- CNBC Awaaz (Hindi)

The project intentionally discovers sitemap URLs from each publisher's `robots.txt` where possible. Scrapy's `SitemapSpider` supports sitemap indexes, nested sitemaps, and sitemap URLs declared in robots.txt.

## Output

Each run creates:

- `data/raw/<publisher>.csv` — one clean CSV per source
- `data/processed/india_market_news.parquet` — deduplicated combined dataset

Schema:

`publisher, title, author, description, url, article_text, published_at, modified_at, scraped_at`

Dates are normalized to UTC ISO-8601 strings.

## Quick start

Python 3.10+ is recommended.

```bash
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# macOS/Linux: source .venv/bin/activate
pip install -e ".[test]"

# Recent articles (last 7 days) from all publishers
india-news

# Last 2 days
india-news --days 2

# Only selected sources
india-news --sources moneycontrol economic_times business_standard

# Fuller sitemap backfill
india-news --backfill

# Run tests
pytest
```

## Adding/updating a publisher

1. Create `india_news/spiders/<publisher>.py`.
2. Subclass `MarketNewsSitemapSpider`.
3. Set `name`, `publisher`, `allowed_domains`, `sitemap_urls`, `article_patterns`, and publisher-specific selectors.
4. Import the spider in `india_news/spiders/__init__.py` and register it in `india_news/cli.py`.
5. Add a small extraction test.

The common extractor uses publisher selectors first and JSON-LD/OpenGraph metadata plus Trafilatura as fallbacks. This makes layout changes easier to isolate to one spider.

## Crawl behavior

The default is deliberately conservative: robots.txt compliance, low concurrency, download delay, AutoThrottle, and retries. Recent mode uses sitemap `<lastmod>` where available; pages without usable sitemap dates are allowed through and are filtered after article metadata is extracted.

`--backfill` disables the sitemap recency filter. Backfills can be large, so use them responsibly and verify the publisher permits the intended collection and downstream use. Do not bypass paywalls, access controls, CAPTCHAs, or robots restrictions.

## Notes on publisher variability

News sites change HTML frequently, and some pages can be JavaScript-heavy, paywalled, rate-limited, or protected. The project is designed so a source-specific spider can be adjusted without changing the shared pipeline. Full article text is best-effort and may be empty when a publisher does not expose article content to the crawler.

## Current sitemap references checked during setup

- Moneycontrol exposes a sitemap page and market/news sections.
- Economic Times exposes a site map and sitemap infrastructure.
- Business Standard exposes sitemap endpoints including article/latest-news and Google News sitemap references in its robots configuration.
- The Hindu and News18 were included as robots-discovered sitemap spiders; their robots/sitemap endpoints should be rechecked locally if access rules change.

This tool is for lawful research/archival use. Respect each publisher's robots.txt, terms, rate limits, copyright, and applicable Indian law. The project does not include any paywall or anti-bot bypass.
