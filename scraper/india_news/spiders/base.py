from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

import scrapy
from scrapy.spiders import SitemapSpider

from india_news.extractors import extract_common
from india_news.items import ArticleItem


class MarketNewsSitemapSpider(SitemapSpider):
    publisher = ""
    sitemap_urls = []
    article_patterns = ()
    selectors = {}
    default_days = 7

    @classmethod
    def from_crawler(cls, crawler, *args, **kwargs):
        spider = super().from_crawler(crawler, *args, **kwargs)
        spider.days = int(crawler.settings.get("NEWS_DAYS", cls.default_days))
        spider.backfill = crawler.settings.getbool("BACKFILL", False)
        return spider

    def sitemap_filter(self, entries):
        if self.backfill:
            yield from entries
            return
        cutoff = datetime.now(timezone.utc) - timedelta(days=self.days)
        for entry in entries:
            lastmod = entry.get("lastmod")
            if not lastmod:
                yield entry
                continue
            try:
                if lastmod.tzinfo is None:
                    lastmod = lastmod.replace(tzinfo=timezone.utc)
                if lastmod >= cutoff:
                    yield entry
            except Exception:
                yield entry

    def _is_article(self, url):
        if not self.article_patterns:
            return True
        return any(pattern in url for pattern in self.article_patterns)

    def parse(self, response):
        if not self._is_article(response.url):
            return
        data = extract_common(response, self.selectors)
        if not data["title"] or not data["article_text"]:
            self.logger.debug("Weak extraction: %s", response.url)
        yield ArticleItem(
            publisher=self.publisher,
            url=response.url,
            **data,
        )
