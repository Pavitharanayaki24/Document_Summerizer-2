from dotenv import load_dotenv
load_dotenv()
from langchain_community.vectorstores import FAISS  # type: ignore
from langchain_huggingface import HuggingFaceEmbeddings  # type: ignore
from openai import OpenAI
import os


client = OpenAI(
    api_key=os.getenv("GROQ_API_KEY"),
    base_url="https://api.groq.com/openai/v1",
)

embeddings = HuggingFaceEmbeddings(
    model_name="sentence-transformers/all-MiniLM-L6-v2"
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
VECTOR_PATH = os.path.join(BASE_DIR, "vector_store")


def get_vectorstore():
    index_faiss = os.path.join(VECTOR_PATH, "index.faiss")
    if not os.path.exists(index_faiss):
        raise Exception("No document uploaded yet.")

    return FAISS.load_local(
        VECTOR_PATH,
        embeddings,
        allow_dangerous_deserialization=True,
    )


def _pick_docs_from_pool(pool, doc_id, k):
    out = []
    for d in pool:
        if (d.metadata or {}).get("doc_id") == doc_id:
            out.append(d)
            if len(out) >= k:
                break
    return out


def format_context_block(docs):
    return "\n\n".join([d.page_content for d in docs])


def retrieve_documents(query, doc_ids_filter=None, k=5):
    vectorstore = get_vectorstore()
    pool = vectorstore.similarity_search(query, k=max(40, k * 8))
    if doc_ids_filter:
        pool = [d for d in pool if (d.metadata or {}).get("doc_id") in doc_ids_filter]
    return pool[:k]


def retrieve_compare_documents(query, doc_id_a, doc_id_b, k_per_doc=4):
    vectorstore = get_vectorstore()
    pool = vectorstore.similarity_search(query, k=120)
    docs_a = _pick_docs_from_pool(pool, doc_id_a, k_per_doc)
    docs_b = _pick_docs_from_pool(pool, doc_id_b, k_per_doc)
    if len(docs_a) < k_per_doc or len(docs_b) < k_per_doc:
        pool = vectorstore.similarity_search(query, k=250)
        docs_a = _pick_docs_from_pool(pool, doc_id_a, k_per_doc)
        docs_b = _pick_docs_from_pool(pool, doc_id_b, k_per_doc)
    label_a = (docs_a[0].metadata or {}).get("filename", "Document A") if docs_a else "Document A"
    label_b = (docs_b[0].metadata or {}).get("filename", "Document B") if docs_b else "Document B"
    return docs_a, docs_b, label_a, label_b


def generate_answer(question, context):

    prompt = f"""
    You are an AI Document Assistant.

    Your responsibilities:
    1. Answer questions based ONLY on the provided document excerpts below.
    2. Provide summaries when requested (bullet points when helpful).
    3. Ensure responses are safe, relevant, and professional.

    ------------------------
    STRICT RULES:
    -  Greeting Handling:
        If the user message is a simple greeting (like "hi", "hello", "hey"):
        → Respond:
        "Hello! How can I assist you with the document(s)?"
    - Use ONLY the information from the DOCUMENT CONTENT below.
    - Do NOT use outside knowledge.
    - Do NOT hallucinate or make up answers.
    - If the answer is not present in the document, respond EXACTLY:
    "This information is not available in the document."

    - If the user asks for a summary:
    → Provide a clear and structured summary (bullet points if possible).

    - If the question is unrelated to the document:
    → Respond:
    "This question is not related to the provided document."

    - If the question is offensive, illegal, harmful, or inappropriate:
    → Respond:
    "I cannot assist with that request."

    ------------------------
    DOCUMENT CONTENT:
    {context}

    QUESTION:
    {question}
    """

    response = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[
            {"role": "user", "content": prompt}
        ],
        temperature=0
    )

    return response.choices[0].message.content


def generate_compare_answer(question, label_a, text_a, label_b, text_b):
    prompt = f"""
    You are an AI Document Assistant comparing two documents.

    Your responsibilities:
    1. Compare and contrast based ONLY on the two excerpts below.
    2. Answer the user's question (similarities, differences, or both as asked).
    3. Be clear which document each point refers to when needed.

    STRICT RULES:
    - Use ONLY the information under DOCUMENT A and DOCUMENT B below.
    - Do NOT use outside knowledge.
    - Do NOT invent content not supported by the excerpts.
    - If the user message is only a greeting, respond:
      "Hello! Ask me to compare these two documents or describe what you want to know."
    - If the question is offensive, illegal, harmful, or inappropriate:
      "I cannot assist with that request."

    ------------------------
    DOCUMENT A ({label_a}):
    {text_a}

    DOCUMENT B ({label_b}):
    {text_b}

    QUESTION:
    {question}
    """

    response = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[
            {"role": "user", "content": prompt}
        ],
        temperature=0
    )

    return response.choices[0].message.content


def ask_question(question, mode="default", doc_ids_filter=None, compare_doc_id_a=None, compare_doc_id_b=None):
    if mode == "compare":
        if not compare_doc_id_a or not compare_doc_id_b:
            raise ValueError("compare_doc_id_a and compare_doc_id_b are required for compare mode.")
        if compare_doc_id_a == compare_doc_id_b:
            raise ValueError("Choose two different documents to compare.")
        docs_a, docs_b, label_a, label_b = retrieve_compare_documents(
            question, compare_doc_id_a, compare_doc_id_b
        )
        text_a = format_context_block(docs_a)
        text_b = format_context_block(docs_b)
        if not text_a.strip() and not text_b.strip():
            return "No matching content was found in the selected documents for this question."
        return generate_compare_answer(question, label_a, text_a, label_b, text_b)

    docs = retrieve_documents(question, doc_ids_filter=doc_ids_filter, k=5)
    context = format_context_block(docs)
    return generate_answer(question, context)


if __name__ == "__main__":
    while True:
        q = input("Ask your question: ")
        if q.lower() == "exit":
            break
        response = ask_question(q)
        print("\nBot:", response)
