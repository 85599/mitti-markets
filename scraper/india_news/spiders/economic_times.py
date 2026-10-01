from .base import MarketNewsSitemapSpider


class EconomicTimesSpider(MarketNewsSitemapSpider):
    name = "economic_times"
    publisher = "Economic Times"
    allowed_domains = ["economictimes.indiatimes.com"]
    sitemap_urls = ["https://economictimes.indiatimes.com/robots.txt"]
    article_patterns = ("/markets/", "/news/", "/industry/", "/wealth/", "/small-biz/", "/mf/")
    selectors = {
        "title": "h1",
        "author": ".byline, .auth_by, [class*=author]",
        "description": ".article_desc, .summary, [class*=description]",
        "article": ".artText, .article_block, .article_body, article",
        "published": "time[datetime], .publish_on",
        "modified": "time[datetime], .updated_on",
    }
