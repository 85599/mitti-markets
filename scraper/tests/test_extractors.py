from scrapy.http import HtmlResponse, Request

from india_news.extractors import extract_common, parse_date


HTML = b'''<html><head>
<meta name="description" content="A short market description">
<script type="application/ld+json">{
"@type":"NewsArticle","headline":"Market headline","description":"JSON description",
"datePublished":"2026-09-13T10:00:00+05:30","dateModified":"2026-09-13T12:00:00+05:30",
"author":{"@type":"Person","name":"Jane Doe"}}
</script></head><body><h1>Market headline</h1>
<article>This is a sufficiently long article body. It contains market news and details for testing extraction.</article></body></html>'''


def test_extract_common_prefers_structured_metadata():
    response = HtmlResponse(url="https://example.com/article", body=HTML, encoding="utf-8", request=Request("https://example.com/article"))
    data = extract_common(response, {"title": "h1", "article": "article"})
    assert data["title"] == "Market headline"
    assert data["author"] == "Jane Doe"
    assert data["published_at"].startswith("2026-09-13T04:30:00")
    assert "market news" in data["article_text"].lower()


def test_parse_date_empty_is_stable():
    assert parse_date("") == ""
