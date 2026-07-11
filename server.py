import json, os, time, hashlib, re
from dataclasses import dataclass, asdict
from typing import List, Dict, Any, Optional, Set
from datetime import datetime, timedelta
import requests
from bs4 import BeautifulSoup
import yaml
from urllib.parse import urljoin

@dataclass
class Review:
    username: str
    avatar_url: Optional[str]
    rating: Optional[float]
    review_title: Optional[str]
    review_text: str
    time_text: Optional[str]
    permalink: Optional[str]
    scraped_date: Optional[str] = None

class ReviewScraper:
    def __init__(self, cfg: Dict[str, Any]):
        self.cfg = cfg
        self.base_url = cfg["fan_reviews_url"].rstrip("/")
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": cfg["request"]["user_agent"]})
        self.timeout = cfg["request"]["timeout"]
        self.json_path = cfg["storage"]["json_path"]
        os.makedirs(os.path.dirname(self.json_path), exist_ok=True)
        self.sel = cfg["selectors"]
        self.max_pages = int(cfg["pagination"]["max_pages"])
        self.pagination_mode = cfg["pagination"].get("mode", "discover")
        self.sleep_ms = cfg["request"]["sleep_between_pages_ms"]
        self.dedupe_fields = cfg["dedupe"]["fields"]

    def _get(self, url: str) -> str:
        r = self.session.get(url, timeout=self.timeout)
        r.raise_for_status()
        return r.text

    def _sleep(self):
        time.sleep(self.sleep_ms / 1000.0)

    def _parse_relative_date(self, text: str) -> Optional[str]:
        """Convert '2h ago', '5d ago', '1w ago', '3mo ago' etc. to ISO date string."""
        if not text:
            return None
        text = text.strip().lower()
        m = re.match(r'(\d+)\s*(h|hr|hour|d|day|w|wk|week|mo|month|y|yr|year)s?\s*ago', text)
        if not m:
            # Try "edited" suffix e.g. "5d ago(edited)"
            m = re.match(r'(\d+)\s*(h|hr|hour|d|day|w|wk|week|mo|month|y|yr|year)s?\s*ago', text.split('(')[0].strip())
        if not m:
            return datetime.utcnow().isoformat()
        num = int(m.group(1))
        unit = m.group(2)
        now = datetime.utcnow()
        if unit in ('h', 'hr', 'hour'):
            dt = now - timedelta(hours=num)
        elif unit in ('d', 'day'):
            dt = now - timedelta(days=num)
        elif unit in ('w', 'wk', 'week'):
            dt = now - timedelta(weeks=num)
        elif unit in ('mo', 'month'):
            dt = now - timedelta(days=num * 30)
        elif unit in ('y', 'yr', 'year'):
            dt = now - timedelta(days=num * 365)
        else:
            dt = now
        return dt.isoformat()

    def _calc_relative_time(self, iso_date: str) -> str:
        """Convert ISO date string back to relative time like '2d ago'."""
        try:
            dt = datetime.fromisoformat(iso_date)
        except Exception:
            return ""
        now = datetime.utcnow()
        diff = now - dt
        seconds = int(diff.total_seconds())
        if seconds < 3600:
            mins = max(1, seconds // 60)
            return f"{mins}m ago"
        elif seconds < 86400:
            hours = seconds // 3600
            return f"{hours}h ago"
        elif seconds < 604800:
            days = seconds // 86400
            return f"{days}d ago"
        elif seconds < 2592000:
            weeks = seconds // 604800
            return f"{weeks}w ago"
        elif seconds < 31536000:
            months = seconds // 2592000
            return f"{months}mo ago" if months > 0 else "1mo ago"
        else:
            years = seconds // 31536000
            return f"{years}y ago"

    def _recalculate_dates(self, reviews: List[Review]) -> List[Review]:
        """Recalculate all relative dates from stored absolute dates."""
        for r in reviews:
            if r.scraped_date:
                r.time_text = self._calc_relative_time(r.scraped_date)
        return reviews

    def _hash_for_dedupe(self, r: Review) -> str:
        parts = []
        for f in self.dedupe_fields:
            v = getattr(r, f, None)
            parts.append("" if v is None else str(v))
        return hashlib.sha256("||".join(parts).encode("utf-8")).hexdigest()

    def _load_existing(self) -> Dict[str, Any]:
        if not os.path.exists(self.json_path):
            return {"reviews": [], "hashes": []}
        try:
            with open(self.json_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            data.setdefault("reviews", [])
            data.setdefault("hashes", [])
            return data
        except Exception:
            return {"reviews": [], "hashes": []}

    def _save(self, reviews: List[Review], hashes: List[str]):
        with open(self.json_path, "w", encoding="utf-8") as f:
            json.dump({"reviews": [asdict(r) for r in reviews], "hashes": hashes}, f,
                      ensure_ascii=False, indent=2)

    def _parse_rating(self, container: BeautifulSoup) -> Optional[float]:
        sel = self.sel.get("rating_text")
        node = container.select_one(sel) if sel else None
        if node:
            txt = node.get_text(strip=True)
            try:
                return float(txt)
            except ValueError:
                pass
        # fallback: count stars
        stars = container.select(".comment-rate-group .star-rating .star.star-full")
        if stars:
            return float(len(stars))
        return None

    def _extract_perma(self, li: BeautifulSoup, page_url: str) -> Optional[str]:
        cid = li.get("id")
        return f"{page_url}#{cid}" if cid else None

    def _extract_review(self, li: BeautifulSoup, page_url: str) -> Optional[Review]:
        s = self.sel
        username_node = li.select_one(s["username"])
        if not username_node:
            return None
        username = username_node.get_text(strip=True)

        avatar_url = None
        avatar_node = li.select_one(s["avatar"])
        if avatar_node and avatar_node.has_attr("src"):
            avatar_url = avatar_node["src"]

        rating = self._parse_rating(li)

        title_node = li.select_one(s.get("review_title"))
        title = title_node.get_text(strip=True) if title_node else None

        body_node = li.select_one(s["review_content"])
        if not body_node:
            return None
        if title_node:
            title_node.extract()
        review_text = body_node.get_text("\n", strip=True)

        time_text = None
        for tsel in s["time_text"].split(","):
            t = li.select_one(tsel.strip())
            if t:
                time_text = t.get_text(strip=True)
                break

        permalink = self._extract_perma(li, page_url)
        scraped_date = self._parse_relative_date(time_text)
        return Review(username, avatar_url, rating, title, review_text, time_text, permalink, scraped_date)

    def _discover_pages(self, html: str, page_url: str) -> List[str]:
        soup = BeautifulSoup(html, "html.parser")
        pages = {page_url}
        pag = soup.select_one("#comments_pagination")
        if pag:
            for a in pag.select("a.page-numbers"):
                href = a.get("href")
                if href:
                    pages.add(urljoin(page_url, href))
        return sorted(pages)

    def scrape(self) -> Dict[str, Any]:
        existing = self._load_existing()
        collected: List[Review] = [Review(**r) for r in existing["reviews"]]
        known: Set[str] = set(existing["hashes"])

        first_html = self._get(self.base_url)
        page_urls = self._discover_pages(first_html, self.base_url) if self.pagination_mode == "discover" else [self.base_url]
        page_urls = page_urls[: self.max_pages]

        for i, page_url in enumerate(page_urls, start=1):
            html = first_html if i == 1 else self._get(page_url)
            soup = BeautifulSoup(html, "html.parser")
            cards = soup.select(self.sel["review_container"])
            added = 0
            for li in cards:
                r = self._extract_review(li, page_url)
                if not r:
                    continue
                h = self._hash_for_dedupe(r)
                if h in known:
                    continue
                collected.append(r)
                known.add(h)
                added += 1
            print(f"{page_url} -> +{added} new (total {len(collected)})")
            if i < len(page_urls):
                self._sleep()

        # Recalculate relative dates for ALL reviews from absolute dates
        collected = self._recalculate_dates(collected)
        self._save(collected, list(known))
        return {"count": len(collected), "path": self.json_path}

def load_config(path: str = "config.yaml") -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)

if __name__ == "__main__":
    cfg = load_config()
    out = ReviewScraper(cfg).scrape()
    print(f"Saved {out['count']} total reviews -> {out['path']}")
