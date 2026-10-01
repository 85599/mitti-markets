from datetime import datetime, timezone
import re

from itemadapter import ItemAdapter


class NormalizePipeline:
    """Keep output schema stable across publishers."""

    fields = [
        "publisher", "title", "author", "description", "url",
        "article_text", "published_at", "modified_at", "scraped_at",
    ]

    def process_item(self, item, spider):
        adapter = ItemAdapter(item)
        for field in self.fields:
            value = adapter.get(field)
            if value is None:
                adapter[field] = ""
            elif isinstance(value, str):
                adapter[field] = re.sub(r"\\s+", " ", value).strip()
        if not adapter.get("scraped_at"):
            adapter["scraped_at"] = datetime.now(timezone.utc).isoformat()
        return item
