from .base import MarketNewsSitemapSpider


class ZeeBusinessSpider(MarketNewsSitemapSpider):
    name = "zee_business"
    publisher = "Zee Business"
    allowed_domains = ["zeebiz.com", "www.zeebiz.com"]
    sitemap_urls = ["https://www.zeebiz.com/robots.txt"]
    sitemap_alternate_links = True
    article_patterns = ("/market-news/", "/economy-infra/", "/personal-finance/", "/companies/", "/india/", "/world/")
    selectors = {
        "title": "h1",
        "author": ".author-name, .auth_by, [class*=author]",
        "description": ".article-desc, .summary, [class*=description]",
        "article": ".article-content, .content_wrapper, .article_content, article",
        "published": "time[datetime], .article_date, .date_time",
        "modified": "time[datetime], .updated_date",
    }
