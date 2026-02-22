#!/usr/bin/env python3
"""
Export institutions and metadata to static JSON for the frontend.
Run after backfill.py or update.py.
"""
import json
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "publications.db"
DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def run_export():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)

    # institutions.json: JOIN institutions -> paper_institutions, GROUP BY institution
    cursor = conn.execute("""
        SELECT
            i.id,
            i.name,
            i.lat,
            i.lng,
            i.country_code,
            COUNT(pi.paper_id) AS paper_count
        FROM institutions i
        JOIN paper_institutions pi ON pi.institution_id = i.id
        GROUP BY i.id
        ORDER BY paper_count DESC
    """)
    rows = cursor.fetchall()
    institutions = [
        {
            "id": r[0],
            "name": r[1],
            "lat": r[2],
            "lng": r[3],
            "country_code": r[4] or "",
            "paper_count": r[5],
        }
        for r in rows
    ]

    with open(DATA_DIR / "institutions.json", "w") as f:
        json.dump(institutions, f, indent=2)

    # meta.json
    total_papers = conn.execute("SELECT COUNT(*) FROM papers").fetchone()[0]
    total_institutions = conn.execute("SELECT COUNT(*) FROM institutions").fetchone()[0]
    last_date = conn.execute("SELECT MAX(publication_date) FROM papers").fetchone()[0] or ""
    date_from = conn.execute("SELECT MIN(publication_date) FROM papers").fetchone()[0] or ""
    date_to = last_date

    # Distinct papers per country (papers with at least one institution in that country)
    papers_by_country = conn.execute("""
        SELECT i.country_code, COUNT(DISTINCT pi.paper_id) AS paper_count
        FROM paper_institutions pi
        JOIN institutions i ON pi.institution_id = i.id
        WHERE i.country_code IS NOT NULL AND i.country_code != ''
        GROUP BY i.country_code
        ORDER BY paper_count DESC
    """).fetchall()

    meta = {
        "last_updated": last_date[:10] if last_date else "",
        "total_papers": total_papers,
        "total_institutions": total_institutions,
        "date_range": {"from": date_from[:10] if date_from else "", "to": date_to[:10] if date_to else ""},
        "papers_by_country": [{"country_code": r[0], "paper_count": r[1]} for r in papers_by_country],
    }
    with open(DATA_DIR / "meta.json", "w") as f:
        json.dump(meta, f, indent=2)

    conn.close()
    print(f"Exported {len(institutions)} institutions and meta to {DATA_DIR}")


if __name__ == "__main__":
    run_export()
