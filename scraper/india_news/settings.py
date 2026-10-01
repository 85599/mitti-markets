BOT_NAME = "india_market_news"
SPIDER_MODULES = ["india_news.spiders"]
NEWSPIDER_MODULE = "india_news.spiders"

ROBOTSTXT_OBEY = True
CONCURRENT_REQUESTS = 4
DOWNLOAD_DELAY = 0.75
RANDOMIZE_DOWNLOAD_DELAY = True
AUTOTHROTTLE_ENABLED = True
AUTOTHROTTLE_START_DELAY = 1.0
AUTOTHROTTLE_MAX_DELAY = 10.0
AUTOTHROTTLE_TARGET_CONCURRENCY = 1.0
RETRY_TIMES = 2
COOKIES_ENABLED = False
TELNETCONSOLE_ENABLED = False
LOG_LEVEL = "INFO"
USER_AGENT = "IndiaMarketNewsScraper/0.1 (+local research crawler; respect publisher robots.txt and terms)"
FEED_EXPORT_ENCODING = "utf-8"

ITEM_PIPELINES = {
    "india_news.pipelines.NormalizePipeline": 100,
}
