from .base import MarketNewsSitemapSpider


class TheHinduSpider(MarketNewsSitemapSpider):
    name = "the_hindu"
    publisher = "The Hindu"
    allowed_domains = ["thehindu.com", "www.thehindu.com"]
    sitemap_urls = ["https://www.thehindu.com/robots.txt"]
    article_patterns = ("/business/", "/business/markets/", "/business/Economy/", "/news/")
    selectors = {
        "title": "h1",
        "author": ".author-container, .author-name, [class*=author]",
        "description": ".intro, .lead, [class*=description]",
        "article": ".articlebodycontent, .article-body, article",
        "published": "time[datetime], .publish-time, .update-time",
        "modified": "time[datetime], .update-time",
    }
