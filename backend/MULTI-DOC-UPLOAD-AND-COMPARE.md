# Multi-document upload & compare — guide for the team

**Who this is for:** Anyone on the project who wants to understand **what happens when users upload files and ask questions** — including friends who are **new to AI or backend terms**. You can read only the **plain-English** parts first; the **code** parts are for when you want details.

---

## What this app does (30 seconds)

1. Users **upload one or more files** (PDF, Word, etc.).
2. The server **reads the text**, **cuts it into small pieces**, **labels** each piece with which file it came from, and **saves a search index** on disk.
3. When users **type a question**, the server **finds the most relevant pieces** and sends them + the question to an **AI** (Llama via Groq) to write an answer.
4. If they uploaded **at least two files** in one go, they can turn on **Compare** and pick **two documents** — the server pulls text from **both** and asks the AI to compare.

---

## Words your friends might not know (mini glossary)

| Term | Simple meaning |
|------|----------------|
| **Endpoint / route** | A URL path the server understands, e.g. “upload” or “ask”. |
| **POST** | A way the browser **sends data** to the server (like submitting a form). |
| **JSON** | Text format for structured data `{ "key": "value" }` between frontend and backend. |
| **Chunk** | A small block of text cut from a long document. |
| **Embedding** | Turning text into numbers so the computer can say “this paragraph is *similar* to this question.” |
| **FAISS** | A **fast search library** — finds which chunks are closest in meaning to the question. Stored as `index.faiss` + `index.pkl` under `Fetching/vector_store/`. |
| **LLM** | Large language model — the **chat-style AI** that writes sentences (here: Llama through Groq). |
| **Groq** | The cloud service that runs the model; needs `GROQ_API_KEY` in `.env`. |
| **`doc_id`** | A random id we assign to **each uploaded file** so every text chunk knows “I belong to file A or file B.” |
| **Registry** | Small JSON file listing **filenames and ids** so the website can show “what’s indexed.” |

---

## Big picture: two flows

### Flow A — Upload

**Plain English:** Browser sends files → **`app.py`** receives them → **`gather.py`** reads text and splits it → we **tag** pieces with file id → **FAISS** saves the search index → **`doc_registry`** saves the list of files for the UI.

**Technical one-liner:**

`Browser` → `POST /upload` in [`app.py`](app.py) → [`gather.py`](Fetching/gather.py) → **FAISS** on disk + [`doc_registry.py`](Fetching/doc_registry.py) JSON.

### Flow B — Ask (normal question or compare)

**Plain English:** Browser sends the **question** (and compare settings if needed) → **`app.py`** passes to **`query.py`** → we **search** the saved index → we call **Groq** → answer text goes back to the browser.

**Technical one-liner:**

`Browser` → `POST /ask` in [`app.py`](app.py) → [`query.py`](Fetching/query.py) `ask_question` → search **FAISS** → **Groq** LLM.

---

## Simple diagram

```text
                    UPLOAD
  [User picks files] ──► [Flask app.py /upload]
                              │
                              ├─► Read text (gather.py)
                              ├─► Tag each piece with doc_id + filename
                              ├─► Build FAISS index (vector_store/)
                              └─► Save file list (documents_registry.json)


                    ASK
  [User types question] ──► [Flask app.py /ask]
                                  │
                                  ├─► Find relevant chunks (query.py + FAISS)
                                  └─► Send chunks + question to Groq → answer
```

---

## Flow A: upload — step by step

### Step 1 — Server receives the upload

**Function:** `upload_pdf()` in `app.py`.

The browser sends a **multipart** request (files). We don’t assume one field name only: some clients send `files`, some send `file`.

### Step 2 — Collect file objects

**Function:** `_collect_upload_files()`

- Try **many** files: `request.files.getlist("files")`.
- If empty, try **one** file: `request.files.get("file")`.

### Step 3 — Start fresh (important)

**Function:** `_reset_document_storage()`

**Plain English:** Each new upload **replaces** the old session. We delete the old search folder, clear the JSON lists, then rebuild only from **this** upload.

**Technical:** Remove `Fetching/vector_store/`, recreate empty folder, `clear_registry()`, `clear_upload_meta()`.

### Step 4 — Embeddings model

**Function:** `create_embeddings()` in `gather.py`

Loads the small **sentence-transformer** model used to turn text into vectors for FAISS.

### Step 5 — For each file: read, tag, chunk

**Function:** `_ingest_file_to_chunks(file_storage)` in `app.py` (calls `gather.py`).

| Sub-step | What it does (plain English) |
|----------|------------------------------|
| Safe filename | Avoid weird paths; if name is empty, generate a fallback name. |
| `load_document` | PDF / DOCX / TXT / CSV → text in memory. |
| `tag_documents_with_doc_id` | Stamp **doc_id** and **filename** on the document so **every chunk** remembers which file it came from. |
| `chunk_documents` | Split long text into ~500-character pieces with overlap. |
| Return | `(chunks, doc_id, safe_name)` for that file. |

