from __future__ import annotations

import argparse
import html
import json
import mimetypes
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import time
from dataclasses import dataclass
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, unquote, urlparse
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
MANUALS_DIR = ROOT / "manuals"
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "index.sqlite"
CHUNK_WORDS = 230
CHUNK_OVERLAP = 45
DEFAULT_LLM_TIMEOUT = 120
SEARCH_CANDIDATE_LIMIT = 40
ANSWER_CONTEXT_LIMIT = 24
LLM_CONTEXT_LIMIT = 8
LLM_CHUNK_CHAR_LIMIT = 850
DEBUG_MODE = False
INDEX_CHECK_INTERVAL = 120
LAST_INCREMENTAL_INDEX_AT = 0.0
SQLITE_FTS5_SUPPORTED: bool | None = None


QUERY_STOP_WORDS = {
    "a",
    "an",
    "and",
    "are",
    "for",
    "how",
    "is",
    "of",
    "the",
    "to",
    "what",
    "what's",
    "why",
}

CONCEPT_HINTS = {
    "architecture",
    "basic",
    "concept",
    "concepts",
    "definition",
    "flow",
    "flows",
    "getting started",
    "guide",
    "high-level",
    "introduction",
    "manual",
    "overview",
    "procedure",
    "process",
    "quick start",
    "tutorial",
    "use model",
    "user manual",
    "workflow",
}


USAGE_HINTS = {
    "argument",
    "arguments",
    "example",
    "examples",
    "keyword",
    "keywords",
    "option",
    "options",
    "parameter",
    "parameters",
    "procedure",
    "syntax",
    "usage",
}

LOW_VALUE_CONTEXT_HINTS = {
    "................................................................",
    "table of contents",
    "index",
    "command reference",
}


@dataclass
class SearchHit:
    chunk_id: int
    chunk_index: int
    tool: str
    title: str
    source_path: str
    page: str
    text: str
    score: float


@dataclass
class AppConfig:
    llm_base_url: str
    llm_api_key: str
    llm_model: str
    llm_timeout: int
    llm_enabled: bool


def load_env_file(path: Path, override: bool = False) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and (override or key not in os.environ):
            os.environ[key] = value


def load_config() -> AppConfig:
    load_env_file(ROOT / ".env", override=True)
    llm_base_url = os.getenv("LLM_BASE_URL", "").strip().rstrip("/")
    llm_api_key = os.getenv("LLM_API_KEY", "").strip()
    llm_model = os.getenv("LLM_MODEL", "internal-llm").strip()
    llm_timeout = int(os.getenv("LLM_TIMEOUT", str(DEFAULT_LLM_TIMEOUT)))
    return AppConfig(
        llm_base_url=llm_base_url,
        llm_api_key=llm_api_key,
        llm_model=llm_model,
        llm_timeout=llm_timeout,
        llm_enabled=bool(llm_base_url and llm_api_key and llm_model),
    )


CONFIG = load_config()


SETTINGS_KEYS = ("LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL", "LLM_TIMEOUT")


