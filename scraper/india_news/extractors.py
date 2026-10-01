import json
import re
from datetime import datetime, timezone
from typing import Iterable

import trafilatura
from dateutil import parser as dateparser
from parsel import Selector


def first_nonempty(values: Iterable[str | None]) -> str:
    for value in values:
        if value and value.strip():
            return value.strip()
    return ""


def clean_text(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"\\s+", " ", value).strip()


def meta(response, *names: str) -> str:
    sel = Selector(response.text)
    for name in names:
        value = sel.css(f'meta[name="{name}"]::attr(content)').get()
        if value:
            return clean_text(value)
        value = sel.css(f'meta[property="{name}"]::attr(content)').get()
        if value:
            return clean_text(value)
    return ""


def jsonld_objects(response):
    sel = Selector(response.text)
    for raw in sel.css('script[type="application/ld+json"]::text').getall():
        try:
            obj = json.loads(raw)
        except Exception:
            continue
        if isinstance(obj, dict) and "@graph" in obj:
            yield from [x for x in obj["@graph"] if isinstance(x, dict)]
        elif isinstance(obj, list):
            yield from [x for x in obj if isinstance(x, dict)]
        elif isinstance(obj, dict):
            yield obj


def article_jsonld(response):
    for obj in jsonld_objects(response):
        typ = obj.get("@type", "")
        types = typ if isinstance(typ, list) else [typ]
        if any(t in {"NewsArticle", "Article", "ReportageNewsArticle", "AnalysisNewsArticle"} for t in types):
            return obj
    return {}


def parse_date(value: str | None) -> str:
    if not value:
        return ""
    try:
        dt = dateparser.parse(value)
        if not dt:
            return ""
        if not dt.tzinfo:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    except (ValueError, TypeError, OverflowError):
        return ""


def extract_common(response, selectors: dict) -> dict:
    sel = Selector(response.text)
    ld = article_jsonld(response)

    def css_text(key):
        selector = selectors.get(key, "")
        return clean_text(sel.css(selector).xpath("string(.)").get()) if selector else ""

    title = first_nonempty([
        css_text("title"),
        ld.get("headline"),
        meta(response, "og:title", "twitter:title"),
        response.css("title::text").get(),
    ])
    author = first_nonempty([
        css_text("author"),
        ld.get("author", {}).get("name") if isinstance(ld.get("author"), dict) else "",
        meta(response, "author", "byl", "article:author"),
    ])
    description = first_nonempty([
        css_text("description"),
        ld.get("description"),
        meta(response, "description", "og:description", "twitter:description"),
    ])
    published = first_nonempty([
        css_text("published"),
        ld.get("datePublished"),
        meta(response, "article:published_time", "datePublished"),
    ])
    modified = first_nonempty([
        css_text("modified"),
        ld.get("dateModified"),
        meta(response, "article:modified_time", "dateModified"),
    ])

    text = ""
    article_selector = selectors.get("article", "")
    if article_selector:
        text = clean_text(sel.css(article_selector).xpath("string(.)").get())
    if len(text) < 300:
        extracted = trafilatura.extract(
            response.text,
            include_comments=False,
            include_tables=False,
            favor_precision=True,
            output_format="txt",
        )
        if extracted:
            text = clean_text(extracted)

    return {
        "title": title,
        "author": author,
        "description": description,
        "article_text": text,
        "published_at": parse_date(published),
        "modified_at": parse_date(modified),
    }
