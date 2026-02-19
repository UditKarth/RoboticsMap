#!/usr/bin/env python3
"""
Historical backfill: fetch robotics papers from OpenAlex (2018-01-01 to 2026-01-01)
and populate the database. Runs export when done.
"""
import json
import sqlite3
import time
from pathlib import Path

import requests

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "publications.db"
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
OPENALEX_URL = "https://api.openalex.org/works"
MAILTO = "your@email.com"
CONCEPT_ID = "C18903297"
FROM_DATE = "2018-01-01"
TO_DATE = "2026-01-01"
PER_PAGE = 200


def create_schema(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS papers (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            publication_date TEXT,
            doi TEXT,
            openalex_url TEXT
        );
        CREATE TABLE IF NOT EXISTS institutions (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            lat REAL NOT NULL,
            lng REAL NOT NULL,
            country_code TEXT
        );
        CREATE TABLE IF NOT EXISTS paper_institutions (
            paper_id TEXT,
            institution_id TEXT,
            PRIMARY KEY (paper_id, institution_id),
            FOREIGN KEY (paper_id) REFERENCES papers(id),
            FOREIGN KEY (institution_id) REFERENCES institutions(id)
        );
        CREATE INDEX IF NOT EXISTS idx_papers_date ON papers(publication_date);
        CREATE INDEX IF NOT EXISTS idx_pi_institution ON paper_institutions(institution_id);
    """)
    conn.commit()


def fetch_page(cursor=None):
    params = {
        "filter": f"concepts.id:{CONCEPT_ID},from_publication_date:{FROM_DATE},to_publication_date:{TO_DATE}",
        "per_page": PER_PAGE,
        "mailto": MAILTO,
    }
    if cursor:
        params["cursor"] = cursor
    r = requests.get(OPENALEX_URL, params=params, timeout=60)
    r.raise_for_status()
    return r.json()


def run():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    create_schema(conn)

    total_fetched = 0
    total_skipped_geo = 0
    start = time.time()
    cursor = None

    while True:
        data = fetch_page(cursor)
        results = data.get("results", [])
        next_cursor = data.get("meta", {}).get("next_cursor")

        for work in results:
            work_id = work.get("id", "").replace("https://openalex.org/", "")
            if not work_id:
                continue
            title = work.get("display_name") or ""
            pub_date = (work.get("publication_date") or "")[:10]
            doi = (work.get("doi") or "").replace("https://doi.org/", "")
            openalex_url = work.get("id") or ""

            conn.execute(
                "INSERT OR IGNORE INTO papers (id, title, publication_date, doi, openalex_url) VALUES (?, ?, ?, ?, ?)",
                (work_id, title, pub_date, doi, openalex_url),
            )

            authorships = work.get("authorships") or []
            seen_inst = set()
            for a in authorships:
                for inst in a.get("institutions") or []:
                    if not inst:
                        continue
                    geo = inst.get("geo") or {}
                    lat, lng = geo.get("latitude"), geo.get("longitude")
                    if lat is None or lng is None:
                        total_skipped_geo += 1
                        continue
                    inst_id = (inst.get("id") or "").replace("https://openalex.org/", "")
                    name = inst.get("display_name") or ""
                    country = (inst.get("country_code") or "") or None
                    if inst_id and name:
                        conn.execute(
                            "INSERT OR IGNORE INTO institutions (id, name, lat, lng, country_code) VALUES (?, ?, ?, ?, ?)",
                            (inst_id, name, float(lat), float(lng), country),
                        )
                        key = (work_id, inst_id)
                        if key not in seen_inst:
                            seen_inst.add(key)
                            conn.execute(
                                "INSERT OR IGNORE INTO paper_institutions (paper_id, institution_id) VALUES (?, ?)",
                                (work_id, inst_id),
                            )

            total_fetched += 1

        if total_fetched % 1000 == 0 and total_fetched > 0:
            conn.commit()
            elapsed = time.time() - start
            print(f"Fetched {total_fetched} papers, skipped (no geo) {total_skipped_geo}, elapsed {elapsed:.1f}s")

        if not next_cursor:
            break
        cursor = next_cursor

    conn.commit()
    conn.close()
    elapsed = time.time() - start
    print(f"Done. Total papers {total_fetched}, skipped geo {total_skipped_geo}, elapsed {elapsed:.1f}s")

    import subprocess
    import sys
    subprocess.run(
        [sys.executable, str(Path(__file__).resolve().parent / "export.py")],
        check=True,
        cwd=str(Path(__file__).resolve().parent.parent),
    )


if __name__ == "__main__":
    run()