def parse_env_values(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key in SETTINGS_KEYS:
            values[key] = value.strip().strip('"').strip("'")
    return values


def env_line(key: str, value: str) -> str:
    value = str(value).replace("\n", "").replace("\r", "").strip()
    if not value:
        return f"{key}="
    if any(char.isspace() for char in value) or "#" in value:
        return f"{key}={json.dumps(value, ensure_ascii=False)}"
    return f"{key}={value}"


def write_env_values(updates: dict[str, str]) -> None:
    env_path = ROOT / ".env"
    current = parse_env_values(env_path)
    merged = dict(current)

    for key in ("LLM_BASE_URL", "LLM_MODEL", "LLM_TIMEOUT"):
        if key in updates:
            merged[key] = updates[key]
    if updates.get("LLM_API_KEY"):
        merged["LLM_API_KEY"] = updates["LLM_API_KEY"]

    existing_lines = env_path.read_text(encoding="utf-8").splitlines() if env_path.exists() else []
    seen: set[str] = set()
    output: list[str] = []
    for raw_line in existing_lines:
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            output.append(raw_line)
            continue
        key = stripped.split("=", 1)[0].strip()
        if key in SETTINGS_KEYS:
            output.append(env_line(key, merged.get(key, "")))
            seen.add(key)
        else:
            output.append(raw_line)

    if output and output[-1].strip():
        output.append("")
    for key in SETTINGS_KEYS:
        if key not in seen:
            output.append(env_line(key, merged.get(key, "")))

    env_path.write_text("\n".join(output).rstrip() + "\n", encoding="utf-8")

    for key in SETTINGS_KEYS:
        os.environ[key] = merged.get(key, "")


def reload_config() -> None:
    global CONFIG
    CONFIG = load_config()


def masked_api_key(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "*" * len(value)
    return "*" * max(8, len(value) - 4) + value[-4:]


def settings_payload() -> dict[str, Any]:
    return {
        "llm_base_url": CONFIG.llm_base_url,
        "llm_model": CONFIG.llm_model,
        "llm_timeout": CONFIG.llm_timeout,
        "llm_enabled": CONFIG.llm_enabled,
        "api_key_configured": bool(CONFIG.llm_api_key),
        "api_key_mask": masked_api_key(CONFIG.llm_api_key),
    }


def save_settings(payload: dict[str, Any]) -> dict[str, Any]:
    timeout_value = str(payload.get("llm_timeout", DEFAULT_LLM_TIMEOUT)).strip() or str(DEFAULT_LLM_TIMEOUT)
    try:
        timeout = int(timeout_value)
    except ValueError as exc:
        raise ValueError("LLM_TIMEOUT must be an integer") from exc
    if timeout < 5 or timeout > 600:
        raise ValueError("LLM_TIMEOUT must be between 5 and 600 seconds")

    updates = {
        "LLM_BASE_URL": str(payload.get("llm_base_url", "")).strip().rstrip("/"),
        "LLM_MODEL": str(payload.get("llm_model", "")).strip() or "internal-llm",
        "LLM_TIMEOUT": str(timeout),
    }
    api_key = str(payload.get("llm_api_key", "")).strip()
    if api_key:
        updates["LLM_API_KEY"] = api_key

    write_env_values(updates)
    reload_config()
    return settings_payload()


def config_from_payload(payload: Any = None) -> AppConfig:
    if not isinstance(payload, dict):
        return CONFIG

    llm_base_url = str(payload.get("llm_base_url", CONFIG.llm_base_url)).strip().rstrip("/")
    llm_api_key = str(payload.get("llm_api_key", CONFIG.llm_api_key)).strip()
    llm_model = str(payload.get("llm_model", CONFIG.llm_model)).strip() or "internal-llm"
    timeout_value = str(payload.get("llm_timeout", CONFIG.llm_timeout)).strip() or str(DEFAULT_LLM_TIMEOUT)
    try:
        llm_timeout = int(timeout_value)
    except ValueError:
        llm_timeout = DEFAULT_LLM_TIMEOUT
    llm_timeout = min(max(llm_timeout, 5), 600)

    return AppConfig(
        llm_base_url=llm_base_url,
        llm_api_key=llm_api_key,
        llm_model=llm_model,
        llm_timeout=llm_timeout,
        llm_enabled=bool(llm_base_url and llm_api_key and llm_model),
    )



def app_version() -> str:
    version_file = ROOT / "VERSION"
    if not version_file.exists():
        return "unknown"
    return version_file.read_text(encoding="utf-8").strip() or "unknown"


def ensure_dirs() -> None:
    STATIC_DIR.mkdir(exist_ok=True)
    MANUALS_DIR.mkdir(exist_ok=True)
    DATA_DIR.mkdir(exist_ok=True)


def sqlite_supports_fts5() -> bool:
    global SQLITE_FTS5_SUPPORTED
    if SQLITE_FTS5_SUPPORTED is not None:
        return SQLITE_FTS5_SUPPORTED
    if os.environ.get("EDA_FORCE_SQLITE_LEGACY") == "1":
        SQLITE_FTS5_SUPPORTED = False
        return False

    conn = sqlite3.connect(":memory:")
    try:
        conn.execute("CREATE VIRTUAL TABLE fts5_probe USING fts5(text)")
        SQLITE_FTS5_SUPPORTED = True
    except sqlite3.Error:
        SQLITE_FTS5_SUPPORTED = False
    finally:
        conn.close()
    return SQLITE_FTS5_SUPPORTED


def search_backend_name() -> str:
    return "fts5" if sqlite_supports_fts5() else "sqlite-like"


def should_rebuild_database(exc: sqlite3.DatabaseError) -> bool:
    message = str(exc).lower()
    return "malformed database schema" in message or "no such module: fts" in message or ("chunks_fts" in message and "no such module" in message)


def quarantine_database(exc: sqlite3.DatabaseError) -> None:
    if not DB_PATH.exists():
        raise exc
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    for suffix in ("", "-wal", "-shm"):
        path = Path(f"{DB_PATH}{suffix}")
        if path.exists():
            target = path.with_name(f"{path.name}.incompatible-{timestamp}")
            path.replace(target)
    print(
        f"Warning: existing SQLite index is incompatible with this SQLite runtime and was moved aside: {exc}",
        file=sys.stderr,
    )


def initialize_schema(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS documents (
            id INTEGER PRIMARY KEY,
            tool TEXT NOT NULL,
            title TEXT NOT NULL,
            source_path TEXT NOT NULL UNIQUE,
            file_mtime REAL NOT NULL,
            indexed_at REAL NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS chunks (
            id INTEGER PRIMARY KEY,
            document_id INTEGER NOT NULL,
            chunk_index INTEGER NOT NULL,
            page TEXT NOT NULL,
            text TEXT NOT NULL,
            FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks(document_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_chunks_chunk_index ON chunks(document_id, chunk_index)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_documents_source_path ON documents(source_path)")

    if sqlite_supports_fts5():
        fts_schema = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'chunks_fts'"
        ).fetchone()
        if fts_schema and "content='chunks'" in (fts_schema["sql"] or ""):
            conn.execute("DROP TABLE chunks_fts")
        conn.execute(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts
            USING fts5(text, tool, title, page, source_path)
            """
        )
        ensure_fts_populated(conn)


def ensure_fts_populated(conn: sqlite3.Connection) -> None:
    if not sqlite_supports_fts5():
        return
    missing = conn.execute(
        """
        SELECT COUNT(*) AS count
        FROM chunks c
        LEFT JOIN chunks_fts f ON f.rowid = c.id
        WHERE f.rowid IS NULL
        """
    ).fetchone()
    if not missing or int(missing["count"]) == 0:
        return
    conn.execute(
        """
        INSERT INTO chunks_fts(rowid, text, tool, title, page, source_path)
        SELECT c.id, c.text, d.tool, d.title, c.page, d.source_path
        FROM chunks c
        JOIN documents d ON d.id = c.document_id
        WHERE NOT EXISTS (SELECT 1 FROM chunks_fts f WHERE f.rowid = c.id)
        """
    )


def connect() -> sqlite3.Connection:
    ensure_dirs()
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        initialize_schema(conn)
        return conn
    except sqlite3.DatabaseError as exc:
        try:
            conn.close()
        except Exception:
            pass
        if not should_rebuild_database(exc):
            raise
        quarantine_database(exc)
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        initialize_schema(conn)
        return conn


def delete_search_entries(conn: sqlite3.Connection, document_id: int) -> None:
    if sqlite_supports_fts5():
        conn.execute("DELETE FROM chunks_fts WHERE rowid IN (SELECT id FROM chunks WHERE document_id = ?)", (document_id,))


def clear_search_index(conn: sqlite3.Connection) -> None:
    if sqlite_supports_fts5():
        conn.execute("DELETE FROM chunks_fts")


def insert_search_entry(
    conn: sqlite3.Connection,
    chunk_id: int,
    chunk: str,
    tool: str,
    title: str,
    page: str,
    source_path: str,
) -> None:
    if sqlite_supports_fts5():
        conn.execute(
            "INSERT INTO chunks_fts(rowid, text, tool, title, page, source_path) VALUES (?, ?, ?, ?, ?, ?)",
            (chunk_id, chunk, tool, title, page, source_path),
        )


def normalize_tool_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_. -]+", "_", value.strip())
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .")
    return cleaned or "General"


def html_to_text(raw: str) -> str:
    raw = re.sub(r"(?is)<(script|style).*?>.*?</\\1>", " ", raw)
    raw = re.sub(r"(?s)<[^>]+>", " ", raw)
    return html.unescape(raw)


def clean_text(raw: str) -> str:
    raw = raw.replace("\x00", " ")
    raw = re.sub(r"[ \t]+", " ", raw)
    raw = re.sub(r"\n{3,}", "\n\n", raw)
    return raw.strip()


def pdf_pages_have_text(pages: list[tuple[str, str]]) -> bool:
    return any(len(text.strip()) >= 40 for _, text in pages)


def read_pdf_with_pypdf(path: Path) -> list[tuple[str, str]]:
    from pypdf import PdfReader  # type: ignore

    reader = PdfReader(str(path))
    pages: list[tuple[str, str]] = []
    for index, page in enumerate(reader.pages, start=1):
        pages.append((str(index), clean_text(page.extract_text() or "")))
    return pages


def read_pdf_with_pdftotext(path: Path) -> list[tuple[str, str]]:
    if not shutil.which("pdftotext"):
        return []
    try:
        result = subprocess.run(
            ["pdftotext", "-layout", str(path), "-"],
            check=True,
            capture_output=True,
            text=True,
            timeout=120,
        )
    except Exception:
        return []

    pages: list[tuple[str, str]] = []
    for index, raw_page in enumerate(result.stdout.split("\f"), start=1):
        text = clean_text(raw_page)
        if text:
            pages.append((str(index), text))
    return pages


def read_pdf(path: Path) -> list[tuple[str, str]]:
    try:
        pages = read_pdf_with_pypdf(path)
        if pdf_pages_have_text(pages):
            return pages
    except Exception:
        pass

    return read_pdf_with_pdftotext(path)


def read_document(path: Path) -> list[tuple[str, str]]:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return read_pdf(path)

    try:
        raw = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        raw = path.read_text(encoding="latin-1", errors="ignore")

    if suffix in {".html", ".htm"}:
        raw = html_to_text(raw)
    return [("", clean_text(raw))]


def split_into_chunks(text: str) -> list[str]:
    words = re.findall(r"\S+", text)
    if not words:
        return []
    chunks: list[str] = []
    step = max(1, CHUNK_WORDS - CHUNK_OVERLAP)
    for start in range(0, len(words), step):
        piece = words[start : start + CHUNK_WORDS]
        if len(piece) < 20 and chunks:
            chunks[-1] = f"{chunks[-1]} {' '.join(piece)}"
        else:
            chunks.append(" ".join(piece))
        if start + CHUNK_WORDS >= len(words):
            break
    return chunks


def supported_files() -> list[Path]:
    extensions = {".txt", ".md", ".markdown", ".html", ".htm", ".pdf"}
    return sorted(p for p in MANUALS_DIR.rglob("*") if p.is_file() and p.suffix.lower() in extensions)


def relative_source(path: Path) -> str:
    return str(path.relative_to(ROOT))


def infer_tool(path: Path) -> str:
    try:
        rel = path.relative_to(MANUALS_DIR)
        return normalize_tool_name(rel.parts[0]) if len(rel.parts) > 1 else "General"
    except ValueError:
        return "General"


def index_file(conn: sqlite3.Connection, path: Path) -> int:
    source_path = relative_source(path)
    tool = infer_tool(path)
    title = path.stem.replace("_", " ").replace("-", " ").strip() or path.name
    file_mtime = path.stat().st_mtime

    existing = conn.execute(
        "SELECT id, file_mtime FROM documents WHERE source_path = ?", (source_path,)
    ).fetchone()
    if existing and abs(existing["file_mtime"] - file_mtime) < 0.0001:
        return 0

    if existing:
        document_id = int(existing["id"])
        delete_search_entries(conn, document_id)
        conn.execute("DELETE FROM chunks WHERE document_id = ?", (document_id,))
        conn.execute(
            "UPDATE documents SET tool = ?, title = ?, file_mtime = ?, indexed_at = ? WHERE id = ?",
            (tool, title, file_mtime, time.time(), document_id),
        )
    else:
        cursor = conn.execute(
            "INSERT INTO documents(tool, title, source_path, file_mtime, indexed_at) VALUES (?, ?, ?, ?, ?)",
            (tool, title, source_path, file_mtime, time.time()),
        )
        document_id = int(cursor.lastrowid)

    inserted = 0
    for page, text in read_document(path):
        for chunk in split_into_chunks(text):
            cursor = conn.execute(
                "INSERT INTO chunks(document_id, chunk_index, page, text) VALUES (?, ?, ?, ?)",
                (document_id, inserted, page, chunk),
            )
            chunk_id = int(cursor.lastrowid)
            insert_search_entry(conn, chunk_id, chunk, tool, title, page, source_path)
            inserted += 1
    return inserted


def reindex_all() -> dict[str, int]:
    ensure_dirs()
    conn = connect()
    clear_search_index(conn)
    conn.execute("DELETE FROM chunks")
    conn.execute("DELETE FROM documents")
    indexed_files = 0
    indexed_chunks = 0
    for path in supported_files():
        chunks = index_file(conn, path)
        indexed_files += 1
        indexed_chunks += chunks
    conn.commit()
    conn.close()
    global LAST_INCREMENTAL_INDEX_AT
    LAST_INCREMENTAL_INDEX_AT = time.time()
    return {"files": indexed_files, "chunks": indexed_chunks}


def incremental_index() -> dict[str, int]:
    conn = connect()
    indexed_files = 0
    indexed_chunks = 0
    current_sources = {relative_source(path) for path in supported_files()}
    for row in conn.execute("SELECT id, source_path FROM documents").fetchall():
        if row["source_path"] not in current_sources:
            delete_search_entries(conn, int(row["id"]))
            conn.execute("DELETE FROM chunks WHERE document_id = ?", (row["id"],))
            conn.execute("DELETE FROM documents WHERE id = ?", (row["id"],))
    for path in supported_files():
        chunks = index_file(conn, path)
        if chunks:
            indexed_files += 1
            indexed_chunks += chunks
    conn.commit()
    conn.close()
    global LAST_INCREMENTAL_INDEX_AT
    LAST_INCREMENTAL_INDEX_AT = time.time()
    return {"files": indexed_files, "chunks": indexed_chunks}


def maybe_incremental_index(force: bool = False) -> dict[str, Any]:
    global LAST_INCREMENTAL_INDEX_AT
    now = time.time()
    if force or now - LAST_INCREMENTAL_INDEX_AT >= INDEX_CHECK_INTERVAL:
        result = incremental_index()
        LAST_INCREMENTAL_INDEX_AT = now
        return result
    return {"files": 0, "chunks": 0, "skipped": True}


def query_terms(query: str) -> list[str]:
    latin_terms = re.findall(r"(?=[A-Za-z0-9_.:-]*[A-Za-z])[A-Za-z0-9][A-Za-z0-9_.:-]*", query)
    if latin_terms:
        terms = latin_terms
    else:
        terms = re.findall(r"[\w.-]+", query)
    cleaned = []
    seen = set()
    for term in terms:
        value = term.strip(" .,:;!?，。！？、()[]{}<>").lower()
        if len(value) < 2 or value in QUERY_STOP_WORDS or value in seen:
            continue
        seen.add(value)
        cleaned.append(value)
    return cleaned


def is_concept_question(query: str) -> bool:
    lower = query.lower()
    if any(marker in query for marker in ("什么是", "是什么", "介绍", "概念", "流程", "怎么理解", "用途")):
        return True
    return any(marker in lower for marker in ("what is", "what are", "overview", "introduction", "concept", "flow"))


def is_usage_question(query: str) -> bool:
    lower = query.lower()
    if any(marker in query for marker in ("用法", "怎么用", "如何使用", "参数", "选项", "示例", "例子", "语法", "命令")):
        return True
    return any(marker in lower for marker in ("usage", "how to use", "option", "options", "argument", "arguments", "parameter", "syntax", "example", "examples", "command"))


def fts_query(query: str) -> str:
    terms = query_terms(query)
    if not terms:
        return query
    return " OR ".join(f'"{term}"' for term in terms[:12])


def rows_to_hits(rows: list[sqlite3.Row]) -> list[SearchHit]:
    return [
        SearchHit(
            chunk_id=int(row["chunk_id"]),
            chunk_index=int(row["chunk_index"]),
            tool=row["tool"],
            title=row["title"],
            source_path=row["source_path"],
            page=row["page"],
            text=row["text"],
            score=float(row["score"]),
        )
        for row in rows
    ]


def legacy_match_score(hit: SearchHit, terms: list[str]) -> float:
    haystack = f"{hit.tool} {hit.title} {hit.source_path} {hit.text}".lower()
    title_path = f"{hit.title} {hit.source_path}".lower()
    score = 0.0
    for term in terms:
        score += min(haystack.count(term), 12)
        if term in title_path:
            score += 8.0
        if term in hit.text[:500].lower():
            score += 4.0
    return score


def search_legacy(query: str, limit: int = 8) -> list[SearchHit]:
    terms = query_terms(query)
    if not terms:
        return []

    clauses = []
    params: list[Any] = []
    for term in terms[:8]:
        pattern = f"%{term}%"
        clauses.append("(lower(c.text) LIKE ? OR lower(d.title) LIKE ? OR lower(d.source_path) LIKE ? OR lower(d.tool) LIKE ?)")
        params.extend([pattern, pattern, pattern, pattern])

    conn = connect()
    try:
        rows = conn.execute(
            f"""
            SELECT
                c.id AS chunk_id,
                c.chunk_index,
                d.tool,
                d.title,
                d.source_path,
                c.page,
                c.text,
                0.0 AS score
            FROM chunks c
            JOIN documents d ON d.id = c.document_id
            WHERE {' OR '.join(clauses)}
            LIMIT ?
            """,
            (*params, max(limit * 12, 240)),
        ).fetchall()
    finally:
        conn.close()

    hits = rows_to_hits(rows)
    for hit in hits:
        hit.score = -legacy_match_score(hit, terms)
    return sorted(hits, key=lambda hit: hit.score)[:limit]


def search(query: str, limit: int = 8) -> list[SearchHit]:
    if not sqlite_supports_fts5():
        return search_legacy(query, limit)

    conn = connect()
    try:
        rows = conn.execute(
            """
            SELECT
                c.id AS chunk_id,
                c.chunk_index,
                d.tool,
                d.title,
                d.source_path,
                c.page,
                c.text,
                bm25(chunks_fts) AS score
            FROM chunks_fts
            JOIN chunks c ON c.id = chunks_fts.rowid
            JOIN documents d ON d.id = c.document_id
            WHERE chunks_fts MATCH ?
            ORDER BY score
            LIMIT ?
            """,
            (fts_query(query), limit),
        ).fetchall()
    except sqlite3.OperationalError:
        rows = []
    finally:
        conn.close()

    return rows_to_hits(rows)


def document_intro_hits(terms: list[str], limit: int = 12) -> list[SearchHit]:
    if not terms:
        return []

    clauses = []
    params: list[Any] = []
    for term in terms[:4]:
        pattern = f"%{term}%"
        clauses.append("(lower(d.title) LIKE ? OR lower(d.source_path) LIKE ?)")
        params.extend([pattern, pattern])

    conn = connect()
    try:
        rows = conn.execute(
            f"""
            SELECT
                c.id AS chunk_id,
                c.chunk_index,
                d.tool,
                d.title,
                d.source_path,
                c.page,
                c.text,
                0.0 AS score
            FROM documents d
            JOIN chunks c ON c.document_id = d.id
            WHERE ({' OR '.join(clauses)})
              AND c.chunk_index <= 5
            ORDER BY
                CASE WHEN lower(d.source_path) LIKE '%.pdf' THEN 0 ELSE 1 END,
                d.title,
                c.chunk_index
            LIMIT ?
            """,
            (*params, limit),
        ).fetchall()
    finally:
        conn.close()
    return rows_to_hits(rows)


def adjacent_chunk_hits(seed_hits: list[SearchHit], radius: int = 2, limit: int = 36) -> list[SearchHit]:
    if not seed_hits:
        return []

    hits: dict[int, SearchHit] = {}
    conn = connect()
    try:
        for seed in seed_hits[:12]:
            rows = conn.execute(
                """
                SELECT
                    c.id AS chunk_id,
                    c.chunk_index,
                    d.tool,
                    d.title,
                    d.source_path,
                    c.page,
                    c.text,
                    0.0 AS score
                FROM documents d
                JOIN chunks c ON c.document_id = d.id
                WHERE d.source_path = ?
                  AND c.chunk_index BETWEEN ? AND ?
                ORDER BY c.chunk_index
                """,
                (seed.source_path, max(0, seed.chunk_index - radius), seed.chunk_index + radius),
            ).fetchall()
            for hit in rows_to_hits(rows):
                hits.setdefault(hit.chunk_id, hit)
                if len(hits) >= limit:
                    return list(hits.values())
    finally:
        conn.close()
    return list(hits.values())


def hit_rank(query: str, hit: SearchHit, terms: list[str], concept_question: bool, usage_question: bool) -> float:
    haystack = f"{hit.tool} {hit.title} {hit.source_path} {hit.text}".lower()
    title_path = f"{hit.title} {hit.source_path}".lower()
    text_start = hit.text[:360].lower()
    score = 0.0

    for term in terms:
        score += min(haystack.count(term), 6) * 2.0
        if term in title_path:
            score += 16.0
        if term in text_start:
            score += 14.0
        if re.search(rf"\b{re.escape(term)}\b", hit.text.lower()):
            score += 4.0

    if concept_question:
        for hint in CONCEPT_HINTS:
            if hint in haystack:
                score += 2.5
            if hint in text_start:
                score += 5.0
        if hit.chunk_index <= 5:
            score += max(0, 6 - hit.chunk_index)

        if "introduction introduction" in text_start:
            score += 24.0
        if "calibre perc flow" in text_start:
            score += 20.0
        if any(f"{term} is " in text_start or f"{term}™ is " in text_start for term in terms):
            score += 22.0
        if "platform" in text_start and any(term in text_start for term in terms):
            score += 10.0
        if terms and not any(term in title_path or term in text_start for term in terms):
            score -= 20.0

        if hit.title.strip().lower() == "index" or hit.source_path.lower().endswith("/index.html"):
            score -= 35.0
        if "calbr_rn" in hit.source_path.lower() or "release" in title_path or "_rh" in hit.source_path.lower():
            score -= 35.0
        if any(term.startswith("3d") for term in terms) and "3dstack_user" in hit.source_path.lower():
            score += 18.0
        if any(term.startswith("3d") for term in terms) and any(marker in text_start for marker in ("calibre 3dperc", "running calibre 3dperc", "configuring calibre 3dperc", "3dperc flow")):
            score += 24.0
        if hit.text.count("................................................................") >= 2:
            score -= 50.0
        if "command reference" in haystack and not any(hint in text_start for hint in ("introduction", "overview", "flow")):
            score -= 24.0
        if hit.text.count("::") >= 6:
            score -= 30.0
        if text_start.count("perc::") >= 3:
            score -= 35.0

    if usage_question:
        for hint in USAGE_HINTS:
            if hint in haystack:
                score += 3.0
            if hint in text_start:
                score += 6.0
        if any(marker in text_start for marker in ("usage ", "arguments ", "examples ", "keywords ")):
            score += 16.0
        if "dfm property" in text_start:
            score += 18.0
        if terms and all(term in haystack for term in terms[:3]):
            score += 10.0
        if hit.text.count("................................................................") >= 2:
            score -= 35.0

    if hit.source_path.lower().endswith(".pdf"):
        score += 1.0

    score -= min(max(hit.score, -100.0), 100.0) * 0.05
    return score


def build_rag_hits(query: str, limit: int = ANSWER_CONTEXT_LIMIT) -> list[SearchHit]:
    maybe_incremental_index()
    terms = query_terms(query)
    concept_question = is_concept_question(query)
    usage_question = is_usage_question(query)
    candidates: dict[int, SearchHit] = {}

    for hit in search(query, limit=SEARCH_CANDIDATE_LIMIT):
        candidates.setdefault(hit.chunk_id, hit)

    if concept_question and terms:
        expanded_query = " ".join(terms + ["overview", "introduction", "flow", "concept", "manual", "guide"])
        for hit in search(expanded_query, limit=SEARCH_CANDIDATE_LIMIT):
            candidates.setdefault(hit.chunk_id, hit)
        for hit in document_intro_hits(terms, limit=16):
            candidates.setdefault(hit.chunk_id, hit)

    if usage_question and terms:
        usage_query = " ".join(terms + ["usage", "arguments", "options", "keywords", "examples", "syntax"])
        usage_seeds = search(usage_query, limit=SEARCH_CANDIDATE_LIMIT)
        for hit in usage_seeds:
            candidates.setdefault(hit.chunk_id, hit)
        for hit in adjacent_chunk_hits(usage_seeds[:10], radius=2, limit=40):
            candidates.setdefault(hit.chunk_id, hit)

    relevant_candidates = []
    for hit in candidates.values():
        if concept_question:
            searchable = f"{hit.title} {hit.source_path} {hit.text[:900]}".lower()
        else:
            searchable = f"{hit.title} {hit.source_path} {hit.text}".lower()
        if terms and not any(term in searchable for term in terms):
            continue
        relevant_candidates.append(hit)

    ranked = sorted(
        relevant_candidates,
        key=lambda hit: hit_rank(query, hit, terms, concept_question, usage_question),
        reverse=True,
    )

    selected: list[SearchHit] = []
    per_doc_count: dict[str, int] = {}
    per_doc_limit = 5 if (concept_question or usage_question) else 3
    for hit in ranked:
        count = per_doc_count.get(hit.source_path, 0)
        if count >= per_doc_limit:
            continue
        selected.append(hit)
        per_doc_count[hit.source_path] = count + 1
        if len(selected) >= limit:
            break

    return selected


def sentence_score(sentence: str, terms: set[str]) -> int:
    lower = sentence.lower()
    return sum(1 for term in terms if term in lower)


def manual_summary() -> list[dict[str, Any]]:
    conn = connect()
    try:
        rows = conn.execute(
            """
            SELECT
                d.tool AS tool,
                COUNT(DISTINCT d.id) AS documents,
                COUNT(c.id) AS chunks
            FROM documents d
            LEFT JOIN chunks c ON c.document_id = d.id
            GROUP BY d.tool
            ORDER BY documents DESC, chunks DESC, tool
            """
        ).fetchall()
    finally:
        conn.close()

    return [
        {
            "tool": row["tool"],
            "documents": int(row["documents"]),
            "chunks": int(row["chunks"]),
        }
        for row in rows
    ]



def text_fragment(value: str) -> str:
    cleaned = re.sub(r"\s+", " ", value).strip()
    if not cleaned:
        return ""
    words = cleaned.split(" ")
    fragment = " ".join(words[:14])
    return quote(fragment[:160], safe="")


def manual_url(source_path: str) -> str:
    return "/" + quote(source_path, safe="/")


def source_url_for_hit(hit: SearchHit) -> str:
    suffix = Path(hit.source_path).suffix.lower()
    if suffix in {".html", ".htm"}:
        fragment = text_fragment(hit.text)
        query = f"?highlight={fragment}" if fragment else ""
        return f"{manual_url(hit.source_path)}{query}"
    if suffix == ".pdf":
        page = hit.page if hit.page else "1"
        return f"/pdf-viewer?path={quote(hit.source_path)}&page={quote(str(page))}"
    return f"/source?chunk_id={hit.chunk_id}#chunk-{hit.chunk_id}"


def source_payload(hits: list[SearchHit]) -> list[dict[str, Any]]:
    source_map: dict[int, SearchHit] = {}
    for hit in hits:
        source_map.setdefault(hit.chunk_id, hit)
    return [
        {
            "chunk_id": hit.chunk_id,
            "tool": hit.tool,
            "title": hit.title,
            "source_path": hit.source_path,
            "page": hit.page,
            "excerpt": hit.text[:650],
            "source_url": source_url_for_hit(hit),
        }
        for hit in source_map.values()
    ]


def fallback_answer(question: str, hits: list[SearchHit]) -> str:
    terms = set(query_terms(question))
    candidates: list[tuple[int, SearchHit, str]] = []
    for hit in hits:
        sentences = re.split(r"(?<=[.!?。！？])\s+", hit.text)
        for sentence in sentences:
            sentence = sentence.strip()
            if len(sentence) < 24:
                continue
            score = sentence_score(sentence, terms)
            if score:
                candidates.append((score, hit, sentence))

    candidates.sort(key=lambda item: item[0], reverse=True)
    selected = candidates[:5]
    if selected:
        bullets = []
        for _, hit, sentence in selected:
            page = f", p.{hit.page}" if hit.page else ""
            bullets.append(f"- {sentence} [{hit.tool}: {hit.title}{page}]")
        return "根据已导入手册，相关信息如下：\n\n" + "\n".join(bullets)

    preview = hits[0].text[:900]
    return f"找到相关手册片段，但没有提取到明确句子。最相关内容如下：\n\n{preview}"


def llm_context(hits: list[SearchHit]) -> str:
    blocks = []
    for index, hit in enumerate(hits[:LLM_CONTEXT_LIMIT], start=1):
        page = f", page {hit.page}" if hit.page else ""
        text = hit.text
        if len(text) > LLM_CHUNK_CHAR_LIMIT:
            text = text[:LLM_CHUNK_CHAR_LIMIT].rsplit(" ", 1)[0] + " ..."
        blocks.append(
            f"[{index}] Tool: {hit.tool}\n"
            f"Title: {hit.title}{page}\n"
            f"Source: {hit.source_path}\n"
            f"Content:\n{text}"
        )
    return "\n\n".join(blocks)


def call_llm(question: str, hits: list[SearchHit], config: AppConfig) -> str:
    url = f"{config.llm_base_url}/chat/completions"
    system_prompt = (
        "You are an assistant for EDA tool manuals. Answer in Chinese unless the user asks otherwise. "
        "Use only the provided manual excerpts. Synthesize across excerpts instead of simply listing search hits. "
        "For concept questions, explain the definition, purpose, typical flow, important inputs/outputs, and practical usage when the excerpts support it. "
        "For usage, option, syntax, or example questions, provide a detailed technical answer: include syntax or command form, explain each relevant option/argument, describe behavior and constraints, and include examples from the excerpts when available. "
        "Use clean Markdown with a consistent structure. For detailed technical answers, use sections such as: 结论, 用法/语法, 参数/选项, 示例, 注意事项. "
        "For options, arguments, modes, return values, and examples, use a valid Markdown pipe table with a separator row, for example: | 项目 | 作用 | 约束/注意点 | 示例/来源 | followed by | --- | --- | --- | --- |. Do not use space-aligned plain text tables. "
        "Do not omit important options or caveats that appear in the excerpts. If several excerpts describe different modes, organize the answer by mode or use case. "
        "If the excerpts do not contain enough information, say what is missing. "
        "Cite sources inline using the bracket numbers like [1], [2] after the specific claim they support, including inside table cells when appropriate."
    )
    payload = {
        "model": config.llm_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": (
                    f"Question:\n{question}\n\n"
                    f"Manual excerpts:\n{llm_context(hits)}"
                ),
            },
        ],
        "temperature": 0.2,
    }
    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {config.llm_api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=config.llm_timeout) as response:
            raw_body = response.read().decode("utf-8")
            data = json.loads(raw_body)
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")[:500]
        raise RuntimeError(f"LLM API returned HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"LLM API connection failed: {exc.reason}") from exc
    except TimeoutError as exc:
        raise RuntimeError(f"LLM API timed out after {config.llm_timeout}s") from exc
    except OSError as exc:
        raise RuntimeError(f"LLM API connection failed: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"LLM API returned invalid JSON: {exc}") from exc

    try:
        return str(data["choices"][0]["message"]["content"]).strip()
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError("LLM API response format is not OpenAI-compatible") from exc


def answer_question(question: str, llm_config: Any = None) -> dict[str, Any]:
    config = config_from_payload(llm_config)
    hits = build_rag_hits(question)
    if not hits:
        return {
            "answer": "没有在已导入的手册中检索到足够相关的内容。可以换一个关键词，或先导入对应工具的 user guide 后重建索引。",
            "sources": [],
        }

    answer_mode = "local"
    if config.llm_enabled:
        try:
            answer = call_llm(question, hits, config)
            answer_mode = "llm"
        except Exception as exc:
            answer = fallback_answer(question, hits)
            answer += f"\n\n注意：内部 LLM 调用失败，已切换到本地检索回答。原因：{exc}"
    else:
        answer = fallback_answer(question, hits)

    visible_hits = hits[:LLM_CONTEXT_LIMIT] if config.llm_enabled else hits
    return {"answer": answer, "sources": source_payload(visible_hits), "mode": answer_mode}


def manual_file_path(source_path: str) -> Path:
    decoded = unquote(source_path)
    candidate = (ROOT / decoded).resolve()
    manuals_root = MANUALS_DIR.resolve()
    if candidate == manuals_root or manuals_root not in candidate.parents:
        raise PermissionError("source file is outside manuals directory")
    if not candidate.is_file():
        raise FileNotFoundError(decoded)
    return candidate


def source_document_html(chunk_id: int) -> str:
    conn = connect()
    try:
        target = conn.execute(
            """
            SELECT
                c.id AS chunk_id,
                c.document_id,
                c.chunk_index,
                c.page,
                c.text,
                d.tool,
                d.title,
                d.source_path
            FROM chunks c
            JOIN documents d ON d.id = c.document_id
            WHERE c.id = ?
            """,
            (chunk_id,),
        ).fetchone()
        if not target:
            raise KeyError(f"source chunk {chunk_id} was not found")

        rows = conn.execute(
            """
            SELECT id AS chunk_id, chunk_index, page, text
            FROM chunks
            WHERE document_id = ?
            ORDER BY chunk_index
            """,
            (target["document_id"],),
        ).fetchall()
    finally:
        conn.close()

    escaped_title = html.escape(target["title"])
    escaped_tool = html.escape(target["tool"])
    escaped_source = html.escape(target["source_path"])
    page_label = f"page {target['page']}" if target["page"] else "indexed text"
    escaped_page_label = html.escape(page_label)

    chunk_items = []
    for row in rows:
        row_id = int(row["chunk_id"])
        active = " active" if row_id == chunk_id else ""
        label = f"Page {row['page']}" if row["page"] else f"Chunk {int(row['chunk_index']) + 1}"
        chunk_items.append(
            '<article id="chunk-{row_id}" class="source-chunk{active}">'
            '<div class="chunk-meta">{label}</div>'
            '<pre>{body}</pre>'
            '</article>'.format(
                row_id=row_id,
                active=active,
                label=html.escape(label),
                body=html.escape(row["text"]),
            )
        )

    return """<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{title} - EDA Tools Navigator</title>
  <style>
    :root {{ color-scheme: light; --bg: #f4f7f6; --panel: #fff; --ink: #18211f; --muted: #60706c; --line: #d9e1de; --accent: #1d766f; --mark: #fff4bf; }}
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; background: var(--bg); color: var(--ink); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }}
    header {{ background: var(--panel); border-bottom: 1px solid var(--line); padding: 18px 24px; position: sticky; top: 0; z-index: 2; }}
    main {{ margin: 0 auto; max-width: 1120px; padding: 20px 24px 56px; }}
    h1 {{ font-size: 22px; line-height: 1.25; margin: 0 0 8px; }}
    .meta {{ color: var(--muted); display: flex; flex-wrap: wrap; gap: 10px; font-size: 13px; line-height: 1.45; }}
    .meta span {{ background: #edf4f2; border: 1px solid var(--line); border-radius: 8px; padding: 4px 8px; }}
    .jump {{ color: var(--accent); font-size: 13px; font-weight: 700; margin-top: 10px; display: inline-block; }}
    .source-chunk {{ background: var(--panel); border: 1px solid var(--line); border-radius: 8px; margin: 12px 0; overflow: hidden; }}
    .source-chunk.active {{ border-color: var(--accent); box-shadow: 0 0 0 3px rgba(29, 118, 111, 0.15); }}
    .chunk-meta {{ background: #eef5f3; border-bottom: 1px solid var(--line); color: var(--muted); font-size: 12px; font-weight: 700; padding: 8px 12px; }}
    .source-chunk.active .chunk-meta {{ background: var(--mark); color: var(--ink); }}
    pre {{ font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; font-size: 13px; line-height: 1.55; margin: 0; overflow-x: auto; padding: 12px; white-space: pre-wrap; word-break: break-word; }}
  </style>
</head>
<body>
  <header>
    <h1>{title}</h1>
    <div class="meta">
      <span>Tool: {tool}</span>
      <span>Source: {source}</span>
      <span>Reference: {page_label}</span>
    </div>
    <a class="jump" href="#chunk-{chunk_id}">跳到引用位置</a>
  </header>
  <main>
    {chunks}
  </main>
</body>
</html>""".format(
        title=escaped_title,
        tool=escaped_tool,
        source=escaped_source,
        page_label=escaped_page_label,
        chunk_id=chunk_id,
        chunks="".join(chunk_items),
    )


def parse_multipart(body: bytes, content_type: str) -> tuple[dict[str, str], list[tuple[str, bytes]]]:
    boundary_match = re.search(r'boundary="?([^";]+)"?', content_type)
    if not boundary_match:
        raise ValueError("multipart boundary is missing")

    boundary = ("--" + boundary_match.group(1)).encode("utf-8")
    fields: dict[str, str] = {}
    files: list[tuple[str, bytes]] = []

    for raw_part in body.split(boundary):
        raw_part = raw_part.strip()
        if not raw_part or raw_part == b"--":
            continue
        if raw_part.endswith(b"--"):
            raw_part = raw_part[:-2].strip()
        if b"\r\n\r\n" in raw_part:
            header_blob, content = raw_part.split(b"\r\n\r\n", 1)
            line_sep = b"\r\n"
        elif b"\n\n" in raw_part:
            header_blob, content = raw_part.split(b"\n\n", 1)
            line_sep = b"\n"
        else:
            continue

        headers = header_blob.decode("utf-8", errors="ignore")
        disposition = ""
        for line in headers.split(line_sep.decode("ascii")):
            if line.lower().startswith("content-disposition:"):
                disposition = line
                break

        name_match = re.search(r'name="([^"]+)"', disposition)
        if not name_match:
            continue
        name = name_match.group(1)
        filename_match = re.search(r'filename="([^"]*)"', disposition)
        content = content.rstrip(b"\r\n")

        if filename_match:
            filename = Path(filename_match.group(1)).name
            if filename:
                files.append((filename, content))
        else:
            fields[name] = content.decode("utf-8", errors="ignore")

    return fields, files


def html_base_href(path: Path) -> str:
    rel_dir = path.parent.relative_to(ROOT).as_posix()
    return f"/{quote(rel_dir, safe='/')}/"


def html_locator_script(highlight: str) -> str:
    if not highlight:
        return ""
    payload = json.dumps(highlight, ensure_ascii=False)
    return """
<style>
  .eda-nav-reference {{ outline: 3px solid #1d766f !important; background: rgba(255, 244, 191, 0.65) !important; scroll-margin-top: 80px; }}
</style>
<script>
(function () {{
  const needle = {payload};
  if (!needle) return;
  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const target = normalize(needle);
  if (!target) return;
  const selector = 'p,li,td,th,pre,code,blockquote,section,article,div,span,h1,h2,h3,h4,h5,h6';
  const elements = Array.from(document.body.querySelectorAll(selector));
  let best = null;
  for (const element of elements) {{
    const text = normalize(element.innerText || element.textContent || '');
    if (!text.includes(target)) continue;
    if (!best || text.length < normalize(best.innerText || best.textContent || '').length) best = element;
  }}
  if (best) {{
    best.classList.add('eda-nav-reference');
    best.id = best.id || 'eda-nav-reference';
    setTimeout(() => best.scrollIntoView({{ block: 'center', behavior: 'auto' }}), 80);
  }}
}})();
</script>""".format(payload=payload)


def inject_html_reference_tools(raw_html: str, path: Path, highlight: str) -> str:
    base = f'<base href="{html.escape(html_base_href(path))}">'
    if re.search(r"<base\b", raw_html, flags=re.IGNORECASE):
        with_base = raw_html
    elif re.search(r"<head[^>]*>", raw_html, flags=re.IGNORECASE):
        with_base = re.sub(r"(<head[^>]*>)", r"\1" + "\n" + base, raw_html, count=1, flags=re.IGNORECASE)
    else:
        with_base = base + raw_html
    locator = html_locator_script(highlight)
    if not locator:
        return with_base
    if re.search(r"</body>", with_base, flags=re.IGNORECASE):
        return re.sub(r"</body>", lambda _: locator + "\n</body>", with_base, count=1, flags=re.IGNORECASE)
    return with_base + locator


def pdf_viewer_html(source_path: str, page: str) -> str:
    path = manual_file_path(source_path)
    safe_title = html.escape(path.name)
    safe_page = html.escape(page or "1")
    pdf_src = f"{manual_url(str(path.relative_to(ROOT)))}#page={quote(str(page or '1'))}&zoom=page-width"
    safe_pdf_src = html.escape(pdf_src, quote=True)
    return """<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{safe_title} - page {safe_page}</title>
  <style>
    html, body {{ height: 100%; margin: 0; }}
    body {{ display: grid; grid-template-rows: auto 1fr; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }}
    header {{ align-items: center; background: #fff; border-bottom: 1px solid #d9e1de; display: flex; gap: 12px; justify-content: space-between; padding: 10px 14px; }}
    strong {{ font-size: 14px; }}
    span {{ color: #60706c; font-size: 13px; }}
    a {{ color: #1d766f; font-size: 13px; font-weight: 800; }}
    iframe {{ border: 0; height: 100%; width: 100%; }}
  </style>
</head>
<body>
  <header>
    <div><strong>{safe_title}</strong> <span>page {safe_page}</span></div>
    <a href="{safe_pdf_src}" target="_blank" rel="noopener noreferrer">打开原 PDF</a>
  </header>
  <iframe src="{safe_pdf_src}" title="{safe_title}"></iframe>
</body>
</html>""".format(safe_title=safe_title, safe_page=safe_page, safe_pdf_src=safe_pdf_src)


class AppHandler(SimpleHTTPRequestHandler):
    server_version = "EDAManualRAG/1.0"

    def translate_path(self, path: str) -> str:
        parsed = urlparse(path)
        if parsed.path == "/":
            return str(STATIC_DIR / "index.html")
        if parsed.path.startswith("/static/"):
            return str(ROOT / parsed.path.lstrip("/"))
        return str(STATIC_DIR / parsed.path.lstrip("/"))

    def send_json(self, payload: Any, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_html(self, body: str, status: int = 200) -> None:
        encoded = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def send_file(self, path: Path, highlight: str = "") -> None:
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if path.suffix.lower() in {".html", ".htm"}:
            raw_html = path.read_text(encoding="utf-8", errors="ignore")
            data = inject_html_reference_tools(raw_html, path, highlight).encode("utf-8")
            content_type = "text/html; charset=utf-8"
        else:
            data = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Disposition", f'inline; filename="{path.name}"')
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/manuals/"):
            try:
                highlight = parse_qs(parsed.query).get("highlight", [""])[0]
                self.send_file(manual_file_path(parsed.path.lstrip("/")), highlight=highlight)
            except (FileNotFoundError, PermissionError):
                self.send_html("<h1>Manual file not found</h1>", HTTPStatus.NOT_FOUND)
            except Exception as exc:
                self.send_html(f"<h1>Manual view failed</h1><pre>{html.escape(str(exc))}</pre>", HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        if parsed.path == "/pdf-viewer":
            try:
                params = parse_qs(parsed.query)
                self.send_html(pdf_viewer_html(params.get("path", [""])[0], params.get("page", ["1"])[0]))
            except (FileNotFoundError, PermissionError):
                self.send_html("<h1>PDF file not found</h1>", HTTPStatus.NOT_FOUND)
            except Exception as exc:
                self.send_html(f"<h1>PDF view failed</h1><pre>{html.escape(str(exc))}</pre>", HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        if parsed.path == "/manual":
            try:
                source_path = parse_qs(parsed.query).get("path", [""])[0]
                self.send_file(manual_file_path(source_path))
            except (FileNotFoundError, PermissionError):
                self.send_html("<h1>Manual file not found</h1>", HTTPStatus.NOT_FOUND)
            except Exception as exc:
                self.send_html(f"<h1>Manual view failed</h1><pre>{html.escape(str(exc))}</pre>", HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        if parsed.path == "/source":
            try:
                chunk_id = int(parse_qs(parsed.query).get("chunk_id", [""])[0])
                self.send_html(source_document_html(chunk_id))
            except (TypeError, ValueError):
                self.send_html("<h1>Invalid source link</h1>", HTTPStatus.BAD_REQUEST)
            except KeyError:
                self.send_html("<h1>Source not found</h1>", HTTPStatus.NOT_FOUND)
            except Exception as exc:
                self.send_html(f"<h1>Source view failed</h1><pre>{html.escape(str(exc))}</pre>", HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        if self.path.startswith("/api/settings"):
            self.send_json(settings_payload())
            return

        if self.path.startswith("/api/status"):
            conn = connect()
            docs = conn.execute("SELECT COUNT(*) AS n FROM documents").fetchone()["n"]
            chunks = conn.execute("SELECT COUNT(*) AS n FROM chunks").fetchone()["n"]
            tools = [
                row["tool"]
                for row in conn.execute("SELECT DISTINCT tool FROM documents ORDER BY tool").fetchall()
            ]
            conn.close()
            self.send_json(
                {
                    "documents": docs,
                    "chunks": chunks,
                    "tools": tools,
                    "tool_stats": manual_summary(),
                    "llm_enabled": CONFIG.llm_enabled,
                    "version": app_version(),
                    "debug": DEBUG_MODE,
                    "search_backend": search_backend_name(),
                }
            )
            return
        return super().do_GET()

    def do_POST(self) -> None:
        if self.path == "/api/settings":
            self.send_json({"error": "LLM settings are saved in each browser and are not written to the server"}, HTTPStatus.BAD_REQUEST)
            return

        if self.path == "/api/chat":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                payload = json.loads(self.rfile.read(length) or b"{}")
                question = str(payload.get("question", "")).strip()
                if not question:
                    self.send_json({"error": "question is required"}, HTTPStatus.BAD_REQUEST)
                    return
                self.send_json(answer_question(question, payload.get("llm_config")))
            except json.JSONDecodeError as exc:
                self.send_json({"error": f"invalid JSON request: {exc}"}, HTTPStatus.BAD_REQUEST)
            except Exception as exc:
                self.send_json({"error": f"chat request failed: {exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        if self.path == "/api/reindex":
            if not DEBUG_MODE:
                self.send_json({"error": "debug mode is required"}, HTTPStatus.FORBIDDEN)
                return
            self.send_json(reindex_all())
            return

        if self.path == "/api/upload":
            if not DEBUG_MODE:
                self.send_json({"error": "debug mode is required"}, HTTPStatus.FORBIDDEN)
                return
            self.handle_upload()
            return

        self.send_error(HTTPStatus.NOT_FOUND)

    def handle_upload(self) -> None:
        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            self.send_json({"error": "multipart/form-data is required"}, HTTPStatus.BAD_REQUEST)
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            fields, files = parse_multipart(self.rfile.read(length), content_type)
            tool = normalize_tool_name(fields.get("tool", "General"))

            saved = 0
            target_dir = MANUALS_DIR / tool
            target_dir.mkdir(parents=True, exist_ok=True)
            for filename, content in files:
                suffix = Path(filename).suffix.lower()
                if suffix not in {".txt", ".md", ".markdown", ".html", ".htm", ".pdf"}:
                    continue
                with (target_dir / filename).open("wb") as fh:
                    fh.write(content)
                saved += 1

            result = incremental_index()
            self.send_json({"saved": saved, "indexed": result})
        except Exception as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.INTERNAL_SERVER_ERROR)


def run(host: str, port: int, debug: bool = False) -> None:
    global DEBUG_MODE
    DEBUG_MODE = debug
    ensure_dirs()
    maybe_incremental_index(force=True)
    server = ThreadingHTTPServer((host, port), AppHandler)
    print(f"EDA Tools Navigator is running at http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Local EDA tools navigator web app")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--reindex", action="store_true")
    parser.add_argument("-debug", "--debug", action="store_true", help="show manual import and reindex controls")
    args = parser.parse_args()

    if args.reindex:
        result = reindex_all()
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return
    run(args.host, args.port, debug=args.debug)


if __name__ == "__main__":
    main()
