# Checkmate on an EC2 instance (Podman, self-updating, port 3333)

One small instance, Podman as a systemd service, the published image on **port 3333**, Caddy in front for automatic HTTPS. Everything keeps itself current: app releases from inside the container (signed, every 5 minutes, rollback on failure) and the whole image daily through `podman-auto-update`. Data stays in the `checkmate-data` volume across all of it.

## 1. Before you launch

| Need | Why |
| --- | --- |
| **A DNS name** (e.g. `checkmate.yourcompany.com`) | Browsers share location only over HTTPS; invitation emails carry the public link; Caddy needs the name for its Let's Encrypt certificate. |
| **An Elastic IP** | So the A record survives stops/starts. Allocate it first and point the A record at it. |
| **Instance** | `t3.small` / `t4g.small` (2 GB), 20 GB gp3; Amazon Linux 2023 or Ubuntu 24.04; x86_64 or arm64 (the image is multi-arch). |
| **Security group** | Inbound **443/tcp** and **80/tcp** (certificate issuance) from anywhere, **3333/tcp** only if you want to reach the app directly over http from your own IP, **22/tcp** from your IP. Outbound: all. |

## 2. Launch with user data

1. Open [user-data.sh](user-data.sh); set `DOMAIN`, `ACME_EMAIL`, `TZ_NAME` at the top.
2. EC2 → Launch instance → *Advanced details → User data* → paste it. Launch; associate the Elastic IP.
3. Two minutes later:
   ```bash
   ssh ec2-user@<elastic-ip>                  # ubuntu@ on Ubuntu
   sudo podman logs checkmate | grep -A1 'Admin panel'
   sudo systemctl status checkmate caddy podman-auto-update.timer
   ```
4. Open `https://<DOMAIN>/admin` (or `http://<elastic-ip>:3333/admin` if you opened 3333), sign in and choose your own password.

What the script leaves on the instance:

```
/etc/checkmate/checkmate.env                 settings (chmod 600)
/etc/checkmate/Caddyfile                     HTTPS front
/etc/containers/systemd/checkmate.container  Quadlet → checkmate.service (port 3333)
/etc/containers/systemd/caddy.container      Quadlet → caddy.service (80/443 → 127.0.0.1:3333)
podman-auto-update.timer                     daily image refresh with rollback
```

## 3. By hand instead

```bash
sudo dnf -y install podman            # Ubuntu: sudo apt-get install -y podman uidmap
sudo mkdir -p /etc/checkmate /etc/containers/systemd
B=https://raw.githubusercontent.com/cxsmtp/checkmate/main/deploy/aws
sudo curl -fsSL $B/checkmate.env.example -o /etc/checkmate/checkmate.env && sudo chmod 600 /etc/checkmate/checkmate.env
sudo nano /etc/checkmate/checkmate.env        # DOMAIN, ACME_EMAIL, PUBLIC_BASE_URL, TZ
sudo curl -fsSL $B/Caddyfile -o /etc/checkmate/Caddyfile
sudo curl -fsSL $B/checkmate.container -o /etc/containers/systemd/checkmate.container
sudo curl -fsSL $B/caddy.container -o /etc/containers/systemd/caddy.container
sudo systemctl daemon-reload && sudo systemctl start checkmate caddy
sudo systemctl enable --now podman-auto-update.timer
sudo podman logs checkmate
```

Another port: change `PublishPort=3333:3000` in `checkmate.container` and `reverse_proxy 127.0.0.1:3333` in the Caddyfile, then `systemctl daemon-reload && systemctl restart checkmate caddy`.

## 4. Configure the booth (in the browser)

1. `https://<DOMAIN>/admin` → **Settings → Configure from a .env file**: drop a file with `CX_API_KEY` and `SMTP_*` (or type them in and press **Test**). The connection card shows the tenant and region read from the key.
2. **Mode** → *live*.
3. **Profiles** → import the invitee CSV. **Branding** → logo, names, city; city photographs are fetched at first start.
4. Run one real scan on a sample repository to confirm the Fusion service base paths on your tenant (Settings → Fusion if the probe reports them unavailable).

## 5. Staying current, checking, backing up

- Admin → **Updates & integrity**: running version, **Genuine**, *Auto-update: On*, every published version with **Switch to** (rollback by hand).
- `sudo podman auto-update --dry-run` — is a newer image waiting; `sudo podman exec checkmate node scripts/integrity.mjs check` — the running files against their signed list.
- Backup: `sudo podman volume export checkmate-data -o checkmate-data.tar` (restore with `podman volume import`).
- Logs: `sudo journalctl -u checkmate -f`, `sudo podman logs caddy`.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `https://<DOMAIN>` times out | Security group 80/443; A record → Elastic IP; `sudo podman logs caddy` (certificate request). DNS not propagated yet → Caddy retries. |
| App reachable on 3333 but not via HTTPS | `systemctl status caddy`; the Caddyfile forwards to `127.0.0.1:3333` on the host network. |
| "Checkmarx One is not connected" in the log | Paste the API key under Settings; the card shows why if the key is refused. Outbound 443 to `*.checkmarx.net` needed. |
| Location prompt says HTTPS required | You opened the IP:3333 (http). Use the DNS name. |
| Emails land in `/data/outbox` | SMTP not configured or **Test email** failed; EC2 blocks port 25 — use 587/465. |
| Admin password lost | `sudo podman exec checkmate node scripts/reset-admin.mjs` |
