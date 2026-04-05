import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import "./App.css";

const API_BASE = "http://127.0.0.1:8000";
const QUICK_PROMPTS = [
  "Summarize these documents in 5 bullet points.",
  "What are the key risks or concerns mentioned?",
  "Extract action items and deadlines.",
  "What are the main conclusions?",
];
const COMPARE_PROMPTS = [
  "What are the main differences between these two documents?",
  "What topics overlap between the two?",
  "Compare the conclusions in each document.",
  "Which document is more detailed, and on what?",
];
const SUPPORTED_EXTENSIONS = [".pdf", ".docx", ".txt", ".csv"];

const formatFileSize = (size) => {
  if (!size && size !== 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const isSupportedFile = (name) => {
  const lowerName = name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
};

function App() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [files, setFiles] = useState([]);
  const [uploadStatus, setUploadStatus] = useState("");
  const [uploadKind, setUploadKind] = useState("muted");
  const [loadingAsk, setLoadingAsk] = useState(false);
  const [loadingUpload, setLoadingUpload] = useState(false);
  const [loadingClear, setLoadingClear] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [serverDocuments, setServerDocuments] = useState([]);
  const [compareAvailable, setCompareAvailable] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [compareDocA, setCompareDocA] = useState("");
  const [compareDocB, setCompareDocB] = useState("");

  const fetchDocuments = useCallback(async () => {
    try {
      const response = await axios.get(`${API_BASE}/documents`);
      setServerDocuments(response.data.documents ?? []);
      setCompareAvailable(Boolean(response.data.compare_available));
    } catch (error) {
      console.error(error);
    }
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  useEffect(() => {
    if (!compareAvailable) {
      setCompareMode(false);
      setCompareDocA("");
      setCompareDocB("");
    }
  }, [compareAvailable]);

  const addFilesFromList = (fileList) => {
    const next = Array.from(fileList || []).filter((f) => isSupportedFile(f.name));
    const bad = Array.from(fileList || []).filter((f) => !isSupportedFile(f.name));
    if (bad.length) {
      setUploadKind("error");
      setUploadStatus("Some files were skipped (use PDF, DOCX, TXT, or CSV).");
    } else {
      setUploadStatus("");
      setUploadKind("muted");
    }
    if (next.length) {
      setFiles((prev) => [...prev, ...next]);
    }
  };

  const askQuestion = async () => {
    const q = question.trim();
    if (!q || loadingAsk) return;

    const useCompare = compareMode && compareAvailable && serverDocuments.length >= 2;
    if (useCompare) {
      if (!compareDocA || !compareDocB) {
        setAnswer("Select Document A and Document B to compare.");
        return;
      }
      if (compareDocA === compareDocB) {
        setAnswer("Choose two different documents.");
        return;
      }
    }

    setLoadingAsk(true);
    try {
      const payload = { question: q, mode: useCompare ? "compare" : "default" };
      if (useCompare) {
        payload.compare = { doc_id_a: compareDocA, doc_id_b: compareDocB };
      }
      const response = await axios.post(`${API_BASE}/ask`, payload);
      setAnswer(response.data.answer ?? "");
    } catch (error) {
      console.error("Error:", error);
      const msg = error.response?.data?.error;
      setAnswer(
        msg
          ? String(msg)
          : "Something went wrong. Check that the API is running and try again.",
      );
    } finally {
      setLoadingAsk(false);
    }
  };

  const uploadFile = async () => {
    if (!files.length) {
      setUploadKind("error");
      setUploadStatus("Choose one or more files first.");
      return;
    }

    const formData = new FormData();
    // `file`: legacy servers that only check request.files["file"]
    // `files`: multi-file for current backend
    formData.append("file", files[0]);
    files.forEach((f) => formData.append("files", f));

    setLoadingUpload(true);
    setUploadKind("muted");
    setUploadStatus("Uploading…");
    try {
      const response = await axios.post(`${API_BASE}/upload`, formData);
      const multi = Boolean(response.data?.compare_available);
      setCompareAvailable(multi);
      setUploadStatus(
        multi
          ? "Indexed. Ask questions or use Compare to contrast two documents."
          : "Indexed. Ask questions about your document.",
      );
      setUploadKind("success");
      setFiles([]);
      await fetchDocuments();
    } catch (error) {
      console.error(error);
      setUploadKind("error");
      const msg =
        error.response?.data?.error ??
        (error.response?.status === 400 ? "No file received. Try again." : null);
      setUploadStatus(
        msg ? String(msg) : "Upload failed. Check the server and try again.",
      );
    } finally {
      setLoadingUpload(false);
    }
  };

  const clearAllDocuments = async () => {
    if (!serverDocuments.length) {
      setUploadKind("error");
      setUploadStatus("Nothing to clear.");
      return;
    }
    if (!window.confirm("Remove all indexed documents?")) {
      return;
    }
    setLoadingClear(true);
    try {
      await axios.post(`${API_BASE}/clear`);
      setServerDocuments([]);
      setCompareAvailable(false);
      setUploadStatus("Cleared. Upload new files when ready.");
      setUploadKind("success");
    } catch (error) {
      console.error(error);
      setUploadKind("error");
      setUploadStatus("Could not clear. Check the server.");
    } finally {
      setLoadingClear(false);
    }
  };

  const onFileChange = (e) => {
    addFilesFromList(e.target.files);
    e.target.value = "";
  };

  const removeFileAt = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const clearSelectedFiles = () => {
    setFiles([]);
    setUploadStatus("");
    setUploadKind("muted");
  };

  const onQuestionKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      askQuestion();
    }
  };

  const onDropFile = (e) => {
    e.preventDefault();
    setDragActive(false);
    addFilesFromList(e.dataTransfer.files);
  };

  const copyAnswer = async () => {
    if (!answer.trim()) return;
    try {
      await navigator.clipboard.writeText(answer);
      setCopyStatus("Copied");
      setTimeout(() => setCopyStatus(""), 1800);
    } catch (error) {
      console.error(error);
      setCopyStatus("Copy failed");
      setTimeout(() => setCopyStatus(""), 1800);
    }
  };

  const statusClass =
    uploadKind === "success"
      ? "status status--success"
      : uploadKind === "error"
        ? "status status--error"
        : "status status--muted";

  const askDisabled = loadingAsk || !question.trim();
  const compareReady = compareAvailable && serverDocuments.length >= 2;
  const quickPrompts = compareMode && compareReady ? COMPARE_PROMPTS : QUICK_PROMPTS;

  return (
    <div className="app">
      <div className="app__bg" aria-hidden />
      <div className="shell">
        <header className="shell__header">
          <div className="shell__brand" aria-hidden>
            <span className="shell__brand-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 19.5A2.5 2.5 0 016.5 17H20"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path d="M8 7h8M8 11h8M8 15h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </span>
          </div>
          <p className="shell__eyebrow">Read smarter</p>
          <h1 className="shell__title">
            <span className="shell__title-text">Document Summarizer</span>
          </h1>
          <p className="shell__lead">
            Upload one or more PDF, Word, CSV, or text files in one batch, then ask questions. Upload
            two or more files at once to enable compare.
          </p>
          <div className="shell__tags">
            <span className="shell__tag">
              <span className="shell__tag-dot" aria-hidden />
              Multi-file upload
            </span>
            <span className="shell__tag">
              <span className="shell__tag-dot shell__tag-dot--mint" aria-hidden />
              Summaries &amp; Q&amp;A
            </span>
            <span className="shell__tag">
              <span className="shell__tag-dot shell__tag-dot--amber" aria-hidden />
              Compare two docs
            </span>
          </div>
        </header>

        <div className="shell__card">
          <div className="shell__card-shine" aria-hidden />
          <section className="panel" aria-labelledby="upload-heading">
            <h2 id="upload-heading" className="panel__label">
              <span className="panel__step" aria-hidden>
                1
              </span>
              Add your documents
            </h2>
            <div className="dropzone">
              <div
                className={`dropzone__surface ${dragActive ? "dropzone__surface--active" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={onDropFile}
              >
                <div className="dropzone__row">
                  <input
                    id="file-input"
                    className="file-input"
                    type="file"
                    accept=".pdf,.docx,.txt,.csv"
                    multiple
                    onChange={onFileChange}
                  />
                  <label className="file-trigger" htmlFor="file-input">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M12 16V4m0 0l-4 4m4-4l4 4M4 20h16"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Browse files
                  </label>
                  <button
                    type="button"
                    className="btn btn--success"
                    onClick={uploadFile}
                    disabled={loadingUpload || !files.length}
                  >
                    {loadingUpload ? (
                      <>
                        <span className="spinner" aria-hidden />
                        <span className="sr-only">Uploading</span>
                        Uploading
                      </>
                    ) : (
                      "Upload"
                    )}
                  </button>
                </div>
                <p className="dropzone__hint">
                  Each upload replaces the previous index. Select multiple files in one go to compare
                  them.
                </p>
                <p className="dropzone__hint">Supported: PDF, DOCX, TXT, CSV</p>
                {files.length > 0 && (
                  <ul className="file-list" aria-label="Files ready to upload">
                    {files.map((file, index) => (
                      <li key={`${file.name}-${file.size}-${index}`} className="file-list__item">
                        <span className="file-chip">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                            <path
                              d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                            <path
                              d="M14 2v6h6M16 13H8M16 17H8M10 9H8"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                          <span className="file-chip__name">{file.name}</span>
                        </span>
                        <span className="file-meta__size">{formatFileSize(file.size)}</span>
                        <button type="button" className="text-btn" onClick={() => removeFileAt(index)}>
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {files.length > 0 && (
                  <button type="button" className="text-btn file-list__clear" onClick={clearSelectedFiles}>
                    Clear selection
                  </button>
                )}
              </div>
              <p className={statusClass}>{uploadStatus}</p>
            </div>

            <div className="server-docs">
              <div className="server-docs__head">
                <p className="server-docs__title">Indexed ({serverDocuments.length})</p>
                <button
                  type="button"
                  className="text-btn"
                  onClick={clearAllDocuments}
                  disabled={loadingClear || serverDocuments.length === 0}
                >
                  {loadingClear ? "Clearing…" : "Clear all"}
                </button>
              </div>
              {serverDocuments.length === 0 ? (
                <p className="server-docs__empty">No documents yet.</p>
              ) : (
                <ul className="server-docs__list" aria-label="Indexed documents">
                  {serverDocuments.map((d) => (
                    <li key={d.doc_id} className="server-docs__item">
                      <span className="server-docs__name" title={d.doc_id}>
                        {d.filename}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="panel" aria-labelledby="ask-heading">
            <h2 id="ask-heading" className="panel__label">
              <span className="panel__step" aria-hidden>
                2
              </span>
              {compareReady ? "Ask or compare" : "Ask a question"}
            </h2>

            {compareReady ? (
              <div className="compare-bar">
                <label className="compare-bar__toggle">
                  <input
                    type="checkbox"
                    checked={compareMode}
                    onChange={(e) => {
                      setCompareMode(e.target.checked);
                      setQuestion("");
                    }}
                  />
                  <span>Compare two documents</span>
                </label>
              </div>
            ) : (
              serverDocuments.length === 1 && (
                <p className="compare-bar__hint compare-bar__hint--solo">
                  Upload <strong>two or more files in one batch</strong> to enable side-by-side compare.
                </p>
              )
            )}

            {compareMode && compareReady && (
              <div className="compare-picks">
                <label className="compare-picks__field">
                  <span className="compare-picks__label">Document A</span>
                  <select
                    className="input-select"
                    value={compareDocA}
                    onChange={(e) => setCompareDocA(e.target.value)}
                    aria-label="First document"
                  >
                    <option value="">Select…</option>
                    {serverDocuments.map((d) => (
                      <option key={d.doc_id} value={d.doc_id}>
                        {d.filename}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="compare-picks__field">
                  <span className="compare-picks__label">Document B</span>
                  <select
                    className="input-select"
                    value={compareDocB}
                    onChange={(e) => setCompareDocB(e.target.value)}
                    aria-label="Second document"
                  >
                    <option value="">Select…</option>
                    {serverDocuments.map((d) => (
                      <option key={d.doc_id} value={d.doc_id}>
                        {d.filename}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            <div className="ask-row">
              <input
                className="input-ask"
                type="text"
                placeholder={
                  compareMode && compareReady
                    ? "e.g. What are the main differences?"
                    : "e.g. Summarize the main points."
                }
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={onQuestionKeyDown}
                aria-label="Your question"
                autoComplete="off"
              />
              <button
                type="button"
                className="btn btn--primary"
                onClick={askQuestion}
                disabled={
                  askDisabled ||
                  (compareMode && compareReady && (!compareDocA || !compareDocB))
                }
              >
                {loadingAsk ? "Asking…" : "Ask"}
              </button>
            </div>
            <p className="prompt-grid__label" id="quick-prompts-label">
              Example prompts — click one, then Ask.
            </p>
            <div
              className="prompt-grid"
              role="group"
              aria-labelledby="quick-prompts-label"
            >
              {quickPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="prompt-chip"
                  onClick={() => setQuestion(prompt)}
                  disabled={loadingAsk}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </section>

          <section className="panel" aria-labelledby="answer-heading">
            <h2 id="answer-heading" className="panel__label">
              <span className="panel__step" aria-hidden>
                3
              </span>
              Answer
            </h2>
            <div className="answer">
              <div className="answer__top">
                <p className="answer__heading">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Response
                </p>
                <div className="answer__actions">
                  {copyStatus && <span className="copy-status">{copyStatus}</span>}
                  <button type="button" className="text-btn" onClick={copyAnswer} disabled={!answer}>
                    Copy
                  </button>
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() => setAnswer("")}
                    disabled={!answer || loadingAsk}
                  >
                    Clear
                  </button>
                </div>
              </div>
              {loadingAsk ? (
                <p className="answer__empty" aria-live="polite">
                  <span className="spinner spinner--dark" style={{ verticalAlign: "middle", marginRight: "0.5rem" }} />
                  Generating an answer…
                </p>
              ) : answer ? (
                <p className="answer__body">{answer}</p>
              ) : (
                <p className="answer__empty">
                  Your answer will show up here after you ask a question.
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default App;
