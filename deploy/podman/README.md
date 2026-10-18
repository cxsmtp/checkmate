# Running Checkmate with Podman, self-updating

Once it is set up, the booth machine needs no attention:

| What | How it stays current, and running |
| --- | --- |
| **App releases** (every push to `main`) | The container checks every 5 minutes (`AUTO_UPDATE=on`). It downloads only the app's files, checks every file against the release's signed file list, and switches without a restart. If the new version doesn't come up, it goes back by itself. |
| **Whole image** (Node.js and OS security fixes) | Linux: `podman-auto-update.timer` pulls a newer `:latest` daily and rolls back if it fails. Windows/macOS: one `podman pull` now and then (below). |
| **Crashes and reboots** | Restarted by systemd (Linux) or Podman's restart policy. An unhealthy container is restarted. All data stays in the `checkmate-data` volume. |

## Before the first run (once)

1. **A published image.** The workflow publishes `ghcr.io/cxsmtp/checkmate` on every push to `main`. Create `main` from the current branch and let the **Container image** workflow finish (Actions tab).
2. **Signed releases.** The container only installs updates signed by this repository's workflow. GitHub signs builds of a *private* repository only on GitHub Enterprise Cloud. Make the repository public, or move it to an Enterprise Cloud organisation. Otherwise every update is refused (Admin → Updates & integrity says why).
3. **A token for the private image.** Create a GitHub personal access token (classic) with `read:packages`. Use it for `podman login` and in the env file as `UPDATE_REGISTRY_TOKEN` and `GITHUB_READ_TOKEN`.
4. **Network.** The machine needs outbound HTTPS to `ghcr.io`, `pkg-containers.githubusercontent.com`, `api.github.com`, your Checkmarx One host, and (for the city photographs) `commons.wikimedia.org` and `upload.wikimedia.org`.

## Linux: a systemd service (Quadlet), recommended

Needs Podman 4.6 or later (`podman --version`). Rootless, as your normal user:

```bash
# 1. Sign in to the registry (stored for your user; podman auto-update uses it too)
podman login ghcr.io -u <github-user>          # password: the token

# 2. Settings
mkdir -p ~/.config/checkmate ~/.config/containers/systemd
cp deploy/podman/checkmate.env.example ~/.config/checkmate/checkmate.env
chmod 600 ~/.config/checkmate/checkmate.env
nano ~/.config/checkmate/checkmate.env          # tokens, TZ, PUBLIC_BASE_URL, ...

# 3. The service
cp deploy/podman/checkmate.container ~/.config/containers/systemd/
systemctl --user daemon-reload
systemctl --user start checkmate

# 4. Keep it running without anyone signed in, and across reboots
sudo loginctl enable-linger "$USER"

# 5. Whole-image updates, daily
systemctl --user enable --now podman-auto-update.timer
```

The admin password is printed once on first start:

```bash
podman logs checkmate | grep -A1 "Admin panel"
```

Then open `http://<machine>:3000` (registration) and `http://<machine>:3000/admin`.

## Windows or macOS (Podman Desktop / podman machine)

One line at a time in a terminal (Windows: `cmd` or PowerShell), from the folder with your `checkmate.env`:

```
podman machine init --now
podman login ghcr.io -u <github-user>
podman volume create checkmate-data
podman run -d --name checkmate --restart=always -p 3000:3000 -v checkmate-data:/data --env-file checkmate.env --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true --health-cmd "node scripts/healthcheck.mjs" --health-interval 30s --health-on-failure kill ghcr.io/cxsmtp/checkmate:latest
podman logs checkmate
```

- `podman machine init --now` is needed only once. Skip it if Podman Desktop already has a running machine.
- `--health-cmd` is given here because Podman ignores health checks stored in OCI images.
- **After a reboot:** turn on the Podman machine's auto-start in Podman Desktop's settings. The container comes back with the machine (`--restart=always`). To check that the restart service is on inside the machine:
  ```
  podman machine ssh systemctl --user is-enabled podman-restart.service
  ```
  If it prints `disabled`, run `podman machine ssh systemctl --user enable podman-restart.service`.
- **Whole-image updates** (rare): pull, then recreate the container with the same `run` line, with `--replace` added after `-d`:
  ```
  podman pull ghcr.io/cxsmtp/checkmate:latest
  ```
  App releases still install by themselves in between.

## Check that it updates itself

- **Admin → Updates & integrity** shows:
  - the running version and the integrity state (*Genuine* when the files match a signed release);
  - *Auto-update: On* and what the last look found;
  - every published version, with **Switch to** for rolling back by hand.
- In the log, an update looks like:
  ```
  [launch] Switching from v1.0.41 to v1.0.42.
  Stopped cleanly.
  [launch] Starting v1.0.42 (installed from the Update page).
  ```
- The files in the running container against their signed list:
  ```
  podman exec checkmate node scripts/integrity.mjs check
  ```
- Linux: `podman auto-update --dry-run` shows whether a newer image is waiting.

## HTTPS (needed for the location themes)

Browsers only share location over HTTPS. Without it, the city list still works. Put a reverse proxy in front: Caddy obtains certificates by itself. Set `PUBLIC_BASE_URL=https://<your name>` and `TRUST_PROXY=<the proxy's address>` in the env file.

## If something is wrong

| Symptom | Cause / fix |
| --- | --- |
| *Not signed by the release workflow*; updates refused | The repository can't get GitHub signatures (step 2 above). |
| *Not confirmed yet*; updates wait | `api.github.com` is unreachable: allow it through the firewall or proxy. |
| *Could not reach ghcr.io* or a 401 | The token is missing or lacks `read:packages`: check `UPDATE_REGISTRY_TOKEN` and `podman login`. |
| *Auto-update: Off* | Set `AUTO_UPDATE=on` in the env file and restart, or use the switch in the admin panel. |
| A release that failed to start | Rolled back automatically, and never auto-installed again. Fix forward with the next push. |
| Forgot the admin password | `podman exec checkmate node scripts/reset-admin.mjs` |
