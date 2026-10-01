import argparse
from pathlib import Path

from scrapy.crawler import CrawlerProcess

from .consolidate import consolidate
from .spiders.business_standard import BusinessStandardSpider
from .spiders.cnbc_awaaz import CnbcAwaazSpider
from .spiders.economic_times import EconomicTimesSpider
from .spiders.moneycontrol import MoneycontrolSpider
from .spiders.news18 import News18Spider
from .spiders.the_hindu import TheHinduSpider
from .spiders.zee_business import ZeeBusinessSpider

SPIDERS = {
    "moneycontrol": MoneycontrolSpider,
    "economic_times": EconomicTimesSpider,
    "business_standard": BusinessStandardSpider,
    "the_hindu": TheHinduSpider,
    "news18": News18Spider,
    "zee_business": ZeeBusinessSpider,
    "cnbc_awaaz": CnbcAwaazSpider,
}


def main():
    parser = argparse.ArgumentParser(description="Scrape Indian financial/market news.")
    parser.add_argument("--sources", nargs="+", choices=sorted(SPIDERS), default=list(SPIDERS))
    parser.add_argument("--days", type=int, default=7, help="Recent window; ignored with --backfill (default: 7).")
    parser.add_argument("--backfill", action="store_true", help="Process all sitemap URLs instead of the recent window.")
    parser.add_argument("--output", default="data", help="Output directory (default: data).")
    parser.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    args = parser.parse_args()

    root = Path(args.output)
    raw = root / "raw"
    processed = root / "processed"
    raw.mkdir(parents=True, exist_ok=True)
    processed.mkdir(parents=True, exist_ok=True)

    feeds = {}
    for source in args.sources:
        path = raw / f"{source}.csv"
        feeds[str(path)] = {"format": "csv", "overwrite": True}

    settings = {
        "NEWS_DAYS": args.days,
        "BACKFILL": args.backfill,
        "LOG_LEVEL": args.log_level,
        "FEEDS": feeds,
    }

    process = CrawlerProcess(settings=settings)
    for source in args.sources:
        process.crawl(SPIDERS[source])
    process.start()

    parquet = consolidate(raw, processed)
    print(f"Combined Parquet: {parquet}")
    for source in args.sources:
        print(f"CSV: {raw / (source + '.csv')}")
