# Checkmate — requirements

This document states everything Checkmate is required to do, in enough detail to be handed to another engineering team or code-generation engine and reproduced. It is the requirement set as of this version; the README describes how the current implementation meets it.

## 1. Purpose and audience

1.1. Checkmate is an **event experience** run at Checkmarx booths and executive briefings. Its audience is **CISOs and technology executives**, with their engineering owners and operations contacts as secondary users.
1.2. Its one message: **Checkmarx Fusion finds classes of issues rule-based scanning never reports, and Checkmarx One AI closes the loop by triaging and fixing them — in minutes.**
1.3. It must feel like a **product experience, not a web form**: no empty space, no typing an executive would refuse, every screen telling the story, "next-gen" visual quality on a booth screen (dark, large type, motion where it carries meaning).
1.4. It must be **self-sufficient**: one container, one data volume, no build step, no external services beyond Checkmarx One, SMTP and (optionally) Wikimedia Commons for photographs.

## 2. Dependencies and constraints

2.1. **Checkmarx One only.** Scans, Fusion, triage and remediation are done by the configured Checkmarx One tenant. No other AI vendor or API key is used anywhere.
2.2. The only configuration needed for live operation is a **Checkmarx One API key** and **SMTP settings**. Both must be settable in the admin console and importable from a `.env` file (the same variables the container accepts), exactly as CxMissionZero does.
2.3. Tenant, region, IAM URL and API URL must be **derived from the API key** (JWT issuer). Manual overrides are allowed but not required.
2.4. Credentials go only over HTTPS to `*.checkmarx.net` (override for private deployments), redirects refused. Secrets are never returned to any browser, stored mode 0600 in the data volume.
2.5. Everything must work **offline from the internet** except the calls to Checkmarx One and SMTP: fonts shipped, no CDN, photographs optional with a drawn fallback.
2.6. Runtime: Node.js ≥ 20 (ESM), Express; front end in vanilla JavaScript without a build; DOM built from text nodes (no `innerHTML` from data).

## 3. People and profiles

3.1. A **profile directory** of everyone invited: name, email, company, title, technical owner (name, email), team (name, email, role), city, repositories, tags, phone, notes; source (admin / CSV / registration / demo), created time, visit count.
3.2. Admin: add, edit, remove; **CSV import** with header aliases (`name|full name`, `email|work email`, `company|organisation|account`, `title|job title|role`, `technical_name`, `technical_email`, `team|colleagues|invitees` (addresses split on `;`, `,`, spaces), `city|location`, `tags`, `phone`, `notes`); rows with an existing email update the profile; **CSV export**.
3.3. **Type-ahead on the welcome screen**: after `profiles.minChars` letters (default 2) of a name or company, show matching profiles as cards (initials, name, title · company, "Invited" / "Welcome back"). The search endpoint returns **no email addresses**. Picking a card fills the person, the technical owner, the team and remembered repositories; the visitor only adds the repository URL and consents.
3.4. Every registration **updates the directory** (new people added, known ones updated; never replaced wholesale). In demo mode five clearly fictional profiles are seeded when the directory is empty.

## 4. The visitor flow

