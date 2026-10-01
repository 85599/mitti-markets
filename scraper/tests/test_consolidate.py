import pandas as pd

from india_news.consolidate import consolidate


def test_consolidate_deduplicates_by_url(tmp_path):
    raw = tmp_path / "raw"
    processed = tmp_path / "processed"
    raw.mkdir()
    pd.DataFrame([
        {"publisher":"A","title":"one","url":"https://x/a","article_text":"text"},
        {"publisher":"A","title":"duplicate","url":"https://x/a","article_text":"text2"},
    ]).to_csv(raw / "a.csv", index=False)
    destination = consolidate(raw, processed)
    result = pd.read_parquet(destination)
    assert len(result) == 1
    assert result.loc[0, "url"] == "https://x/a"
