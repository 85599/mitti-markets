from .base import MarketNewsSitemapSpider


class MoneycontrolSpider(MarketNewsSitemapSpider):
    name = "moneycontrol"
    publisher = "Moneycontrol"
    allowed_domains = ["moneycontrol.com", "www.moneycontrol.com"]
    sitemap_urls = ["https://www.moneycontrol.com/robots.txt"]
    article_patterns = ("/news/", "/news/business/", "/news/stocks/", "/news/markets/")
    selectors = {
        "title": "h1",
        "author": ".author_name, .article_author, [class*=author]",
        "description": ".article_desc, .article_description",
        "article": ".article_block, .article_body, .article-content, article",
        "published": "time[datetime], .article_schedule",
        "modified": "time[datetime], .article_update",
    }
