import os
from datetime import datetime
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(
    title="Fasalytics ML Service",
    description="Agricultural Price Forecasting and Risk Intelligence ML Service",
    version="1.0.0",
)

# CORS Middleware
origins = [
    "http://localhost:3000",
    "http://localhost:5000",
    "http://localhost:5173",
    "http://127.0.0.1:5000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:8000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {
        "service": "fasalytics-ml-service",
        "phase": "Phase 1 - Project Setup & Architecture",
        "version": "1.0.0",
        "status": "online",
        "docs_url": "/docs",
    }

@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "fasalytics-ml-service",
        "version": "1.0.0",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "models_loaded": False,
        "phase": 1,
    }

if __name__ == "__main__":
    import uvicorn
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", 8000))
    print(f"🚀 Starting FASALYTICS ML Service on http://{host}:{port}")
    uvicorn.run("main:app", host=host, port=port, reload=True)
