# 🛡️ SENTINEL

**Stress Evaluation & Notification Through Integrated Longitudinal analysis**

![SIH 2026](https://img.shields.io/badge/SIH-2026-blue)
![Problem Statement](https://img.shields.io/badge/PS-SIH26186-orange)
![Theme](https://img.shields.io/badge/Theme-MedTech%2FBioTech%2FHealthTech-green)

> **Smart India Hackathon 2026** | Ministry of Home Affairs, CRPF Police-II Division (PS: SIH26186)

SENTINEL turns manual, self-report-only stress detection into a proactive, privacy-first early-warning system without ever turning HR data into individual surveillance.

## 📑 Table of Contents

- [Project Overview](#-project-overview)
- [System Architecture (The Three Surfaces)](#-system-architecture-the-three-surfaces)
- [Technology Stack](#-technology-stack)
- [Machine Learning Design](#-machine-learning-design)
- [Privacy & Security Features](#-privacy--security-features)
- [Getting Started / Installation](#-getting-started--installation)

---

## 🚀 Project Overview

Developed for **SIH 2026 (Problem Statement SIH26186)**, SENTINEL is a comprehensive software platform designed for CAPF personnel. It identifies potential mental health and stress risks by fusing structured HR behavioral signals with natural language processing (NLP) of self-reported assessments, all while strictly adhering to privacy protocols like k-anonymity and database-level Row-Level Security (RLS).

---

## 🏗️ System Architecture (The Three Surfaces)

SENTINEL is built across three primary surfaces to ensure data isolation and role-specific functionality:

1. **Surface 1: Personnel Companion (PWA)**
   - A voluntary, installable Next.js mobile-first Progressive Web App (PWA).
   - Features weekly wellness check-ins (adapted PHQ-9/GAD-7 style), free-text journals, and voice notes.
   - Offline-capable with on-device pre-processing to ensure raw sensitive data never leaves the device.
2. **Surface 2: Welfare Officer Dashboard (Web)**
   - Role-gated Next.js dashboard specifically for designated Welfare Officers (not disciplinary staff).
   - Shows aggregated cohort-level risk trends.
   - Enforces k-anonymity; individual alerts are only unlocked when specific thresholds and conditions are met.
3. **Surface 3: Risk Inference Service (Backend ML API)**
   - Python FastAPI microservice that processes HR signals and NLP inputs.
   - Returns probabilistic risk bands with SHAP-powered explanations (never a raw binary label).

---

## 💻 Technology Stack

### Frontend (Dashboard & PWA)

- **Framework:** Next.js 15 (App Router) & React 19
- **Language:** TypeScript
- **Styling & UI:** Tailwind CSS, shadcn/ui, Recharts
- **PWA Capabilities:** next-pwa / Workbox

### Backend & API Gateway

- **API Framework:** Next.js Route Handlers / tRPC
- **Authentication:** NextAuth.js (Auth.js) with custom RBAC middleware
- **Database & ORM:** PostgreSQL 16 (utilizing Row-Level Security), Prisma or Drizzle ORM
- **Caching/Queuing:** Redis

### Machine Learning & AI Inference

- **Service Layer:** Python 3.12, FastAPI, Pydantic
- **Model A (Structured Risk):** XGBoost, scikit-learn, SHAP (TreeExplainer)
- **Model B (NLP Distress):** Hugging Face Transformers (IndicBERT/MuRIL fine-tuned), PyTorch
- **Welfare RAG Engine:** LangChain/LlamaIndex, Chroma/FAISS

### DevOps & Deployment

- **Containerization:** Docker Compose (Demo-optimized)
- **CI/CD:** GitHub Actions
- **Hosting:** Vercel (Frontend), Railway/Render (FastAPI & Postgres)

---

## 🧠 Machine Learning Design

SENTINEL utilizes a **Two-Model-Plus-Fusion** architecture:

- **Model A (Behavioral Risk):** Uses XGBoost to analyze time-windowed HR data (leave patterns, deployment durations, transfers). It outputs a probabilistic risk band accompanied by SHAP category-level feature attribution.
- **Model B (Self-Assessment NLP):** Uses a fine-tuned IndicBERT model to classify distress signals from multilingual text and transcribed voice notes.
- **Fusion Layer:** Combines both models with a calibrated logistic rule. A self-reported distress signal from Model B can override a "normal" HR baseline from Model A, preventing false negatives.
- **Welfare Recommendation Engine (RAG):** Uses LangChain to ground LLM-drafted intervention suggestions in actual organizational welfare policy documents, preventing hallucinations.

---

## 🔒 Privacy & Security Features

SENTINEL is built with privacy as the core architectural constraint (DPDP Act 2023 compliant):

- **Role-Based Access Control (RBAC):** NextAuth middleware ensures strict role separation (Personnel, Welfare Officer, Commander).
- **Row-Level Security (RLS):** Database-enforced data isolation by role.
- **k-anonymity Bucketing:** Dashboards refuse to render cohorts below a minimum threshold (e.g., < 10) to prevent individual isolation.
- **Encryption:** AES-256 field-level encryption for all sensitive text and biometric-adjacent data at rest.
- **Differential Privacy:** Statistical noise applied to aggregate dashboard metrics.

---

## 🛠️ Getting Started / Installation

### Prerequisites

- Docker & Docker Compose
- Node.js (v18+)
- Python 3.12+

### Local Setup (Demo Mode)

1. **Clone the repository**

   ```bash
   git clone https://github.com/your-org/sentinel-sih2026.git
   cd sentinel-sih2026
   ```

2. **Environment Configuration**
   Copy the example environment files and fill in your keys.

   ```bash
   cp .env.example .env
   ```

3. **Run the Synthetic Data Generator**
   (Generates calibrated CAPF operational HR data for the demo)

   ```bash
   cd ml-service
   python generate_synthetic_hr_data.py
   ```

4. **Spin up the stack**
   ```bash
   docker-compose up --build
   ```
