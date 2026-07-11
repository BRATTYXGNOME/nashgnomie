import json, os, threading
from typing import Optional, List
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import yaml

class Review(BaseModel):
    username: str
    avatar_url: Optional[str] = None
    rating: Optional[float] = None
    review_title: Optional[str] = None
    review_text: str
    time_text: Optional[str] = None
    permalink: Optional[str] = None
    scraped_date: Optional[str] = None

class Storage(BaseModel):
    reviews: List[Review]
    hashes: List[str]

def load_config(path: str = "config.yaml"):
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)

cfg = load_config()
JSON_PATH = cfg["storage"]["json_path"]

app = FastAPI(title="Fan Reviews API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cfg["server"]["cors_origins"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def read_store() -> Storage:
    if not os.path.exists(JSON_PATH):
        return Storage(reviews=[], hashes=[])
    with open(JSON_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    return Storage(reviews=[Review(**r) for r in data.get("reviews", [])],
                   hashes=data.get("hashes", []))

@app.get("/health")
def health():
    return {"ok": True}

@app.get("/reviews", response_model=List[Review])
def list_reviews(limit: int = Query(100, ge=1, le=1000), offset: int = Query(0, ge=0)):
    store = read_store()
    return store.reviews[offset: offset + limit]

@app.get("/reviews/{username}", response_model=List[Review])
def reviews_by_user(username: str):
    store = read_store()
    out = [r for r in store.reviews if r.username.lower() == username.lower()]
    if not out:
        raise HTTPException(status_code=404, detail="No reviews for that username")
    return out

@app.get("/scrape")
def trigger_scrape():
    """Endpoint for cron-job.org to ping. Runs scraper in background."""
    from scraper import ReviewScraper, load_config as load_scraper_config
    def run():
        try:
            scfg = load_scraper_config()
            result = ReviewScraper(scfg).scrape()
            print(f"Scrape complete: {result['count']} reviews")
        except Exception as e:
            print(f"Scrape error: {e}")
    threading.Thread(target=run, daemon=True).start()
    return {"status": "scrape started"}

if __name__ == "__main__":
    uvicorn.run(app, host=cfg["server"]["host"], port=cfg["server"]["port"])
