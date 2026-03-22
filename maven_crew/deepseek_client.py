import os
import json
import requests
from dotenv import load_dotenv

load_dotenv()

class DeepSeekMoEClient:
    """
    Optimized client for DeepSeek MoE.
    Targets local vLLM or Ollama endpoints to reduce biological drag.
    """
    def __init__(self, base_url=None):
        self.base_url = base_url or os.getenv("DEEPSEEK_API_URL", "http://localhost:11434/v1")
        self.api_key = os.getenv("DEEPSEEK_API_KEY", "ollama") # Default for local
        self.model = os.getenv("DEEPSEEK_MODEL", "deepseek-moe:16b")

    def chat_completion(self, messages, temperature=0.7, max_tokens=1024):
        url = f"{self.base_url}/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}"
        }
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens
        }
        
        try:
            response = requests.post(url, headers=headers, json=payload, timeout=60)
            response.raise_for_status()
            return response.json()
        except Exception as e:
            return {"error": str(e)}

    def generate(self, prompt, temperature=0.7, max_tokens=1024):
        messages = [{"role": "user", "content": prompt}]
        result = self.chat_completion(messages, temperature, max_tokens)
        if "error" in result:
            return f"Error: {result['error']}"
        return result["choices"][0]["message"]["content"]

if __name__ == "__main__":
    client = DeepSeekMoEClient()
    print("Testing DeepSeek MoE Connection...")
    test_prompt = "Hello, System Pilot. Are you online?"
    print(f"Prompt: {test_prompt}")
    print(f"Response: {client.generate(test_prompt)}")
