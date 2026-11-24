from pathlib import Path
import sqlite3

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "your_database_file.db"  # use the same path your app already uses

with sqlite3.connect(DB_PATH) as conn:
    conn.executescript((BASE_DIR / "schema.sql").read_text())
