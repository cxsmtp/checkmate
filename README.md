# Checkmate

**An event experience for CISOs: bring a repository, see what rule-based scanning never showed you, and watch Checkmarx One AI triage and fix it — in minutes, on one page.**

Checkmate is a self-contained, self-updating container for Checkmarx booths and executive briefings. A visitor types two letters of their name, picks their repository, chooses how to scan (the engines and frontier model their tenant offers), watches the scan run, and reads an **Outcome**: the issues **Fusion** found that no rule-based engine reported, explained in plain language, with the application map and risk re-scoring behind them. Then they **close the loop**: one click triages every finding with **Checkmarx One AI Triage**, one click writes the fixes with **AI Remediation**, and one click sends the fixes to their developers.

It needs exactly two things to run live: a **Checkmarx One API key** and **SMTP settings** — both pasted in the admin console or uploaded as a `.env` file, as in CxMissionZero. Nothing else talks to anything else.

> **Real scans by default.** As soon as the API key connects, every scan runs on the Checkmarx One tenant and the report shows its real results (`CX_MODE=auto`). Without a key the booth runs a **demo** with realistic data, so it can be rehearsed anywhere. **AI Triage & Remediation are simulated by default** — the same steps on the real findings, no AI credits spent — until switched to *Live* in Admin → Settings → AI Triage & Remediation (`ASSIST_MODE=live`).

---

## The experience, step by step

| Step | What the visitor sees | What happens underneath |
| --- | --- | --- |
| **Welcome** | The city postcard (real photography, the local time, the landmarks), *See what your scanner is missing*, and one field: *Type your name or company…*. Two letters show the invited profiles; picking one fills in the person, their technical owner and their team. Visitors without a repository pick one of the booth's samples. | `GET /api/profiles/search?q=` (names and companies only, never emails) → `GET /api/profiles/:id/pick` fills the draft. |
| **Repository** | A short, pre-filled form: name, email, company, title; the technical owner (*That's me*); the team as chips; the GitHub URL or a sample; consent. | `POST /api/sessions` → session in stage `options`, profile remembered in the directory, invitations queued. |
| **Scan** | *How should we scan owner/repo?* — the engines the tenant licenses, the **Fusion** switch, the **model list fetched from the tenant** (`scan.config.ai.llmModel`: e.g. `mythos-5.1`, `opus-5.5`, `opus-5.0`, `opus-4.7`, `haiku-4.5`), the SAST preset, and *What will be sent* (the exact `POST /api/scans` body). | `GET /api/configuration/tenant` + `/api/queries/presets` → `POST /api/sessions/:id/start` with the choice. |
| **Running** | The theatre: one row per engine with live status, a Fusion ring with the correlation stage, the team panel to invite colleagues meanwhile. | project → application → scan → poll `/api/scans/{id}` → Fusion `correlate` → poll `scan-status` → `/api/results` + `risk-scores` + application map. |
| **Outcome** | The exposure dial and headline (*Fusion found 4 issues that rule-based scanning did not see, 3 of them critical or high*), tiles, *Where rule-based scanning was blind*, *First moves*, *What Fusion re-scored and why*, *The application Fusion mapped*, then the results laid out as Checkmarx One lays them out (scanner tabs, severity filters, table, details drawer with **Fusion insight**, plain language, attack vector). | `src/outcome.js`, `src/fusion.js`, `src/knowledge.js`. |
| **Close the loop** | *Found. Triaged. Fixed.* — scope (**Fusion-only** / **Critical & high** / **Everything**), **✦ Triage N with AI**, **⚡ Remediate N with AI**, live tickers, verdicts and *Fix ready* in the table, the patch in the drawer (**⚡ AI fix** tab), **Send N fixes to the technical owner**. | `POST /api/ai-triage/triage`, `GET /api/ai-triage/triage/{projectId}/{groupId}`, `POST /api/remediation/remediate`, `GET /api/remediation/remediation-details/{scanId}/{alternateId}` — the contract CxMissionZero uses in production. |
| **Board report** | The ending: a one-page brief for the board — unknown risks uncovered, proven, fixed, exposure before → after, cost effectiveness and return, the process with timestamps, recommendations — printable as PDF and emailed to the team. AI Triage and Remediation run by themselves, so the brief is complete when the results land. | `public/board.js` (shared by the page and the email), `POST /api/sessions/:id/board/send`. |
| **Business impact** | What finding and fixing the gaps now is worth, **in the visitor's currency** (their city: Dubai AED, New York and Boston USD, Singapore SGD, Melbourne AUD; otherwise the browser's country): *Saved*, engineering time, cost avoided after release, real risks closed, Checkmarx One credits. Scope **✦ Fusion gaps** / **Everything found**, and *× 10 / × 50 / × 250 repositories like this one*. Also on the Overview hero. | `public/impact.js` — the arithmetic of CxMissionZero's Impact page and Cx Credits Calculator: 20 min triage and 120 min fix by hand × a fully loaded regional hourly rate; 30% false positives until AI Triage's verdicts replace them; a fix after release costs 6×; credits 1 per triage, 3 per remediation, Fusion per 10K lines (`/api/sast-metadata/{scanId}` → `loc`), priced only when a credit price is set. |

