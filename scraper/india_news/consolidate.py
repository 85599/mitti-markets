from pathlib import Path
import pandas as pd

COLUMNS = [
    "publisher", "title", "author", "description", "url",
    "article_text", "published_at", "modified_at", "scraped_at",
]


def consolidate(raw_dir: str | Path, processed_dir: str | Path) -> Path:
    raw = Path(raw_dir)
    out = Path(processed_dir)
    out.mkdir(parents=True, exist_ok=True)
    frames = []
    for path in sorted(raw.glob("*.csv")):
        try:
            df = pd.read_csv(path, dtype=str, keep_default_na=False)
        except pd.errors.EmptyDataError:
            continue
        for col in COLUMNS:
            if col not in df.columns:
                df[col] = ""
        frames.append(df[COLUMNS])
    if frames:
        combined = pd.concat(frames, ignore_index=True)
        combined = combined.drop_duplicates(subset=["url"], keep="last")
        combined = combined.sort_values(["published_at", "publisher"], ascending=[False, True])
    else:
        combined = pd.DataFrame(columns=COLUMNS)
    destination = out / "india_market_news.parquet"
    combined.to_parquet(destination, index=False)
    return destination
