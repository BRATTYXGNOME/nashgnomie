"""
Fan Reviews API for nashgnomie.vip (hosted on Render).

GET /reviews  -> reviews scraped fresh from fan.reviews, newest first.
                 A scrape is reused for `cache_minutes` (config.yaml); after that
                 the old copy is served instantly while a new scrape runs in the
                 background. If fan.reviews can't be read, the last good copy
                 (memory, then data/reviews.json) is served instead of an error.
GET /scrape   -> force a fresh scrape now (also handy for a cron ping to keep the
                 server awake).
GET /health   -> scrape status: when it last worked, how many reviews it found
                 vs. fan.reviews' own total, and the last error if any.
"""
import json, os, threading, time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import uvicorn
import yaml
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from scraper import ReviewScraper


def load_config(path: str = "config.yaml"):
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


cfg = load_config()
JSON_PATH = cfg["storage"]["json_path"]
CACHE_SECONDS = int(cfg.get("cache_minutes", 60)) * 60

app = FastAPI(title="Fan Reviews API", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cfg["server"]["cors_origins"],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)

# ---------- in-memory cache ----------
_lock = threading.Lock()
_state: Dict[str, Any] = {
    "reviews": None,        # list of reviews from the last good scrape
    "fetched_at": 0.0,      # time.time() of the last good scrape
    "expected": None,       # fan.reviews' own review count at that time
    "source": None,         # "live" or "snapshot"
    "last_error": None,
    "last_error_at": None,
    "refreshing": False,
}


def _now_iso(ts: Optional[float] = None) -> str:
    return datetime.fromtimestamp(ts or time.time(), timezone.utc).isoformat(timespec="seconds")


def _load_snapshot() -> Optional[List[Dict[str, Any]]]:
    try:
        with open(JSON_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        reviews = data.get("reviews") or []
        return reviews or None
    except Exception:
        return None


def _refresh() -> None:
    """Scrape fan.reviews and update the cache. Never raises."""
    try:
        scraper = ReviewScraper(cfg)
        reviews = scraper.scrape()
        with _lock:
            _state.update(reviews=reviews, fetched_at=time.time(), expected=scraper.expected,
                          source="live", last_error=None)
        try:
            scraper.save_snapshot(reviews)
        except Exception:
            pass  # disk on Render may be read-only/ephemeral; memory cache is enough
        print(f"[reviews] scraped {len(reviews)} (fan.reviews says {scraper.expected})")
    except Exception as e:
        with _lock:
            _state.update(last_error=str(e), last_error_at=_now_iso())
        print(f"[reviews] scrape failed: {e}")
    finally:
        with _lock:
            _state["refreshing"] = False


def _refresh_in_background() -> bool:
    with _lock:
        if _state["refreshing"]:
            return False
        _state["refreshing"] = True
    threading.Thread(target=_refresh, daemon=True).start()
    return True


def get_reviews() -> List[Dict[str, Any]]:
    with _lock:
        reviews, age = _state["reviews"], time.time() - _state["fetched_at"]

    if reviews is None:
        # First request since the server started: scrape now so visitors get fresh data
        with _lock:
            _state["refreshing"] = True
        _refresh()
        with _lock:
            reviews = _state["reviews"]
        if reviews is None:
            snap = _load_snapshot() or []
            with _lock:
                _state.update(reviews=snap, source="snapshot")
            return snap
        return reviews

    if age > CACHE_SECONDS:
        _refresh_in_background()  # serve what we have now, update for the next visitor
    return reviews


# Warm the cache as soon as the server boots
threading.Thread(target=get_reviews, daemon=True).start()


@app.get("/reviews")
def list_reviews(limit: int = Query(100, ge=1, le=1000), offset: int = Query(0, ge=0)):
    return get_reviews()[offset: offset + limit]


@app.get("/scrape")
def trigger_scrape():
    started = _refresh_in_background()
    return {"status": "scrape started" if started else "scrape already running"}


@app.get("/health")
def health():
    with _lock:
        s = dict(_state)
    count = len(s["reviews"] or [])
    return {
        "ok": s["source"] == "live" and (s["expected"] is None or count >= s["expected"]),
        "source": s["source"],
        "reviews": count,
        "fan_reviews_total": s["expected"],
        "last_scrape": _now_iso(s["fetched_at"]) if s["fetched_at"] else None,
        "last_error": s["last_error"],
        "last_error_at": s["last_error_at"],
    }


if __name__ == "__main__":
    uvicorn.run(app, host=cfg["server"]["host"], port=cfg["server"]["port"])
