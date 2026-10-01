from .base import MarketNewsSitemapSpider


class CnbcAwaazSpider(MarketNewsSitemapSpider):
    name = "cnbc_awaaz"
    publisher = "CNBC Awaaz"
    allowed_domains = ["hindi.cnbctv18.com"]
    sitemap_urls = ["https://hindi.cnbctv18.com/robots.txt"]
    sitemap_alternate_links = True
    article_patterns = ("/market/", "/business/", "/personal-finance/", "/economy/", "/news/")
    selectors = {
        "title": "h1",
        "author": ".author-name, .auth_by, [class*=author]",
        "description": ".article-desc, .summary, [class*=description]",
        "article": ".story_details, .article-content, .content_wrapper, article",
        "published": "time[datetime], .story_date, .date_time",
        "modified": "time[datetime], .updated_date",
    }