Invitations can be sent at any step; the results link is private to the team.

## Run it

```bash
# Podman (one command; self-updating when AUTO_UPDATE=on)
podman run -d --name checkmate -p 3333:3333 -v checkmate-data:/data \
  --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true \
  --env-file checkmate.env ghcr.io/cxsmtp/checkmate:latest
podman logs checkmate            # the first start prints the admin password

# or Compose
docker compose up -d && docker compose logs checkmate
```

Open `http://<host>:3333` (use `127.0.0.1` rather than `localhost` on Windows if the browser shows an empty response) and `http://<host>:3333/admin`. Everything the app keeps lives in the `/data` volume: settings (secrets mode 0600), profiles, registrations, sample repositories, city photos, installed updates, the activity log.

A systemd (Quadlet) service with daily image updates and automatic rollback is in [deploy/podman/README.md](deploy/podman/README.md); **AWS EC2** (Podman, port 3333, Caddy HTTPS, user-data script) is in [deploy/aws/README.md](deploy/aws/README.md).

### Configure it in two minutes

1. Sign in to `/admin` with the printed password and choose your own.
2. **Settings → Configure from a .env file**: drop a file with `CX_API_KEY`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (the same variables the container takes). The settings apply at once; the Checkmarx One connection and the mail server are checked and the result shown. Or type them into the Checkmarx One and Email sections and use **Test**.
3. The **connection card** shows what was read from the key: tenant, region, API and IAM addresses, expiry. **Scans** is *Automatic* by default: real Checkmarx One scans as soon as the key connects (the card says *Real (Checkmarx One)*). AI Triage & Remediation stay *Simulated* until you switch them to *Live* in the same page.
4. **Profiles**: import the invitee list as CSV (`name, email, company, title, technical_name, technical_email, team, city, tags` — common header names are recognised). Everyone who registers is added automatically.
5. **Branding**: app and company name, logo and icon upload, accent colour or palette, dark/light, the call to action, event name, venue, city theme, and **City photography** (fetched from Wikimedia Commons or uploaded).

## Checkmarx One: what is called, and why

Only the API key is configured; the tenant, IAM and API URLs are derived from the key's issuer (`src/cxone/endpoints.js`, from CxMissionZero). Credentials are sent over HTTPS to `*.checkmarx.net` only, redirects refused (`checkmarx.allowCustomHost` for private deployments).