4.1. **City prompt** on first open per device: share location (coordinates never leave the browser; nearest of Dubai, New York, Boston, Singapore, Melbourne within 300 km) or pick a city; "Not now" allowed; remembered per device; an event-wide city can be fixed in settings and the prompt switched off. HTTPS is needed for geolocation; over http the prompt explains and offers the list.
4.2. **Welcome**: brand, steps indicator (You · Repository · Scan · Running · Outcome), tenant chip (connected / demo / not connected), city chip, version; headline, call to action, the type-ahead field, "I'm new here", three proof points; postcard (photo/skyline, greeting, city name, landmarks, local clock, Change city); "Scanning with" panel (Fusion + engines); sample repositories.
4.3. **Details**: name, email, company, title; technical owner with "That's me"; team as chips with add/remove (at least two operations contacts required); repository URL or a sample chip (samples need no URL or consent); branch; consent; "email my team now". Server-side validation with field-level errors. Rate limited.
4.4. **Scan profile**: read from the tenant (`/api/configuration/tenant`, `/api/queries/presets`): engines the tenant licenses with recommended defaults; Fusion switch (disabled if the tenant has no Fusion); **the LLM model list from `scan.config.ai.llmModel`** with the tenant default pre-selected; SAST preset; live preview of the exact scan request. The booth team can disable visitor choice (`scan.letVisitorChoose`). In demo mode a realistic option set is shown.
4.5. **Running**: per-engine rows with Queued / Running / Completed, elapsed time, Fusion correlation ring with stage percentage and description, the team panel; polling every ~3 s; survives page reloads and server restarts (in-flight scans resume).
4.6. **Outcome** (section 6) and **Close the loop** (section 7).
4.7. **Invitations** at any step: name + email, "Invite all", resend; delivery state shown per person; up to a configurable maximum; the results link is unguessable and private to the team.

## 5. Scanning on Checkmarx One

