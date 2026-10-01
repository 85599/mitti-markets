from .base import MarketNewsSitemapSpider


class BusinessStandardSpider(MarketNewsSitemapSpider):
    name = "business_standard"
    publisher = "Business Standard"
    allowed_domains = ["business-standard.com", "www.business-standard.com"]
    sitemap_urls = ["https://www.business-standard.com/robots.txt"]
    article_patterns = ("/storypage/", "/news-", "/markets/", "/finance/")
    selectors = {
        "title": "h1",
        "author": ".author-name, .author, [class*=author]",
        "description": ".article-desc, .summary, [class*=description]",
        "article": ".article-content, .story-content, .article-body, article",
        "published": "time[datetime], .story-date, .published-date",
        "modified": "time[datetime], .updated-date",
    }
