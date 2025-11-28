import json, os, time
from typing import Optional, List
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import yaml
from threading import Thread
import traceback

class Review(BaseModel):
    username: str
    avatar_url: Optional[str] = None
    rating: Optional[float] = None
    review_title: Optional[str] = None
    review_text: str
    time_text: Optional[str] = None
    permalink: Optional[str] = None

class Storage(BaseModel):
    reviews: List[Review]
    hashes: List[str]

def load_config(path: str = "config.yaml"):
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)

cfg = load_config()
JSON_PATH = cfg["storage"]["json_path"]

# Ensure data directory exists with better error handling
try:
    data_dir = os.path.dirname(JSON_PATH)
    if data_dir:
        os.makedirs(data_dir, exist_ok=True)
        print(f"✅ Data directory ensured: {data_dir}")
    else:
        print(f"⚠️  No directory in path: {JSON_PATH}")
except Exception as e:
    print(f"❌ Error creating data directory: {e}")

app = FastAPI(
    title="Nash Gnomie Fan Reviews API",
    version="1.0.0",
    description="API for fetching fan reviews from fan.reviews scraper"
)

# Configure CORS for nashgnomie.vip and nashgnomie.com
app.add_middleware(
    CORSMiddleware,
    allow_origins=cfg["server"].get("cors_origins", [
        "https://nashgnomie.vip",
        "https://www.nashgnomie.vip",
        "https://nashgnomie.com",
        "https://www.nashgnomie.com"
    ]),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def read_store() -> Storage:
    """Read reviews from JSON storage file."""
    if not os.path.exists(JSON_PATH):
        return Storage(reviews=[], hashes=[])
    
    try:
        with open(JSON_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return Storage(
            reviews=[Review(**r) for r in data.get("reviews", [])],
            hashes=data.get("hashes", [])
        )
    except Exception as e:
        print(f"❌ Error reading storage: {e}")
        return Storage(reviews=[], hashes=[])

# ==========================================
# BACKGROUND SCRAPER - Runs every 15 minutes
# ==========================================

def run_scraper():
    """Run the scraper and return results with detailed error logging."""
    try:
        print("📥 Importing scraper module...")
        from scraper import ReviewScraper, load_config
        
        print("📋 Loading config...")
        cfg = load_config()
        
        print("🔧 Initializing scraper...")
        scraper = ReviewScraper(cfg)
        
        print("🌐 Starting scrape...")
        result = scraper.scrape()
        
        print(f"✅ Scraper completed: {result['count']} reviews saved to {result['path']}")
        return result
        
    except Exception as e:
        error_msg = f"❌ Scraper error: {type(e).__name__}: {str(e)}"
        print(error_msg)
        print("📋 Full traceback:")
        traceback.print_exc()
        return {"error": str(e), "type": type(e).__name__}

def scraper_background_loop():
    """Background thread that runs scraper every 15 minutes."""
    print("🚀 Background scraper thread started")
    
    # Run immediately on startup
    print("⏳ Running initial scrape...")
    result = run_scraper()
    print(f"📊 Initial scrape result: {result}")
    
    # Then run every 15 minutes
    while True:
        print("⏰ Sleeping for 15 minutes...")
        time.sleep(900)  # 15 minutes = 900 seconds
        print("⏳ Running scheduled scrape...")
        result = run_scraper()
        print(f"📊 Scheduled scrape result: {result}")

# Start background scraper thread
print("🎬 Starting background scraper thread...")
scraper_thread = Thread(target=scraper_background_loop, daemon=True)
scraper_thread.start()
print("✅ Background thread started successfully")

# ==========================================
# API ENDPOINTS
# ==========================================

@app.get("/")
def root():
    """Root endpoint - API information."""
    return {
        "service": "Nash Gnomie Fan Reviews API",
        "version": "1.0.0",
        "endpoints": {
            "health": "/health",
            "reviews": "/reviews",
            "reviews_by_user": "/reviews/{username}",
            "scrape_now": "/scrape-now (POST)"
        },
        "docs": "/docs",
        "auto_scraper": "Runs every 15 minutes"
    }

@app.get("/health")
def health():
    """Health check endpoint for monitoring."""
    store = read_store()
    return {
        "status": "healthy",
        "reviews_count": len(store.reviews),
        "storage_path": JSON_PATH,
        "storage_exists": os.path.exists(JSON_PATH),
        "auto_scraper": "active"
    }

@app.get("/reviews", response_model=List[Review])
def list_reviews(limit: int = Query(100, ge=1, le=1000), offset: int = Query(0, ge=0)):
    """
    Get all reviews with pagination.
    
    - **limit**: Maximum number of reviews to return (1-1000)
    - **offset**: Number of reviews to skip
    """
    store = read_store()
    return store.reviews[offset: offset + limit]

@app.get("/reviews/{username}", response_model=List[Review])
def reviews_by_user(username: str):
    """
    Get all reviews by a specific username.
    
    - **username**: The username to search for (case-insensitive)
    """
    store = read_store()
    out = [r for r in store.reviews if r.username.lower() == username.lower()]
    if not out:
        raise HTTPException(status_code=404, detail=f"No reviews found for username: {username}")
    return out

@app.post("/scrape-now")
def trigger_scrape():
    """
    Manually trigger a scrape immediately.
    
    This endpoint allows you to run the scraper on-demand
    instead of waiting for the 15-minute interval.
    """
    print("🔄 Manual scrape triggered via API")
    result = run_scraper()
    return {
        "status": "completed",
        "result": result
    }

# For local development only
if __name__ == "__main__":
    host = os.getenv("HOST", cfg["server"].get("host", "0.0.0.0"))
    port = int(os.getenv("PORT", cfg["server"].get("port", 8989)))
    
    print(f"Starting Nash Gnomie Reviews API on {host}:{port}")
    print(f"Storage path: {JSON_PATH}")
    print(f"Auto-scraper: Runs every 15 minutes")
    
    uvicorn.run(
        app,
        host=host,
        port=port,
        log_level="info"
    )
