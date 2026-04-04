from langchain_community.document_loaders import PyPDFLoader # type: ignore
from langchain_text_splitters import RecursiveCharacterTextSplitter # type: ignore
from langchain_huggingface import HuggingFaceEmbeddings # type: ignore
from langchain_community.vectorstores import FAISS # type: ignore
import os

from langchain_community.document_loaders import Docx2txtLoader
from langchain_community.document_loaders import TextLoader
from langchain_community.document_loaders import CSVLoader

def load_document(file_path):
    ext = os.path.splitext(file_path)[1].lower()

    if ext == ".pdf":
        loader = PyPDFLoader(file_path)
        

    elif ext == ".docx":
        loader = Docx2txtLoader(file_path)

    elif ext == ".txt":
        loader = TextLoader(file_path)

    elif ext == ".csv":
        loader = CSVLoader(file_path)

    else:
        raise ValueError("Unsupported file format")

    documents = loader.load()
    return documents



def chunk_documents(documents):
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=500,
        chunk_overlap=50
    )
    chunks = splitter.split_documents(documents)
    return chunks

def create_embeddings():
    embeddings = HuggingFaceEmbeddings(
        model_name="sentence-transformers/all-MiniLM-L6-v2"
    )
    return embeddings

def store_in_vector_db(chunks, embeddings):
    vectorstore = FAISS.from_documents(chunks, embeddings)
    vectorstore.save_local("vector_store")
    return vectorstore

def ingest_pipeline():
    
    file_path = r"P:\HR-policy bot\backend\fruitsandvegetable.pdf"

    print("Loading document")
    documents = load_document(file_path)

    print("Chunking documents")
    chunks = chunk_documents(documents)

    print("Creating embeddings")
    embeddings = create_embeddings()

    print("Storing in FAISS vector database")
    store_in_vector_db(chunks, embeddings)

    print("Ingestion completed successfully!")


if __name__ == "__main__":
    ingest_pipeline()