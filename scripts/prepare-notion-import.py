#!/usr/bin/env python3
"""
prepare-notion-import.py — transform the Notion CSV export into a clean
JSON manifest + a staging directory of photos ready to ship to evergreen.

Reads:
  Private & Shared 2/เบิกเงิน/รายการเบิกเงิน 1acda95a2f8280f0bae9c42f69a67b66_all.csv
  Private & Shared 2/เบิกเงิน/<photo>.jpg

Writes:
  out/import.json — one record per top-level Notion row (parents + flat;
                    skips child rows since they're collapsed into items[])
  out/photos/<id>.jpg — copies of the photos referenced by import.json,
                        renamed by stable record id for the runner script

Each record:
  { id, title, category, property, quantity, amount, date,
    items: [str, ...], photoFile: "<id>.jpg" | null }

Run from repo root:
  python3 scripts/prepare-notion-import.py
"""

from __future__ import annotations

import csv
import hashlib
import json
import os
import re
import shutil
import sys
import urllib.parse
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
# Each Notion export lands in its own folder ("Private & Shared 2", "… 4", …),
# so the root is overridable instead of pinned to whichever one came first.
# Point EXPORT_ROOT at the 'เบิกเงิน' directory inside the export.
EXPORT_ROOT = Path(
    os.environ.get("EXPORT_ROOT", str(REPO_ROOT / "Private & Shared 2" / "เบิกเงิน"))
)
CSV_PATH = EXPORT_ROOT / "รายการเบิกเงิน 1acda95a2f8280f0bae9c42f69a67b66_all.csv"
OUT_DIR = REPO_ROOT / "out" / "notion-import"
OUT_PHOTOS = OUT_DIR / "photos"
OUT_JSON = OUT_DIR / "import.json"


def parse_amount(s: str) -> float:
    """'THB 411.00' -> 411.0"""
    s = s.replace("\xa0", " ").strip()
    m = re.search(r"(\d+(?:\.\d+)?)", s.replace(",", ""))
    return float(m.group(1)) if m else 0.0


def parse_date(s: str) -> str | None:
    """'04/03/2025' (DD/MM/YYYY) -> '2025-03-04'."""
    s = s.strip()
    if not s:
        return None
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", s)
    if not m:
        return None
    d, mo, y = m.groups()
    return f"{y}-{int(mo):02d}-{int(d):02d}"


def parse_quantity(s: str) -> int | None:
    s = s.strip()
    if not s:
        return None
    try:
        n = int(s)
        return n if n >= 0 else None
    except ValueError:
        return None


def parse_subitems(s: str) -> list[str]:
    """
    'ขนมปังแถว (./path), เนยแข็ง (./path)' → ['ขนมปังแถว', 'เนยแข็ง']
    Works because Notion's export wraps each linked sub-item label with a
    Markdown-style URL in parens. We strip the parens and the path.
    """
    if not s:
        return []
    parts = re.split(r",\s+", s)
    cleaned: list[str] = []
    for part in parts:
        # Drop trailing "(<path>)"
        label = re.sub(r"\s*\([^()]*\)\s*$", "", part).strip()
        if label:
            cleaned.append(label)
    return cleaned


def derive_property_and_category(category: str) -> tuple[str, str]:
    """
    Notion's category column conflates two dimensions: (1) the actual
    expense bucket (food, equipment, …) and (2) the property (Hf Hotel
    vs Hf Ville). Untangle them.
    """
    raw = (category or "").strip()
    # Heuristic: anything containing 'ville' (case/diacritic-tolerant) is the
    # Hf Ville pseudo-category. The real category for those rows is unknown.
    if "ville" in raw.lower() or "Hf ville" in raw:
        return ("hf-ville", "อื่น ๆ")
    return ("hf-hotel", raw or "อื่น ๆ")


def decode_photo_path(s: str) -> str | None:
    """
    The CSV has paths like
      'เบิกเงิน/<filename>.jpg' (URL-encoded).
    The actual file lives at EXPORT_ROOT/<filename>.jpg.
    """
    s = (s or "").strip()
    if not s:
        return None
    decoded = urllib.parse.unquote(s)
    # Strip leading folder ('เบิกเงิน/' or any prefix up to the last '/')
    name = decoded.rsplit("/", 1)[-1]
    return name if name.lower().endswith((".jpg", ".jpeg", ".png", ".heic", ".webp")) else None


