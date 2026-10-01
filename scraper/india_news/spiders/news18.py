from .base import MarketNewsSitemapSpider


class News18Spider(MarketNewsSitemapSpider):
    name = "news18"
    publisher = "News18"
    allowed_domains = ["news18.com", "www.news18.com"]
    sitemap_urls = ["https://www.news18.com/robots.txt"]
    article_patterns = ("/business/", "/market/", "/news/")
    selectors = {
        "title": "h1",
        "author": ".author-name, .author, [class*=author]",
        "description": ".article_desc, .summary, [class*=description]",
        "article": ".article_body, .article-content, .articlebody, article",
        "published": "time[datetime], .article_date, .publish-date",
        "modified": "time[datetime], .update-date",
    }