| Purpose | Call |
| --- | --- |
| Sign in | `POST {iam}/auth/realms/{tenant}/protocol/openid-connect/token` (refresh-token grant, `client_id=ast-app`) |
| What the tenant offers | `GET /api/configuration/tenant` → `scan.config.general.scannersSelection` (engines), `scan.config.ai.fusionEnabled`, `scan.config.ai.llmModel` (the model list), `scan.config.sast.extendedAnalysis`; `GET /api/queries/presets` |
| Project and application | `GET/POST /api/projects` (name `checkmate-<owner>/<repo>`), `GET/POST /api/applications` with a `project.name.in` rule |
| The scan | `POST /api/scans` `{ type: "git", handler: { repoUrl, branch }, config: [ { type: "sast", value: { incremental: "false", presetName?, extendedAnalysis: "true" } }, { type: "sca" }, …, { type: "ai", value: { fusionEnabled: "true", llmModel } } ] }`; `GET /api/scans/{id}` until `Completed` |
| Fusion, application level | `POST {dispatcher}/{applicationId}/correlate` (201), `GET {dispatcher}/{applicationId}/scan-status` → `{ scanStatus, stage 0–100, stageDescription, scanId }`; `GET {results}/applications/{id}/summary`, `/resources`, `/microservices`, `/risk-scores?cxone-scan-ids=` → `{ resultId, vulnerabilityEngine, correlatedEngine, oldRiskValue, newRiskValue, resultInfo }` |
| Results | `GET /api/results?scan-id=` (numbered pages) |
| AI Triage | `POST /api/ai-triage/triage { scanID, buckets: [{ scannerType: "sast"\|"sca", resultIDs: [alternateId…] }] }`; verdicts from `GET /api/ai-triage/triage/{projectId}/{groupId}` (`triageStatus`, `analysis.confidence.score`, reachability, exploitability, reason) |
| AI Remediation | `POST /api/remediation/remediate { scanID, buckets: [{ scannerType, resultIDs: [one] }] }`; the fix from `GET /api/remediation/remediation-details/{scanId}/{alternateId}` (`results[0].data.summary`, `analysis.how/why`, `file_changes[{file_path, diff}]`, `autoPr.url`) |

**Fusion base paths.** The Fusion Dispatcher and Results services' OpenAPI documents (`Fusion-Dispatcher.yaml`, `Fusion-Results.yaml`) define paths relative to a base that is not in the documents. Checkmate probes `/api/fusion-dispatcher`, `/api/fusion/dispatcher`, `/api/fusion-results`, `/api/fusion/results` and a few more, and remembers what answers; set `fusion.dispatcherPath` / `fusion.resultsPath` in Settings once your tenant's are known. Without them the scan still completes; correlation shows *unavailable*.

### How a Fusion finding is recognised

Verified on a tenant (project *Fusion Hub*): Fusion's findings arrive in `/api/results` as `type: "sast"` rows with **`data.queryId === 0`**, a **CWE-title query name** (*Improper Input Validation*, *Authorization Bypass Through User-Controlled Key*…), a group like **`TSX_HIGH`** / `TypeScript_HIGH`, and an empty description. Classic SAST rows have a 64-bit `queryId` and groups like `JavaScript_Low_Visibility`. `src/fusion.js` uses that fingerprint (and, as a fallback, the configurable markers `fusion, ai-sast…` in `type`/engine fields). A Fusion finding is **Fusion-only** unless a rule-based finding has the same weakness in the same file within ±3 lines (source or sink); then the rule-based one is marked *Confirmed by both*.

## Admin console (`/admin`)

| Tab | What it does |
| --- | --- |
| **Registrations** | Every visitor: team and invitation state, repository, scan profile (engines, Fusion model), exposure band, Fusion-only / total, links to the results and to Checkmarx One, **Rescan**, CSV. |
| **Profiles** | The invitee directory behind the type-ahead: add, edit, remove, **CSV import/export**, visits. |
| **Sample repositories** | Repositories visitors can pick; **Scan now**; reuse window. |
| **Branding** | App name, company, logo and icon (upload or https), logo height, accent colour / palette, dark/light/auto, look, call to action, event name, tagline, venue, footer, city theme, location prompt; **City photography** per city: fetch from Wikimedia Commons, upload, remove. |
| **Settings** | **.env upload**; **Checkmarx One** (key, connection card, mode, prefix, branch, GitHub token, timeouts, overrides, **Test connection**); **Scan defaults** (engines, Fusion, default model, extended analysis, preset, visitor choice, extra config); **Fusion** (fingerprint switches, correlation, Dispatcher/Results paths); **AI Triage & Remediation** (on/off, polling, time limit); **Profiles & samples**; **Email** (host, port, user, password, from, team address, TLS options, **Test email**). |
| **Updates & integrity** | Integrity state, published versions, install / switch / roll back, auto-update, restart, launcher events. |
| **Activity** | Sign-ins, settings changes, registrations, scans, AI assist runs, updates, integrity results. |
| **Account** | Change the admin password (`podman exec checkmate node scripts/reset-admin.mjs` if locked out). |

