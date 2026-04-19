from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import CORS_ORIGINS
from .api import ensure_audit_schema, ensure_auth_schema, router
from .db import close_pool, open_pool


app = FastAPI(title="WardFlow API", version="0.1.0")

# Accept local dev origins across ports (Live Server/Vite/etc.) and file:// origins (`null`).
local_dev_origin_regex = r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$|^null$"

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS or [],
    allow_origin_regex=local_dev_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.on_event("startup")
def startup() -> None:
    open_pool()
    ensure_auth_schema()
    ensure_audit_schema()


@app.on_event("shutdown")
def shutdown() -> None:
    close_pool()


@app.get("/")
def root() -> dict:
    return {"success": True, "service": "wardflow-api"}
