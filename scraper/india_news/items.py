import scrapy


class ArticleItem(scrapy.Item):
    publisher = scrapy.Field()
    title = scrapy.Field()
    author = scrapy.Field()
    description = scrapy.Field()
    url = scrapy.Field()
    article_text = scrapy.Field()
    published_at = scrapy.Field()
    modified_at = scrapy.Field()
    scraped_at = scrapy.Field()
