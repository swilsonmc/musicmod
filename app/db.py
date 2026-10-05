import pymysql
from pymysql.cursors import DictCursor

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS uploads (
    id INT AUTO_INCREMENT PRIMARY KEY,
    original_filename VARCHAR(255) NOT NULL,
    stored_dir VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    error TEXT NULL,
    file_size_bytes BIGINT NULL,
    progress VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP NULL,
    finished_at TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS stems (
    id INT AUTO_INCREMENT PRIMARY KEY,
    upload_id INT NOT NULL,
    stem_name VARCHAR(20) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    FOREIGN KEY (upload_id) REFERENCES uploads(id)
);

CREATE TABLE IF NOT EXISTS midi_tracks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    upload_id INT NOT NULL,
    stem_name VARCHAR(20) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    method VARCHAR(20) NOT NULL,
    note_count INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY one_per_stem (upload_id, stem_name),
    FOREIGN KEY (upload_id) REFERENCES uploads(id)
);
"""

# This MySQL version (8.0.46) rejects `ADD COLUMN IF NOT EXISTS` as a syntax
# error outright, so columns added after the table already existed on this
# machine are applied by catching "duplicate column" (1060) instead.
ADD_COLUMNS = [
    "ALTER TABLE uploads ADD COLUMN file_size_bytes BIGINT NULL",
    "ALTER TABLE uploads ADD COLUMN progress VARCHAR(255) NULL",
    "ALTER TABLE uploads ADD COLUMN started_at TIMESTAMP NULL",
    "ALTER TABLE uploads ADD COLUMN finished_at TIMESTAMP NULL",
    "ALTER TABLE uploads ADD COLUMN transcribe_status VARCHAR(20) NULL",
    "ALTER TABLE uploads ADD COLUMN transcribe_progress VARCHAR(255) NULL",
    "ALTER TABLE uploads ADD COLUMN transcribe_error TEXT NULL",
    "ALTER TABLE uploads ADD COLUMN transcribe_started_at TIMESTAMP NULL",
    "ALTER TABLE uploads ADD COLUMN transcribe_finished_at TIMESTAMP NULL",
]
DUPLICATE_COLUMN_ERRNO = 1060


def get_connection():
    return pymysql.connect(
        host=config.MYSQL_HOST,
        user=config.MYSQL_USER,
        password=config.MYSQL_PASSWORD,
        database=config.MYSQL_DATABASE,
        cursorclass=DictCursor,
        autocommit=True,
    )


def execute(sql: str, params: tuple = ()) -> None:
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
    finally:
        conn.close()


def fetch_all(sql: str, params: tuple = ()) -> list[dict]:
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()
    finally:
        conn.close()


def fetch_one(sql: str, params: tuple = ()) -> dict | None:
    rows = fetch_all(sql, params)
    return rows[0] if rows else None


def init_schema() -> None:
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            for statement in SCHEMA.strip().split(";"):
                if statement.strip():
                    cur.execute(statement)
            for statement in ADD_COLUMNS:
                try:
                    cur.execute(statement)
                except pymysql.err.OperationalError as exc:
                    if exc.args[0] != DUPLICATE_COLUMN_ERRNO:
                        raise
    finally:
        conn.close()
