from dotenv import load_dotenv
load_dotenv()
from langchain_community.vectorstores import FAISS  # type: ignore
from langchain_huggingface import HuggingFaceEmbeddings  # type: ignore
from openai import OpenAI
import os


client = OpenAI(
    api_key=os.getenv("GROQ_API_KEY"), 
    base_url="https://api.groq.com/openai/v1"
)

embeddings = HuggingFaceEmbeddings(
    model_name="sentence-transformers/all-MiniLM-L6-v2"
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
VECTOR_PATH = os.path.join(BASE_DIR, "vector_store")

def get_vectorstore():
    if not os.path.exists(VECTOR_PATH):
        raise Exception("No document uploaded yet.")
    
    return FAISS.load_local(
        VECTOR_PATH,
        embeddings,
        allow_dangerous_deserialization=True
    )

def retrieve_documents(query):
    vectorstore = get_vectorstore()
    docs = vectorstore.similarity_search(query, k=3)
    context = "\n\n".join([doc.page_content for doc in docs])
    return context


def generate_answer(question, context):

    prompt = f"""
    You are an AI Document Assistant.

    Your responsibilities:
    1. Answer questions based ONLY on the provided document.
    2. Provide summaries when requested.
    3. Ensure responses are safe, relevant, and professional.

    ------------------------
    STRICT RULES:
    -  Greeting Handling:
        If the user message is a simple greeting (like "hi", "hello", "hey"):
        → Respond:
        "Hello! How can I assist you with the document?"
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


def ask_question(question):
    context = retrieve_documents(question)
    answer = generate_answer(question, context)
    return answer

if __name__ == "__main__":
    while True:
        q = input("Ask your question: ")
        if q.lower() == "exit":
            break
        response = ask_question(q)
        print("\nBot:", response)
 