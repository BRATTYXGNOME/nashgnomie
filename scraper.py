"""
Scrapes Nash's reviews from fan.reviews.

fan.reviews only shows relative dates ("4mo ago"), so we keep its text exactly
as shown and re-scrape regularly (see server.py) instead of storing it forever.
Reviews come back newest first.

Run directly to refresh the fallback snapshot in data/reviews.json:
    python scraper.py
"""
import html, json, os, re, time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin

import requests
import yaml
from bs4 import BeautifulSoup

# fan.reviews' grey "no avatar" placeholder. We drop it so the site shows its
# own pink initial instead.
EMPTY_AVATAR_HINT = "avatar-empty"


def clean(s: Optional[str]) -> Optional[str]:
    """fan.reviews sometimes double-encodes text (shows '&amp;' literally)."""
    return html.unescape(s).strip() if s else s


def load_config(path: str = "config.yaml") -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


class ReviewScraper:
    def __init__(self, cfg: Dict[str, Any]):
        self.cfg = cfg
        self.base_url = cfg["fan_reviews_url"].rstrip("/") + "/"
        self.sel = cfg["selectors"]
        self.max_pages = int(cfg["pagination"].get("max_pages", 20))
        self.sleep_s = cfg["request"].get("sleep_between_pages_ms", 700) / 1000.0
        self.timeout = cfg["request"].get("timeout", 20)
        self.json_path = cfg["storage"]["json_path"]
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": cfg["request"]["user_agent"]})

    # ---------- fetching ----------

    def _get(self, url: str) -> str:
        r = self.session.get(url, timeout=self.timeout)
        r.raise_for_status()
        return r.text

    def _page_url(self, n: int) -> str:
        return self.base_url if n == 1 else f"{self.base_url}comment-page-{n}/"

    def _last_page(self, soup: BeautifulSoup) -> int:
        nums = [1]
        for a in soup.select('a[href*="comment-page-"]'):
            m = re.search(r"comment-page-(\d+)", a["href"])
            if m:
                nums.append(int(m.group(1)))
        return min(max(nums), self.max_pages)

    # ---------- parsing ----------

    def _text(self, node, sel: str) -> Optional[str]:
        el = node.select_one(sel) if sel else None
        return el.get_text(" ", strip=True) if el else None

    def _rating(self, li) -> Optional[float]:
        txt = self._text(li, self.sel["rating_text"])
        if txt:
            try:
                return float(txt)
            except ValueError:
                pass
        stars = li.select(".star-rating .star.star-full")
        return float(len(stars)) if stars else None

    def _avatar(self, li) -> Optional[str]:
        img = li.select_one(self.sel["avatar"])
        src = img.get("src") if img else None
        if not src or EMPTY_AVATAR_HINT in src:
            return None
        return urljoin(self.base_url, src)

    # ---------- layout-independent fallbacks ----------
    # Used when a config.yaml selector stops matching. They rely on things
    # WordPress keeps the same across themes: reviews are <li id="comment-123">,
    # reviewer names link to /profile/, dates read "X ago", scores sit near "/10".

    TIME_RE = re.compile(r"\b(?:\d+\s*(?:s|sec|m|min|h|hr|d|w|wk|mo|y|yr)|\d+\s+(?:second|minute|hour|day|week|month|year)s?|an?\s+(?:minute|hour|day|week|month|year))\s+ago\b", re.I)

    def _fallback_username(self, li) -> Optional[str]:
        for a in li.select('a[href*="/profile/"]'):
            name = a.get_text(" ", strip=True)
            if name:
                return name
        img = li.select_one("img[alt]")
        return img["alt"].strip() if img and img["alt"].strip() else None

    def _fallback_time(self, li) -> Optional[str]:
        m = self.TIME_RE.search(li.get_text(" ", strip=True))
        return m.group(0) if m else None

    def _fallback_rating(self, li) -> Optional[float]:
        m = re.search(r"(\d+(?:\.\d+)?)\s*/\s*10\b", li.get_text(" ", strip=True))
        return float(m.group(1)) if m else None

    def _fallback_body(self, li):
        # The review is the longest paragraph in the card
        paras = [p for p in li.find_all("p") if p.get_text(strip=True)]
        return max(paras, key=lambda p: len(p.get_text(strip=True))) if paras else None

    def _parse_review(self, li, page_url: str) -> Optional[Dict[str, Any]]:
        username = self._text(li, self.sel["username"]) or self._fallback_username(li)
        body = li.select_one(self.sel["review_content"]) or self._fallback_body(li)
        if not username or not body:
            return None

        # Title: configured selector, else a bold line at the start of the review
        title_el = body.select_one(self.sel["review_title"])
        if not title_el:
            first = body.find(["strong", "b"])
            if first and body.get_text(strip=True).startswith(first.get_text(strip=True)):
                title_el = first
        title = clean(title_el.get_text(" ", strip=True)) if title_el else None
        if title_el:
            title_el.extract()
        text = clean(body.get_text("\n", strip=True))

        cid = li.get("id", "")
        m = re.search(r"(\d+)$", cid)
        return {
            "id": int(m.group(1)) if m else 0,
            "username": clean(username),
            "avatar_url": self._avatar(li),
            "rating": self._rating(li) or self._fallback_rating(li),
            "review_title": title,
            "review_text": text,
            "time_text": self._text(li, self.sel["time_text"]) or self._fallback_time(li),
            "permalink": f"{page_url}#{cid}" if cid else page_url,
        }

    def _review_items(self, soup):
        items = soup.select(self.sel["review_container"])
        if items:
            return items
        # Fallback: any top-level WordPress comment (skip replies nested inside another)
        return [li for li in soup.select('li[id^="comment-"]')
                if not li.find_parent("li", id=re.compile(r"^comment-"))]

    def expected_count(self, soup) -> Optional[int]:
        """fan.reviews' own review total, from the page's structured data."""
        m = re.search(r'"reviewCount"\s*:\s*"?(\d+)', str(soup))
        return int(m.group(1)) if m else None

    # ---------- public ----------

    def scrape(self) -> List[Dict[str, Any]]:
        """Fetch every page of reviews. Returns them newest first.
        After a run, self.expected holds fan.reviews' own total (or None)."""
        first = BeautifulSoup(self._get(self._page_url(1)), "html.parser")
        self.expected = self.expected_count(first)
        last = self._last_page(first)

        seen, reviews = set(), []
        n = 1
        while n <= self.max_pages:
            if n > 1:
                time.sleep(self.sleep_s)
                try:
                    soup = BeautifulSoup(self._get(self._page_url(n)), "html.parser")
                except requests.HTTPError:
                    break  # ran past the last page
            else:
                soup = first
            added = 0
            for li in self._review_items(soup):
                r = self._parse_review(li, self._page_url(n))
                if r and r["id"] not in seen:
                    seen.add(r["id"])
                    reviews.append(r)
                    added += 1
            # Stop after the last page we know of, unless we're still short of
            # fan.reviews' own total (e.g. the page links changed) and still finding new ones.
            short = self.expected is not None and len(reviews) < self.expected
            if n >= last and (not short or added == 0):
                break
            n += 1

        if not reviews:
            raise RuntimeError("Found 0 reviews - fan.reviews layout may have changed (check config.yaml selectors)")

        # Higher comment id = posted later on fan.reviews
        reviews.sort(key=lambda r: r["id"], reverse=True)
        return reviews

    def save_snapshot(self, reviews: List[Dict[str, Any]]) -> None:
        os.makedirs(os.path.dirname(self.json_path) or ".", exist_ok=True)
        data = {"scraped_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "reviews": reviews}
        with open(self.json_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")


if __name__ == "__main__":
    scraper = ReviewScraper(load_config())
    found = scraper.scrape()
    scraper.save_snapshot(found)
    print(f"Saved {len(found)} reviews -> {scraper.json_path}")
    for r in found[:5]:
        print(f"  {r['time_text']:>10}  {r['username']}")
