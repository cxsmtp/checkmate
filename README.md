# Checkmate event scanner

A self-contained container for Checkmate events. At the booth, a visitor:

1. Fills in their **name and email**, a **technical contact**, at least **two operations points of contact**, and a **GitHub repository URL**. Visitors without a repository can **pick one of the sample repositories** the booth team manages in the admin panel.
2. Submits the form. The app creates or reuses a project on the **Checkmarx One** tenant and starts a scan with **Fusion** switched on. A sample that was scanned recently shows its results at once.
3. Sees the results on the same page, laid out like the **Checkmarx One results view**: scan bar, scanner tabs, severity filters, results table, and a details drawer. Fusion findings that no rule-based engine reported are pinned to the top and highlighted. Their **Fusion insight** tab shows what Fusion determined, which engines missed it, why rule-based tools miss this kind of issue, the business impact, the fix and the data flow.
4. Reads an **executive summary** and, for every finding, a plain-language explanation for executives and engineers alike.
5. Invites the points of contact, or anyone else, by email at any time.

## Run it

```bash
docker compose up -d                 # or: podman compose up -d
docker compose logs checkmate        # the first start prints the admin password
```

Or with one command:

```bash
docker run -d --name checkmate -p 3000:3000 -v checkmate-data:/data \
  --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true \
  -e AUTO_UPDATE=on ghcr.io/cxsmtp/checkmate:latest
```

**Podman, self-updating** (a systemd service on Linux; Podman Desktop on Windows/macOS): see [deploy/podman/README.md](deploy/podman/README.md).

Open `http://<host>:3000` for the registration page and `http://<host>:3000/admin` for the admin panel. Everything the app keeps (registrations, settings, sample repositories, installed updates, the activity log) is in the `/data` volume.

The default mode is **demo**: a simulated scan with sample findings, for rehearsing the booth. Switch to **live** under *Admin → Settings* once the Checkmarx One tenant is configured, and use **Test Checkmarx One connection** to check it.

## City themes

When the registration page opens, a visitor sees **Make it feel like home**. They can share their location or pick their city, and the whole experience takes that city's colours and skyline: the registration page, the results view, the Fusion highlights and the scan bar.

| City | Skyline |
| --- | --- |
| Dubai | Dubai Frame · Burj Khalifa · Museum of the Future · Burj Al Arab, with palms and dunes |
| New York | Statue of Liberty · Empire State · Chrysler · One World Trade · Brooklyn Bridge |
| Boston | Old State House · Custom House Tower · Prudential · Hancock · Zakim Bridge |
| Singapore | Supertree Grove · Marina Bay Sands · ArtScience Museum · Merlion · Singapore Flyer |
| Melbourne | Shrine of Remembrance · Flinders Street Station · Eureka Tower · Royal Exhibition Building |

- **Privacy:** the coordinates never leave the browser. The page picks the nearest city (within 300 km), and only that city's name is stored with the registration. That is why invited colleagues see the same theme.
- **Without location:** the browser's time zone suggests a city, and the visitor can pick one or choose *Not now*. The answer is remembered on that device, so a booth kiosk asks once.
- **Event-wide city:** *Admin → Settings → City theme* fixes one city for the whole event, and the location prompt can be switched off there.
- **HTTPS required:** browsers only share location over HTTPS (or `localhost`). Serve the booth through an HTTPS reverse proxy. Over plain http the prompt explains this and offers the city list instead.
- **Drawings:** the skylines are hand-drawn SVG in `public/themes.js`. There are no external images to load or license, and the page works offline. Adding a city means one entry there and one colour block in `styles.css`.

## Admin panel (`/admin`)

| Tab | What it does |
| --- | --- |
| Registrations | Every visitor, their team and invitation status, scan status, a link to their results, and a link to the scan in Checkmarx One. Download as CSV. |
| Sample repositories | Add, edit, hide or remove the repositories visitors can pick. **Scan now** runs a fresh scan. Visitors reuse the newest completed scan of a sample for `sampleReuseHours` (default 24; 0 always rescans). Seeded with `cxsmtp/juice-shop`, `cxsmtp/WebGoat` and `cxsmtp/NodeGoat`. |
| Settings | Event, Checkmarx One tenant, Fusion scan configuration, Claude explanations, email. Applied immediately. Secrets are kept in `/data` (mode 0600) and never shown again. |
| Updates & integrity | Integrity state, published versions, install, switch or roll back, auto-update on/off, restart, launcher events. |
| Activity log | Sign-ins, settings changes, registrations, updates and integrity results. |
| Account | Change the admin password. |

The first admin password is generated on first start, printed once in the log and kept in `/data/first-admin-password.txt` until changed. Set `ADMIN_PASSWORD` to choose it instead. Locked out? `docker exec checkmate node scripts/reset-admin.mjs`.

## Auto-update: from a push to `main` to the running booth

