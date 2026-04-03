import os
from langchain_google_genai import ChatGoogleGenerativeAI
from dotenv import load_dotenv

load_dotenv()

models_to_test = ["gemini-pro", "gemini-1.5-flash", "gemini-2.0-flash", "gemini-flash-latest"]

for m in models_to_test:
    print(f"📡 Testing model: {m}...")
    try:
        llm = ChatGoogleGenerativeAI(model=m, google_api_key=os.getenv("GEMINI_API_KEY"))
        res = llm.invoke("Hi")
        print(f"✅ Success: {m}")
        break
    except Exception as e:
        print(f"❌ Failed {m}: {e}")