## City themes and photography

Any city in the world. On first open the browser asks once for the position; the server names the city with OpenStreetMap Nominatim (city level; the coordinates are used for that one lookup and never stored), and until then the time zone gives the city. The visitor can also type any city (*Change city*). The page takes the city's real photographs (postcard, and faintly behind every page, crossfading with the photographer's credit), its local time, and — on the Business impact tab — its country's currency. Dubai, New York, Boston, Singapore and Melbourne also have their own palette and drawn skyline. The city is kept with the registration so invited colleagues see the same. The server needs outbound HTTPS to `nominatim.openstreetmap.org`, `commons.wikimedia.org` and `upload.wikimedia.org` for this; without it the time zone and the drawn skyline are used.

Photos come from **Wikimedia Commons** — Creative Commons / public-domain only, landscape, 1600 px and wider, author and licence recorded — fetched the first time a visitor from a city arrives (and for the five drawn cities at first start) when the server can reach `commons.wikimedia.org` / `upload.wikimedia.org` (`CITY_PHOTOS_AUTO=true`), or for any city from Branding → City photography; the booth team can also upload their own. Without photos the hand-drawn skyline (`public/themes.js`) is shown, so the page never depends on the internet.

## Auto-update and software integrity

Ported from CxMissionZero (`src/integrity/`, `src/updates/`, `src/launch.js`):

- Every push to `main` builds, smoke-tests and publishes `ghcr.io/cxsmtp/checkmate:<1.0.N>`, `:latest`; `integrity.json` (SHA-256 of every file) and the image are signed with a GitHub build attestation (Sigstore). A running container with `AUTO_UPDATE=on` checks every 5 minutes, downloads only the app layers, verifies every file against the signed list, switches without a restart and rolls back by itself if the new version does not come up.
- Hardened container: read-only root, no capabilities, `no-new-privileges`, non-root, `tini`. Strict CSP, rate limiting, `HttpOnly`/`SameSite=Strict` admin sessions, scrypt, unguessable result links, append-only activity log.
- **Public repository:** the repository is public, so GitHub signs every release and containers verify it. (On a private repository GitHub issues build attestations only on Enterprise Cloud; the publish job then warns and skips signing, and containers refuse unsigned updates.) The image itself must be public too for a booth to pull it without a token: GitHub → Packages → `checkmate` → Package settings → *Change visibility*; otherwise set `UPDATE_REGISTRY_TOKEN` / `GITHUB_READ_TOKEN` (`read:packages`).

## Settings reference

Every setting has an environment default and can be changed in `/admin` (or by `.env` upload); the admin's value wins and is kept in `/data/settings.json`.