```
push to main ──► GitHub Actions ──► unit tests, image build, hardened smoke test
                                 └► publish ghcr.io/cxsmtp/checkmate:<1.0.N>, :latest, :sha-…
                                 └► sign integrity.json and the image (GitHub attestation, Sigstore log)
running container (AUTO_UPDATE=on) ──► every UPDATE_CHECK_MINUTES (5) looks for a newer version
                                   └► downloads only the app layers, checks each against its sha256
                                   └► checks every file against integrity.json and that list's signature
                                   └► backup, then switches without restarting the container
                                   └► rolls back by itself if the new version does not come up
```

- Every push to `main` is a release: the version is `major.minor` from `package.json` plus the workflow run number.
- Auto-update is **off unless you turn it on**, with `AUTO_UPDATE=on` (as in `compose.yaml`) or the switch in the admin panel. A version that once failed to start is never installed automatically again.
- A new Node.js or OS base (rare) needs the image itself replaced: `docker compose pull && docker compose up -d`.

## Software integrity

Ported from CxMissionZero (`src/integrity/`, `src/updates/`, `src/launch.js`):

- **The file list.** The image build writes `integrity.json`, the SHA-256 of every file the server runs. The release workflow checks it is identical on amd64 and arm64, then signs it with a GitHub build attestation recorded in Sigstore's public transparency log.
- **The running copy is checked** at start, every 6 hours and on demand. Every file is compared with the list. The list's attestation is fetched from `api.github.com` and verified on the server, with no outside library: Sigstore root, the `cxsmtp/checkmate` `container.yml` workflow on `main` or a `v*` tag, the signature, the subject digest and the transparency log entry. The states are Genuine, Files changed, Not signed by the release workflow, Not confirmed yet, and Development copy.
- **Updates are refused** unless every file matches the signed list and the signature checks out. Installed versions are checked again before they run.
- **Container hardening:** read-only root filesystem, no Linux capabilities, `no-new-privileges`, non-root user, no package manager in the runtime image, and `tini` for clean stops.
- **Checkmarx One credentials** are only ever sent over HTTPS to `*.checkmarx.net`, with redirects refused. Set `CX_ALLOW_CUSTOM_HOST=true` for a private deployment.
- **App security:** strict CSP and security headers, rate limiting, admin sessions in `HttpOnly` / `SameSite=Strict` cookies, a same-origin check on admin changes, scrypt password hashing, unguessable result links, and an append-only activity log.

Check it yourself:

```bash
docker exec checkmate node scripts/integrity.mjs check
gh attestation verify oci://ghcr.io/cxsmtp/checkmate:latest --owner cxsmtp
```

> **The repository is private.** GitHub only issues build attestations for private repositories on GitHub Enterprise Cloud. Without it, the signing steps in the workflow fail, and running containers report **Not signed by the release workflow** and refuse updates. Either make the repository public (as CxMissionZero is) or use an Enterprise Cloud organisation. Reading a private image and its attestations also needs a token with `read:packages`: set `UPDATE_REGISTRY_TOKEN` and `GITHUB_READ_TOKEN`.

## How Fusion-only findings are identified

`src/fusion.js` normalises every Checkmarx One result. A result counts as **Fusion** when its `type`, or an engine/source field, contains one of the Fusion markers (Settings). A Fusion finding is **Fusion-only** unless a deterministic finding has the same weakness (same CWE, or same query name) in the same file within ±3 lines, comparing both the source and the sink of the data flow. When there is such a match, the deterministic finding is marked **Confirmed by Fusion** instead.

> **Check against your tenant:** set the Fusion scan configuration and markers (Admin → Settings → Fusion) to what your tenant uses.

## Plain-language explanations

With an Anthropic API key (Settings or `ANTHROPIC_API_KEY`), Claude writes the per-finding explanations (Fusion-only findings first, then by severity) and the executive summary. Without a key, or if a call fails, a built-in knowledge base keyed by CWE and keywords is used.

## Email

Invitations and "results ready" emails go out over SMTP when it is configured (Settings or `SMTP_*`). Otherwise they are written to `/data/outbox/`. A team address can be copied on every registration.

## Development

```bash
npm install
npm start          # http://localhost:3000, data in ./data
npm test
```

## Layout

```
src/server.js        Express app: public API, admin API, start/stop
src/launch.js        Container start command: runs the chosen version, switches, rolls back
src/scanRunner.js    project -> scan -> poll -> results -> classify -> explain -> email
src/checkmarx.js     Checkmarx One REST client
src/fusion.js        Normalisation and Fusion-only classification
src/explain.js       Claude explanations and executive summary
src/knowledge.js     Built-in plain-language fallback
src/samples.js       Sample repositories
src/admin-auth.js    Admin password and sessions
src/config.js        Environment defaults + settings saved from the admin panel
src/integrity/       File list, Sigstore verification, integrity service
src/updates/         Registry client, installed versions, update service
public/              Registration page, results view, admin panel (vanilla JS)
.github/workflows/   Build, smoke test, publish and sign
```
