# Checkmate event scanner

A single-page app for Checkmate events. At the booth, an attendee:

1. Fills in their **name and email**, a **technical contact**, at least **two operations points of contact**, and a **GitHub repository URL**.
2. Submits the form. The backend creates or reuses a project on the **Checkmarx One** tenant and starts a scan with **Fusion** switched on.
3. Watches the scan progress on the same page. When results come back, the page shows:
   - an **executive summary**: headline, overall risk, key risks, next steps, and what Fusion added;
   - **Found only by Checkmarx Fusion** at the top: Fusion findings that no rule-based (deterministic) engine reported;
   - **All other findings** below, filterable by engine and severity, with findings that Fusion also found marked **Confirmed by Fusion**.
4. Each finding is explained in plain language, under *What it means*, *Business impact*, *How to fix* and, for Fusion-only findings, *Why only Fusion caught this*. The raw engine details sit in an expandable section.
5. Can invite the points of contact, or anyone else by email, at any time from the **Your team** panel. This works during the scan too.

## Quick start

```bash
npm install
cp .env.example .env      # demo mode by default
npm start                 # http://localhost:3000
npm test
```

**Demo mode** (`CX_MODE=demo`, the default) simulates a scan of about 15 seconds with realistic sample findings, so you can rehearse the booth flow without a tenant.

**Live mode** (`CX_MODE=live`) needs `CX_TENANT` plus either `CX_API_KEY` or `CX_CLIENT_ID`/`CX_CLIENT_SECRET`, and the correct regional `CX_BASE_URL`/`CX_IAM_URL`.

## How Fusion-only findings are identified

`src/fusion.js` normalises every Checkmarx One result. A result counts as **Fusion** when its `type`, or an engine/source field, contains one of `FUSION_RESULT_MARKERS`. A Fusion finding is **Fusion-only** unless a deterministic finding has the same weakness (same CWE, or same query name) in the same file within ±3 lines. Both the source and the sink of a data flow are compared. When a match exists, the deterministic finding is shown with a *Confirmed by Fusion* badge instead.

> **Check against your tenant:** set `CX_FUSION_SCAN_CONFIG` to the scan configuration that turns Fusion on, and `FUSION_RESULT_MARKERS` to whatever marks Fusion results in `/api/results` on your tenant.

## Plain-language explanations

- With `ANTHROPIC_API_KEY` set, Claude writes the per-finding explanations (Fusion-only findings first, then by severity, up to `EXPLAIN_MAX_FINDINGS`) and the executive summary, using structured JSON output.
- Without a key, or if a call fails, a built-in knowledge base (`src/knowledge.js`, keyed by CWE and keywords) supplies the explanations, so the page always has something readable.

## Email

Invitations and "results ready" emails go out over SMTP when `SMTP_HOST` is set. Otherwise they are written to `data/outbox/` so nothing is lost. `TEAM_NOTIFY_EMAIL` receives a copy of every registration.

## Access and data

- Each registration gets a random access key. The results link (`/s/<id>?k=<key>`) is the only way to view it, and it is what invitees receive.
- Registrations are stored as JSON files in `data/sessions/`. Treat that folder as customer data.
- Registrations and invites are rate-limited per IP. Scans that were in flight are resumed when the server restarts.

## Layout

```
src/server.js      Express app and API routes
src/scanRunner.js  Orchestrates: project -> scan -> poll -> results -> classify -> explain -> email
src/checkmarx.js   Checkmarx One REST client
src/fusion.js      Normalisation and Fusion-only classification
src/explain.js     Claude explanations and executive summary
src/knowledge.js   Built-in plain-language fallback
src/mailer.js      Invitations and notifications
src/demo.js        Sample results for demo mode
public/            Front end (vanilla JS, no build step)
```
