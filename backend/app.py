from flask import Flask, request, jsonify
from flask_cors import CORS
from werkzeug.utils import secure_filename

import os
import shutil
import uuid

from Fetching.query import ask_question
from Fetching.gather import (
    load_document,
    chunk_documents,
    create_embeddings,
    tag_documents_with_doc_id,
)
from Fetching import doc_registry
from langchain_community.vectorstores import FAISS


app = Flask(__name__)
CORS(app)

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
VECTOR_STORE_PATH = os.path.join(BACKEND_DIR, "Fetching", "vector_store")
os.makedirs(VECTOR_STORE_PATH, exist_ok=True)


def _reset_document_storage():
    if os.path.isdir(VECTOR_STORE_PATH):
        shutil.rmtree(VECTOR_STORE_PATH)
    os.makedirs(VECTOR_STORE_PATH, exist_ok=True)
    doc_registry.clear_registry()
    doc_registry.clear_upload_meta()


def _ingest_file_to_chunks(file_storage):
    raw_name = file_storage.filename or ""
    safe_name = secure_filename(raw_name)
    if not safe_name:
        ext = os.path.splitext(raw_name)[1].lower() if raw_name else ""
        if ext not in (".pdf", ".docx", ".txt", ".csv"):
            ext = ".pdf"
        safe_name = f"document_{uuid.uuid4().hex[:12]}{ext}"

    temp_path = os.path.join(BACKEND_DIR, f"temp_{uuid.uuid4().hex}_{safe_name}")
    file_storage.save(temp_path)

    try:
        ext = os.path.splitext(safe_name)[1].lower()
        documents = load_document(temp_path)
        has_text = any((doc.page_content or "").strip() for doc in documents)
        if not has_text:
            if ext == ".pdf":
                raise ValueError(
                    "This PDF has no extractable text. It may be scanned or image-only. "
                    "Try a text-based PDF or add OCR support."
                )
            raise ValueError("This file has no extractable text.")

        doc_id = uuid.uuid4().hex
        tag_documents_with_doc_id(documents, doc_id, safe_name)
        chunks = chunk_documents(documents)
        if not chunks:
            raise ValueError("Could not extract any searchable text from the file.")
        return chunks, doc_id, safe_name
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


@app.route("/", methods=["GET"])
def home():
    return jsonify({"message": "Flask backend is running"})


@app.route("/documents", methods=["GET"])
def list_documents():
    return jsonify(
        {
            "documents": doc_registry.list_documents(),
            "compare_available": doc_registry.is_compare_available(),
        }
    )


@app.route("/clear", methods=["POST"])
def clear_all():
    try:
        _reset_document_storage()
        return jsonify({"message": "All documents cleared."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def _collect_upload_files():
    """Accept `files` (multi) or `file` (single) from various clients."""
    out = [f for f in request.files.getlist("files") if f and f.filename]
    if out:
        return out
    one = request.files.get("file")
    if one and one.filename:
        return [one]
    return []


@app.route("/upload", methods=["POST"])
def upload_pdf():
    files = _collect_upload_files()
    if not files:
        return jsonify({"error": "No file uploaded"}), 400

    try:
        _reset_document_storage()

        embeddings = create_embeddings()
        all_chunks = []
        uploaded = []
        for file_storage in files:
            chunks, doc_id, safe_name = _ingest_file_to_chunks(file_storage)
            all_chunks.extend(chunks)
            doc_registry.add_document(doc_id, safe_name)
            uploaded.append({"doc_id": doc_id, "filename": safe_name})

        store = FAISS.from_documents(all_chunks, embeddings)
        store.save_local(VECTOR_STORE_PATH)
        doc_registry.set_last_batch_count(len(uploaded))
        compare_available = len(uploaded) >= 2

        return jsonify(
            {
                "message": "Document(s) uploaded successfully",
                "uploaded": uploaded,
                "documents": doc_registry.list_documents(),
                "compare_available": compare_available,
            }
        )

    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/ask", methods=["POST"])
def ask():
    data = request.get_json()

    if not data or "question" not in data:
        return jsonify({"error": "Question is required"}), 400

    question = data["question"]
    mode = data.get("mode") or "default"
    doc_ids = data.get("doc_ids")
    compare = data.get("compare") or {}
    compare_doc_id_a = compare.get("doc_id_a")
    compare_doc_id_b = compare.get("doc_id_b")

    if doc_ids is not None and not isinstance(doc_ids, list):
        return jsonify({"error": "doc_ids must be a list or omitted."}), 400

    doc_ids_filter = doc_ids if doc_ids else None

    try:
        answer = ask_question(
            question,
            mode=mode,
            doc_ids_filter=doc_ids_filter,
            compare_doc_id_a=compare_doc_id_a,
            compare_doc_id_b=compare_doc_id_b,
        )
        return jsonify({"answer": answer})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(debug=True, port=8000)
