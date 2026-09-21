"""FastAPI application composition for the authenticated research platform."""

from __future__ import annotations

import sys
from pathlib import Path

# Keep imports stable for both `--app-dir backend` and direct module loading.
BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from collections.abc import AsyncIterator  # noqa: E402
from contextlib import asynccontextmanager  # noqa: E402

from app_core.config import bootstrap  # noqa: E402
from app_core.database import check_database  # noqa: E402
from auth.admin_router import router as admin_router  # noqa: E402
from auth.staff_router import router as staff_router  # noqa: E402
from auth.dependencies import get_allowed_origins  # noqa: E402
from auth.env_bootstrap import bootstrap_admin_from_env  # noqa: E402
from auth.router import router as auth_router  # noqa: E402
from fastapi import FastAPI, HTTPException, status  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from interview.router import router as interview_router  # noqa: E402

bootstrap()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    # A fresh deployment may name its first administrator in the environment.
    bootstrap_admin_from_env()
    yield


app = FastAPI(title="Dabom Research Interview API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_allowed_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-CSRF-Token"],
)
app.include_router(auth_router, prefix="/api")
app.include_router(admin_router, prefix="/api")
app.include_router(staff_router, prefix="/api")
app.include_router(interview_router, prefix="/api")


@app.get("/api/health")
async def health() -> dict[str, str]:
    """Return process liveness without probing dependencies."""
    return {"status": "ok"}


@app.get("/api/ready")
def readiness() -> dict[str, str]:
    """Return readiness only while the required PostgreSQL store is available."""
    if not check_database():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="필수 서비스를 사용할 수 없습니다.",
        )
    return {"status": "ready"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8001)
