import os

from dotenv import load_dotenv

load_dotenv()

API_BASE: str = os.getenv("SLOGIN_API_BASE", "https://app.simplelogin.io")
API_KEY: str = os.getenv("SLOGIN_API_KEY", "")
ALIASES_PER_PAGE: int = int(os.getenv("SLOGIN_ALIASES_PER_PAGE", 20))
RATE_LIMIT: int = int(os.getenv("SLOGIN_RATE_LIMIT", 50))  # requests per minute