| Group | Variables |
| --- | --- |
| Event & branding | `EVENT_NAME`, `EVENT_TAGLINE`, `EVENT_VENUE`, `PUBLIC_BASE_URL`, `CX_MODE` (auto\|live, default auto: real scans whenever the key is set), `DEFAULT_CITY`, `ASK_LOCATION`, `SAMPLE_REUSE_HOURS`, `BRAND_APP_NAME`, `BRAND_COMPANY`, `BRAND_LOGO_URL`, `BRAND_ICON_URL`, `BRAND_MARK`, `BRAND_LOGO_HEIGHT`, `BRAND_ACCENT`, `BRAND_ACCENT_NAME`, `BRAND_LOOK`, `BRAND_THEME`, `BRAND_CTA`, `BRAND_FOOTER`, `CITY_PHOTOS_AUTO` |
| Checkmarx One | `CX_API_KEY` (secret), `CX_BASE_URL` / `CX_IAM_URL` / `CX_TENANT` (overrides; normally derived from the key), `CX_PROJECT_PREFIX`, `CX_DEFAULT_BRANCH`, `CX_POLL_INTERVAL_MS`, `CX_SCAN_TIMEOUT_MS`, `CX_GITHUB_TOKEN` (secret), `CX_ALLOW_CUSTOM_HOST` |
| Scan | `CX_ENGINES` (default `sast,sca`), `CX_FUSION`, `CX_FUSION_LLM_MODEL`, `CX_SAST_EXTENDED_ANALYSIS`, `CX_SAST_PRESET`, `SCAN_LET_VISITOR_CHOOSE`, `CX_FUSION_SCAN_CONFIG` (extra JSON entries) |
| Fusion | `FUSION_RESULT_MARKERS`, `FUSION_QUERY_ID_ZERO`, `FUSION_CORRELATE`, `FUSION_DISPATCHER_PATH`, `FUSION_RESULTS_PATH`, `FUSION_TIMEOUT_MS` |
| AI assist | `ASSIST_MODE` (simulated\|live, default simulated), `ASSIST_ENABLED`, `ASSIST_POLL_INTERVAL_MS`, `ASSIST_TIMEOUT_MS` |
| Business impact | `IMPACT_ENABLED`, `IMPACT_TRIAGE_MINUTES` (20), `IMPACT_FIX_MINUTES` (120), `IMPACT_FP_PERCENT` (30), `IMPACT_RELEASE_MULTIPLIER` (6), `IMPACT_RATES` (JSON: currency, engineer per hour, one credit — default USD 25 / USD 1), `IMPACT_TRIAGE_CREDITS` (1), `IMPACT_REMEDIATION_CREDITS` (3), `IMPACT_FUSION_CREDITS_PER_10K`, `ASSIST_AUTO_RUN` |
| Profiles & samples | `PROFILES_LOOKUP`, `PROFILES_MIN_CHARS`, `SAMPLES_AUTO_SCAN` (scan samples when added), `SAMPLE_REUSE_HOURS` (refresh after, 168) |
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_REQUIRE_AUTH`, `SMTP_REJECT_UNAUTHORIZED`, `SMTP_USER`, `SMTP_PASS` (secret; `SMTP_PASSWORD` accepted), `SMTP_FROM` (`SMTP_FROM_ADDRESS` accepted), `SMTP_FROM_NAME`, `TEAM_NOTIFY_EMAIL` |
| Container | `PORT`, `HOST`, `DATA_DIR`, `TRUST_PROXY`, `ADMIN_PASSWORD`, `AUTO_UPDATE`, `UPDATE_CHECK_MINUTES`, `UPDATE_IMAGE`, `UPDATE_REGISTRY_TOKEN`, `GITHUB_READ_TOKEN`, `INTEGRITY_CHECK_HOURS` |

Without SMTP, every email (invitations, *results are ready*, the developer brief with patches) is written to `/data/outbox/` as JSON.

## Development

```bash
npm install
npm start          # http://localhost:3333; demo without CX_API_KEY (5 fictional profiles seeded), real scans with it
npm test           # 42 tests, including the whole live flow against a Checkmarx One stand-in (test/helpers/mock-cxone.mjs)
```

```
src/server.js        Express app: visitor API, AI assist, admin API, pages
src/scanRunner.js    options → profile → project/application → scan → poll → Fusion correlate → results → outcome → email
src/checkmarx.js     Checkmarx One: tenant options, scan config, projects, applications, scans, results, Fusion services
src/cxone/           Endpoints from the API key, token provider, HTTP client with retries and pagination (CxMissionZero)
src/assist.js        AI Triage and AI Remediation: live calls, demo simulation, scopes, developer brief data
src/fusion.js        Result normalisation, the Fusion fingerprint, Fusion-only classification
src/outcome.js       Exposure score, blind spots, first moves, headline and verdict
src/knowledge.js     Plain-language templates per weakness (Fusion's own insight first)
src/profiles.js      The invitee directory: search, pick, CSV, demo seed
src/cities.js        City photography: Wikimedia Commons fetch, uploads, credits
src/config.js        Settings schema, env defaults, admin overrides, connection derivation
src/env-import.js    .env upload → settings
src/mailer.js        Branded invitation, results and developer-brief emails
src/integrity/ src/updates/ src/launch.js   Signed file list, Sigstore verification, self-update with rollback
public/app.js        The visitor experience (vanilla JS, no build)   public/admin.js  The admin console
public/themes.js     City palettes, skylines, photo rotation          public/styles.css  Command-center look
REQUIREMENTS.md      The full requirement set, written to be handed to another engine
```
