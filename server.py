import json, os
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

class Storage(BaseModel):
    reviews: List[Review]
    hashes: List[str]

def load_config(path: str = "config.yaml"):
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)

cfg = load_config()
JSON_PATH = cfg["storage"]["json_path"]

# Ensure data directory exists
os.makedirs(os.path.dirname(JSON_PATH) if os.path.dirname(JSON_PATH) else ".", exist_ok=True)

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
        print(f"Error reading storage: {e}")
        return Storage(reviews=[], hashes=[])

@app.get("/")
def root():
    """Root endpoint - API information."""
    return {
        "service": "Nash Gnomie Fan Reviews API",
        "version": "1.0.0",
        "endpoints": {
            "health": "/health",
            "reviews": "/reviews",
            "reviews_by_user": "/reviews/{username}"
        },
        "docs": "/docs"
    }

@app.get("/health")
def health():
    """Health check endpoint for monitoring."""
    store = read_store()
    return {
        "status": "healthy",
        "reviews_count": len(store.reviews),
        "storage_path": JSON_PATH,
        "storage_exists": os.path.exists(JSON_PATH)
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

# For local development only
if __name__ == "__main__":
    host = os.getenv("HOST", cfg["server"].get("host", "0.0.0.0"))
    port = int(os.getenv("PORT", cfg["server"].get("port", 8989)))
    
    print(f"Starting Nash Gnomie Reviews API on {host}:{port}")
    print(f"Storage path: {JSON_PATH}")
    
    uvicorn.run(
        app,
        host=host,
        port=port,
        log_level="info"
    )