**Why tagging matters:** Without `doc_id`, we couldn’t say “these paragraphs are from document A vs B” when comparing.

### Step 6 — Merge all chunks

**Plain English:** All chunks from file 1 **and** file 2 go into **one** Python list. Each chunk still carries its own `doc_id` in metadata.

### Step 7 — Remember files for the UI

**Function:** `doc_registry.add_document(...)`  
Writes/updates **`documents_registry.json`** so the frontend can show names and ids.

### Step 8 — Build and save the search index

**Plain English:** One **FAISS** index contains **all** chunks from **all** files in this upload. Saved under `Fetching/vector_store/`.

```python
store = FAISS.from_documents(all_chunks, embeddings)
store.save_local(VECTOR_STORE_PATH)
```

### Step 9 — Remember “was this a 2+ file upload?”

**Function:** `doc_registry.set_last_batch_count(len(uploaded))`  
Writes **`upload_meta.json`** with `last_batch_file_count`. If ≥ 2, the API returns **`compare_available: true`** so the UI can show **Compare**.

---

## `doc_registry.py` — cheat sheet

| Function | Plain English |
|----------|----------------|
| `load_registry` / `save_registry` | Read/write the list of indexed files. |
| `list_documents` | What `GET /documents` returns to the frontend. |
| `add_document` | After each file in the upload loop, append id + filename + time. |
| `clear_registry` | Empty the list when we reset. |
| `set_last_batch_count` | Store how many files were in the **last** upload batch. |
| `is_compare_available` | True if last batch had **at least 2 files** (show compare). |
| `clear_upload_meta` | Remove meta file on full reset. |

---

## Flow B: asking questions

### Normal question (not compare)

**Plain English:** User asks something → we search the index for the **best matching chunks** (any file) → we glue that text into one block → we ask the LLM to answer using **only** that text.

**Functions:** `ask()` → `ask_question(mode="default")` → `retrieve_documents` → `generate_answer`.

### Compare two documents

**Plain English:** User turns on Compare and picks **Document A** and **Document B** → we search for chunks related to the question, but we **split** results by `doc_id` so **both** files contribute → we put **two** labeled sections in the prompt → LLM writes a comparison.

**Functions:** `ask()` → `ask_question(mode="compare")` → `retrieve_compare_documents` → `generate_compare_answer`.

**Key idea:** `retrieve_compare_documents` uses `similarity_search` to get a **pool** of chunks, then `_pick_docs_from_pool` keeps chunks for **A** and **B** separately using `metadata["doc_id"]`.

---

## `query.py` — main entry

**`ask_question(...)`** decides the path:

- **`mode == "compare"`** → needs `compare_doc_id_a` and `compare_doc_id_b` → `retrieve_compare_documents` + `generate_compare_answer`.
- **Otherwise** → `retrieve_documents` + `generate_answer`.

**`generate_answer` / `generate_compare_answer`** build the text prompt and call **Groq** (`llama-3.1-8b-instant`).

---

## `gather.py` — what matters for multi-file

| Piece | Plain English |
|-------|----------------|
| `load_document` | File → text. |
| `chunk_documents` | Long text → many small chunks. |
| **`tag_documents_with_doc_id`** | **New for multi-doc:** writes `doc_id` and `filename` into metadata so compare can filter by file. |
| `create_embeddings` | Model used when building FAISS. |
| `_VECTOR_DIR` / `store_in_vector_db` | Used by the **CLI** `ingest_pipeline` script; the **web app** saves FAISS from `app.py` directly to the same folder. |

---

## One-line chains (for developers)

**Upload:**

`upload_pdf` → `_collect_upload_files` → `_reset_document_storage` → loop `_ingest_file_to_chunks` → `load_document` + `tag_documents_with_doc_id` + `chunk_documents` → `add_document` → `FAISS.from_documents` → `save_local` → `set_last_batch_count`.

**Compare ask:**

`ask` → `ask_question` → `retrieve_compare_documents` → `generate_compare_answer`.

**Normal ask:**

`ask` → `ask_question` → `retrieve_documents` → `generate_answer`.

---

## Files involved (quick map)

| File | Role |
|------|------|
| [`app.py`](app.py) | Flask routes: `/upload`, `/ask`, `/documents`, `/clear`; orchestration. |
| [`Fetching/gather.py`](Fetching/gather.py) | Load files, chunk, tag with `doc_id`, embeddings helper. |
| [`Fetching/query.py`](Fetching/query.py) | Load FAISS, retrieve chunks, call Groq. |
| [`Fetching/doc_registry.py`](Fetching/doc_registry.py) | JSON registry + upload meta for UI and `compare_available`. |
| `Fetching/vector_store/` | FAISS index files (gitignored). |
| `Fetching/documents_registry.json` | List of indexed docs (gitignored). |
| `Fetching/upload_meta.json` | Last batch file count (gitignored). |

---

*Last updated to match the multi-file upload and compare implementation in this repository. Share this doc with teammates — the top sections are enough for a quick read; the rest is reference.*
