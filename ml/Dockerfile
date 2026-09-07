FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install deps first so source edits don't invalidate the dependency layer.
COPY pyproject.toml ./
RUN pip install --upgrade pip && pip install fastapi "uvicorn[standard]" "pydantic>=2" pydantic-settings "psycopg[binary]" redis pytest httpx numpy pandas pyarrow faker scikit-learn xgboost shap joblib matplotlib

# Model B (IndicBERT/MuRIL) needs PyTorch. CPU-only wheels: this service does
# inference on CPU and the fine-tune is small enough not to need a GPU.
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch
RUN pip install transformers sentencepiece protobuf accelerate
# Quantised on-device export for the PWA (spec 7.2).
# ONNX export for the on-device build. onnxruntime + onnxscript directly:
# optimum broke against transformers 5 (cannot import is_offline_mode).
RUN pip install onnxruntime onnxscript onnxconverter-common
# RAG recommendation engine (spec 11): local embeddings + local vector store.
RUN pip install sentence-transformers chromadb pypdf

COPY app ./app
COPY tests ./tests
COPY training ./training
COPY data_gen ./data_gen
COPY data ./data

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
