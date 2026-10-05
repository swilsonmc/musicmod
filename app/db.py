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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stems (
    id INT AUTO_INCREMENT PRIMARY KEY,
    upload_id INT NOT NULL,
    stem_name VARCHAR(20) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    FOREIGN KEY (upload_id) REFERENCES uploads(id)
);
"""


def get_connection():
    return pymysql.connect(
        host=config.MYSQL_HOST,
        user=config.MYSQL_USER,
        password=config.MYSQL_PASSWORD,
        database=config.MYSQL_DATABASE,
        cursorclass=DictCursor,
        autocommit=True,
    )


def init_schema() -> None:
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            for statement in SCHEMA.strip().split(";"):
                if statement.strip():
                    cur.execute(statement)
    finally:
        conn.close()
