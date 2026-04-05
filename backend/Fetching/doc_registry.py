import json
import os
from datetime import datetime, timezone

REGISTRY_FILENAME = "documents_registry.json"
META_FILENAME = "upload_meta.json"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
REGISTRY_PATH = os.path.join(BASE_DIR, REGISTRY_FILENAME)
META_PATH = os.path.join(BASE_DIR, META_FILENAME)


def load_registry():
    if not os.path.exists(REGISTRY_PATH):
        return {"documents": []}
    with open(REGISTRY_PATH, encoding="utf-8") as f:
        return json.load(f)


def save_registry(data):
    with open(REGISTRY_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def list_documents():
    return load_registry().get("documents", [])


def add_document(doc_id: str, filename: str):
    reg = load_registry()
    reg.setdefault("documents", []).append(
        {
            "doc_id": doc_id,
            "filename": filename,
            "added_at": datetime.now(timezone.utc).isoformat(),
        }
    )
    save_registry(reg)


def clear_registry():
    save_registry({"documents": []})


def set_last_batch_count(n: int):
    with open(META_PATH, "w", encoding="utf-8") as f:
        json.dump({"last_batch_file_count": n}, f, indent=2)


def is_compare_available():
    if not os.path.exists(META_PATH):
        return False
    with open(META_PATH, encoding="utf-8") as f:
        data = json.load(f)
    return data.get("last_batch_file_count", 0) >= 2


def clear_upload_meta():
    if os.path.exists(META_PATH):
        os.remove(META_PATH)
