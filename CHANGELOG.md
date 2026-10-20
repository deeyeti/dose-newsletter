# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-20

### Added
- **Frame.io V4 Integration**:
  - Implemented `file.ready` webhook receiver endpoint (`POST /api/webhooks/frameio`).
  - Added HMAC-SHA256 constant-time signature verification with a 5-minute replay window guard.
  - Added idempotent event deduplication and asset ID deduplication against local database.
  - Implemented manual folder polling for newest file retrieval in `FRAMEIO_FOLDER_ID`.
- **Audio Processing Pipeline**:
  - Added FFprobe 90-second duration guard rejecting oversized files safely.
  - Added FFmpeg audio extraction producing 16 kHz mono FLAC attachments.
  - Isolated temporary storage handling in OS temp directory with guaranteed cleanup.
- **Groq Speech-to-Text**:
  - Direct integration with Groq transcription API using `whisper-large-v3-turbo`.
  - Added safe error handling and 25 MB payload threshold guarding against URL leaks.
- **Claude Editorial Drafting**:
  - Messages API adapter with strict JSON response schema validation.
  - Added support for Claude Opus (`claude-3-opus-20240229`) and Sonnet models.
  - Added optional `anthropic-workspace-id` header support for personal / unscoped user keys.
  - Strict Dose of Society human-interest editorial constraints (no made-up facts or ungrounded quotes).
- **Email Delivery Safety**:
  - Resend email provider adapter with single-send idempotency locking.
  - Explicit human approval required before sending; no automated broadcasts.
- **Persistent Storage**:
  - Persistent SQLite storage utilizing Node 24 native `node:sqlite`.
  - Normalized schema for jobs, webhook events, transcripts, drafts, email audit logs, and status transitions.
- **Editorial Review Dashboard**:
  - Real-time Next.js App Router interface displaying job progress, live statuses, and full event histories.
  - Interactive draft editor with live email preview and recipient confirmation.
  - Labelled sample mode allowing complete pipeline UI testing without third-party API calls.
- **DevOps & CI/CD**:
  - Ngrok tunnel integration for rapid local webhook testing.
  - GitHub Actions CI pipeline executing ESLint, unit/integration tests, and production build checks.
  - Automated Release pipeline generating versioned GitHub Releases with changelog notes.
