"""One Sarvam chat-completion call. Reads SARVAM_API_KEY from the environment or .env."""
import os
import sys

from dotenv import load_dotenv
from sarvamai import SarvamAI

load_dotenv()
api_key = os.environ.get("SARVAM_API_KEY", "").strip()
if not api_key:
    sys.exit("SARVAM_API_KEY is not set. Add it to .env first.")

client = SarvamAI(api_subscription_key=api_key)
response = client.chat.completions(
    model="sarvam-105b-conversations",
    messages=[{"role": "user", "content": "Say hello in one short sentence."}],
)
print(response.choices[0].message.content)