5.1. Project per repository: `checkmarx.projectPrefix + owner/repo`, created with `repoUrl`, `mainBranch`, origin tag; reused when it exists. An **application** per project (rule `project.name.in`) so application-level Fusion can run.
5.2. Scan request `POST /api/scans`: `{ type: "git", handler: { repoUrl, branch, credentials? }, config: [...] }` where config carries one entry per chosen engine, the SAST entry `{ incremental: "false", presetName?, extendedAnalysis: "true" when enabled }`, and when Fusion is on `{ type: "ai", value: { fusionEnabled: "true", llmModel } }` (keys verified against the tenant's own configuration: `scan.config.ai.fusionEnabled`, `scan.config.ai.llmModel`, `scan.config.sast.extendedAnalysis`). Extra entries from `scan.extraConfig` are merged last. A GitHub token may be supplied for private repositories.
5.3. Poll `GET /api/scans/{id}` at `checkmarx.pollIntervalMs` until a terminal status or `checkmarx.scanTimeoutMs`; per-engine status from `statusDetails`.
5.4. **Fusion, application level** (from the Fusion Dispatcher and Fusion Results OpenAPI documents): after the scan, `POST {dispatcher}/{applicationId}/correlate` (201 Created), poll `GET {dispatcher}/{applicationId}/scan-status` → `{ scanStatus: Unknown|Started|In Progress|Completed|Failed, stage 0–100, stageDescription, errorMessage, scanId }` until Completed/Failed or `fusion.timeoutMs`; then `GET {results}/applications/{applicationId}/risk-scores?cxone-scan-ids={scanId}` → `{ results: [{ resultId, fusionScanId, vulnerabilityEngine, correlatedEngine, oldRiskValue, newRiskValue, scanId, resultInfo, projectId }] }`, and the application map from `/summary`, `/resources`, `/microservices`. The services' base paths are not in the documents: probe a list of candidates and remember the one that answers; allow them to be set explicitly; the scan must still complete when they are unavailable (correlation marked unavailable, never an error for the visitor).
5.5. Results: `GET /api/results?scan-id=` paged (page-numbered offsets), normalised to one shape: id, similarityId, **alternateId**, engine, underlying type, title, severity, state, status, CWE, CVE, CVSS, file/line, sink file/line, language, package, recommended version, description, **Fusion insight**, expected/actual, first found, data-flow nodes.
5.6. **Fusion fingerprint**: a `type: "sast"` row with `data.queryId === 0`, a CWE-title `queryName` and a group matching `^[A-Za-z#+.]+_(CRITICAL|HIGH|MEDIUM|LOW|INFO)$` is a Fusion result (switchable), as are rows whose type/engine fields contain a configured marker. A Fusion finding is **Fusion-only** unless a rule-based finding has the same weakness (CWE or query) in the same file within ±3 lines at source or sink; then the rule-based one is **confirmed by both**.
5.7. Risk-score changes are attached to findings by `resultId` as `correlation { oldRisk, newRisk, direction raised|lowered|unchanged, with, reason }`.
5.8. Sample repositories: the newest completed scan is reused for `sampleReuseHours` (results shown instantly), then a fresh scan is started; the admin can "Scan now".

## 6. The Outcome

6.1. An **exposure score** (0–100) and band (Low / Moderate / High / Critical) from Fusion-only findings weighted by severity, correlation raises, public resources; a **headline** ("Fusion found N issues in owner/repo that rule-based scanning did not see, M of them critical or high") and a **verdict** paragraph naming the blind themes.
6.2. Tiles: found only by Fusion (click filters the table), total, per severity, confirmed by both.
6.3. **Where rule-based scanning was blind**: themes (access control & authorisation, business logic & race conditions, authentication, injection, secrets, configuration, dependencies…) with worst severity and Fusion-only counts.
6.4. **First moves**: three to five concrete next actions derived from the findings.
6.5. **What Fusion re-scored, and why**: old → new risk with the reason and the correlated engine; click opens the finding.
6.6. **The application Fusion mapped**: services, cloud resources, public ones highlighted.
6.7. **Results as Checkmarx One lays them out**: scanner tabs with counts (Fusion first), severity filters, "Found only by Fusion" filter, search, table (severity, vulnerability with plain-language title and tags, scanner, language, location, risk after correlation, **AI** column, state), and a details drawer with tabs **✦ Fusion insight** (never reported by rule-based scanning — which engines ran and missed it; what Fusion determined; risk after correlation; why rules miss this; business impact; how to fix; where it happens), **Plain language**, **Attack vector**, **Details**, plus **✦ AI Triage** and **⚡ AI fix** once they exist.
6.8. Plain-language text uses Fusion's own insight when present, else templates keyed by CWE and keywords; no external AI.
6.9. Emails: invitation, "results are ready" (headline, counts, exposure band, link), developer brief (section 7.6); branded with the configured name, logo, accent and footer.

## 7. Closing the loop: AI Triage and AI Remediation

7.1. On the Outcome page, a **Close the loop** panel: *Found → Triaged by AI → Fixed by AI → With developers* with live counts; a **scope** selector — **Fusion-only** (default), **Critical & high**, **Everything** — each with its count; **✦ Triage N with AI** and **⚡ Remediate N with AI** buttons; while running, progress bars and a live ticker of findings being reasoned about / fixed; afterwards a verdict summary (vulnerable / not exploitable / uncertain) and a fix summary (fixes, files changed).
7.2. Eligibility: SAST and SCA findings (Fusion results are SAST results); others are reported as not actionable by AI with the reason.
7.3. **AI Triage (live)**: `POST /api/ai-triage/triage { scanID, buckets: [{ scannerType: "sast"|"sca", resultIDs: [alternateId…] }] }` once per run; then poll `GET /api/ai-triage/triage/{projectId}/{groupId}` (groupId = similarityId for SAST; `similarityId#-#packageIdentifier#-#projectId` for SCA) until `triageStatus` leaves `IN_PROGRESS|NOT_TRIAGED|PENDING|QUEUED|RUNNING|TO_VERIFY`; keep verdict, confidence (`analysis.confidence.score`), reachability, exploitability and the first non-empty reason field. Verdict words: Vulnerable, Confirmed, Urgent, Uncertain, Probably not exploitable, Not exploitable, Risk accepted, Triage failed.
7.4. **AI Remediation (live)**: one `POST /api/remediation/remediate { scanID, buckets: [{ scannerType, resultIDs: [alternateId] }] }` per finding (stop on 402/403 and say why); poll `GET /api/remediation/remediation-details/{scanId}/{alternateId}` until `results[0]` has `finishedAt`, `data.summary` or `file_changes`, or fails; keep summary, how, why, `file_changes[{file_path, diff, analysis}]`, tests, pull-request URL (http(s) only). Findings triaged not exploitable are skipped; fixes already written are kept.
7.5. **Demo mode** runs the same stages, timings and data shapes against a simulation (deterministic per finding): Fusion-only → Vulnerable with high confidence and Fusion's insight as the reason; lowered risk → Probably not exploitable with the correlation reason; one secure-pattern fix per weakness class as a unified diff on the finding's file and line.
7.6. **Send fixes to developers**: one email to the technical owner (plus optional addresses) with every fix — title, severity, location, verdict, fix, how, why, PR link, and the patch with git headers (`git apply`). Delivery state is kept and shown.
7.7. In the table, an **AI** column shows the verdict (with confidence) and *Fix ready*; the drawer shows **✦ AI Triage** (verdict, reachability, exploitability, why) and **⚡ AI fix** (summary, how, why, per-file diff with added/removed lines coloured, tests, copy patch, PR link).
7.8. Runs survive reloads (state is on the session); a server restart marks a running job failed with a clear message. Rate limited; off switch and time limits in settings. All runs audited.
7.9. Credits are not metered by Checkmate (the environment is for executives); the live mode spends the tenant's AI credits and says so in Settings.

## 8. Branding, theming and photography

8.1. Branding settings (as CxMissionZero): app name, company name, logo (https or uploaded ≤ 300 KB data URL), icon, logo height, accent colour (hex) or palette (ink, lagoon, sage, plum, ochre, **city** = follows the visitor's city), dark / light / auto, look (command-center / classic), call to action, event name, tagline, venue, footer. A live header preview in the admin; applied to the page, the tab icon and emails.
8.2. **City themes**: per-city accent and sky colours; hand-drawn skyline SVGs of each city's landmarks as the fallback; greeting, landmarks, time zone clock.
8.3. **Real photography**: per city up to six photos in the data volume with credit and source. Fetched from **Wikimedia Commons** (search per landmark, JPEG, width ≥ 1600, landscape, licence CC BY / CC BY-SA / CC0 / public domain only, author and licence recorded) in the background at first start when missing (switchable) and on demand per city from the admin; uploads (JPEG/PNG/WebP ≤ 4 MB) and removal. Shown in the postcard and faintly behind every page, crossfading every 9 s with the credit line; the skyline shows when there are none. Served from the app's own origin (CSP `img-src 'self'`).

## 9. Admin console

9.1. Password sign-in (generated on first start, printed once; forced change; reset script), `HttpOnly`/`SameSite=Strict` session, rate-limited login, scrypt.
9.2. Tabs: Registrations (with scan profile, exposure, Fusion-only/total, rescan, CSV), Profiles, Sample repositories, Branding (+ City photography), Settings (+ `.env` upload with applied/ignored report and connection/mail checks; connection card: key set, tenant, region, API, expiry, mode, problem; test buttons), Updates & integrity, Activity, Account.
9.3. Every setting in section 10 is editable; secrets show set / not set and are never returned; validation errors are field-specific.

## 10. Settings (environment default → admin override)

Event: `EVENT_NAME`, `EVENT_TAGLINE`, `EVENT_VENUE`, `PUBLIC_BASE_URL`, `CX_MODE` demo|live, `SAMPLE_REUSE_HOURS`, `DEFAULT_CITY`, `ASK_LOCATION`.
Branding: `BRAND_APP_NAME`, `BRAND_COMPANY`, `BRAND_LOGO_URL`, `BRAND_ICON_URL`, `BRAND_LOGO_HEIGHT`, `BRAND_ACCENT`, `BRAND_ACCENT_NAME`, `BRAND_LOOK`, `BRAND_THEME`, `BRAND_CTA`, `BRAND_FOOTER`; `CITY_PHOTOS_AUTO`.
Checkmarx One: `CX_API_KEY` (secret), `CX_BASE_URL`, `CX_IAM_URL`, `CX_TENANT` (overrides), `CX_PROJECT_PREFIX`, `CX_DEFAULT_BRANCH`, `CX_POLL_INTERVAL_MS`, `CX_SCAN_TIMEOUT_MS`, `CX_GITHUB_TOKEN` (secret), `CX_ALLOW_CUSTOM_HOST`.
Scan: `CX_ENGINES`, `CX_FUSION`, `CX_FUSION_LLM_MODEL`, `CX_SAST_EXTENDED_ANALYSIS`, `CX_SAST_PRESET`, `SCAN_LET_VISITOR_CHOOSE`, `CX_FUSION_SCAN_CONFIG` (JSON array).
Fusion: `FUSION_RESULT_MARKERS`, `FUSION_QUERY_ID_ZERO`, `FUSION_CORRELATE`, `FUSION_DISPATCHER_PATH`, `FUSION_RESULTS_PATH`, `FUSION_TIMEOUT_MS`.
AI assist: `ASSIST_ENABLED`, `ASSIST_POLL_INTERVAL_MS`, `ASSIST_TIMEOUT_MS`.
Profiles: `PROFILES_LOOKUP`, `PROFILES_MIN_CHARS`.
Email: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_REQUIRE_AUTH`, `SMTP_REJECT_UNAUTHORIZED`, `SMTP_USER`, `SMTP_PASS` (secret; alias `SMTP_PASSWORD`), `SMTP_FROM` (alias `SMTP_FROM_ADDRESS`), `SMTP_FROM_NAME`, `TEAM_NOTIFY_EMAIL`.
Container: `PORT`, `HOST`, `DATA_DIR`, `TRUST_PROXY`, `ADMIN_PASSWORD`, `AUTO_UPDATE`, `UPDATE_CHECK_MINUTES`, `UPDATE_IMAGE`, `UPDATE_REGISTRY_TOKEN`, `GITHUB_READ_TOKEN`, `INTEGRITY_CHECK_HOURS`, `UPDATE_START_TIMEOUT_SECONDS`.

## 11. Container, updates, integrity

11.1. Multi-stage Alpine image, non-root, read-only root filesystem, no capabilities, `no-new-privileges`, `tini`, health check; one volume `/data`.
11.2. Every push to `main` runs tests, builds amd64+arm64, smoke-tests the hardened container, publishes `ghcr.io/cxsmtp/checkmate:<major.minor.run>`, `:latest`, `:sha-…`, and signs `integrity.json` and the image with a GitHub build attestation (Sigstore). Private repositories without Enterprise Cloud: the signing step is skipped with a warning.
11.3. The running container checks for updates every `UPDATE_CHECK_MINUTES` when `AUTO_UPDATE=on`, downloads only the app layers, verifies every file against the signed list and the list's attestation (Sigstore root, repository, workflow, branch/tag, digest, transparency log), switches without restart, rolls back if the new version does not become healthy, never retries a version that failed. Integrity states: Genuine, Files changed, Not signed by the release workflow, Not confirmed yet, Development copy.
11.4. Podman: one-line `podman run`; a Quadlet systemd service with `podman-auto-update` for the base image; Windows/macOS instructions.
11.5. Branch protection on `main`; the published image pullable by the booth with a `read:packages` token while the repository is private.

## 12. Security and privacy

Strict CSP (`default-src 'self'`, `img-src 'self' data: https:`), security headers, rate limits on registration, invitations, profile search and AI runs, same-origin check on admin changes, unguessable session keys compared in constant time, geolocation never sent to the server, profile search without emails, secrets never echoed, append-only audit log of sign-ins, settings, registrations, scans, AI runs, updates and integrity results.

## 13. Quality

13.1. Unit tests for the Fusion fingerprint and classification, scan config, outcome, knowledge templates, profiles and CSV, `.env` import, settings validation, AI assist parsers and scopes, integrity and update logic.
13.2. A browser end-to-end rehearsal of the whole visitor flow and the admin console in demo mode (city → type-ahead → details → scan profile → running → outcome → triage → remediate → send), at desktop and phone widths, with no console errors.
13.3. Live verification against a tenant requires the API key in the admin console; the Fusion service base paths must be confirmed on that tenant.