def decode_photo_relpath(s: str) -> str | None:
    """Path to the image FILE, relative to EXPORT_ROOT.

    Separate from decode_photo_path because the two answer different questions
    and must not be merged: this one locates the file on disk, while
    decode_photo_path returns the bare filename that seeds stable_id. The
    filename is what Notion keeps constant between exports; the directory
    layout is not. The April export put images flat in 'เบิกเงิน/', the August
    one nests them under 'เบิกเงิน/รายการเบิกเงิน/<row>/'. Feeding the full
    path into stable_id would therefore re-hash every record and duplicate the
    entire archive on the next import.

    The CSV stores a URL-encoded path rooted at the export folder
    ('เบิกเงิน/…'), so the leading segment is dropped when it repeats
    EXPORT_ROOT's own name. Handles both layouts.
    """
    s = (s or "").strip()
    if not s:
        return None
    decoded = urllib.parse.unquote(s)
    if not decoded.lower().endswith((".jpg", ".jpeg", ".png", ".heic", ".webp", ".jfif")):
        return None
    parts = decoded.split("/")
    if parts and parts[0] == EXPORT_ROOT.name:
        parts = parts[1:]
    return "/".join(parts) if parts else None


def stable_id(title: str, amount: float, date: str | None, photo: str | None) -> str:
    """Deterministic id so re-runs are idempotent."""
    seed = f"{title}|{amount:.2f}|{date or ''}|{photo or ''}"
    return "imp_" + hashlib.sha1(seed.encode("utf-8")).hexdigest()[:16]


def main() -> int:
    if not CSV_PATH.exists():
        print(f"::error::CSV not found at {CSV_PATH}", file=sys.stderr)
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if OUT_PHOTOS.exists():
        shutil.rmtree(OUT_PHOTOS)
    OUT_PHOTOS.mkdir(parents=True)

    with CSV_PATH.open(encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

    records: list[dict] = []
    skipped_no_data = 0
    photo_missing = 0
    photo_copied = 0

    for row in rows:
        if row["Parent item"].strip():
            # Child row — collapsed into the parent's items[].
            continue

        title = row["รายการเบิก"].strip()
        if not title:
            skipped_no_data += 1
            continue

        amount = parse_amount(row["จำนวนเงินรวม"])
        date = parse_date(row["วันที่ในบิล"]) or parse_date(row["วันที่ขอเบิก"])
        if not date:
            # Fall back to a far-past date so it sorts last.
            date = "2025-01-01"

        prop, category = derive_property_and_category(row["หมวดหมู่การเบิก"])
        quantity = parse_quantity(row["จำนวนชิ้น"])
        sub_items = parse_subitems(row["Sub-item"])

        # Filename seeds the id (stable across exports); relpath finds the file.
        photo_filename = decode_photo_path(row["รูปบิล"])
        photo_relpath = decode_photo_relpath(row["รูปบิล"])
        photo_out_name: str | None = None
        if photo_filename and photo_relpath:
            src = EXPORT_ROOT / photo_relpath
            if src.exists():
                # New name: derived from record id so it's stable + safe.
                rec_id = stable_id(title, amount, date, photo_filename)
                ext = src.suffix.lower() or ".jpg"
                photo_out_name = f"{rec_id}{ext}"
                shutil.copyfile(src, OUT_PHOTOS / photo_out_name)
                photo_copied += 1
            else:
                photo_missing += 1

        rec_id = stable_id(title, amount, date, photo_filename or "")
        records.append({
            "id": rec_id,
            "title": title,
            "category": category,
            "property": prop,
            "quantity": quantity,
            "amount": round(amount, 2),
            "date": date,
            "items": sub_items,
            "photoFile": photo_out_name,
        })

    OUT_JSON.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")

    bundle_size = sum(p.stat().st_size for p in OUT_PHOTOS.iterdir() if p.is_file())
    print(f"records:        {len(records)}")
    print(f"photos copied:  {photo_copied}")
    print(f"photos missing: {photo_missing}")
    print(f"skipped (empty title): {skipped_no_data}")
    print(f"output:         {OUT_DIR}")
    print(f"photos size:    {bundle_size / 1024 / 1024:.1f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
