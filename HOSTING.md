# Hosting Misfits on the internet

This guide puts the whole project online on one rented server, with HTTPS: the website, both cafe menus, the back office, and guest self check-in. Allow about an hour the first time. Every command is meant to be copied and pasted.

**Contents**

1. [What you're setting up](#1-what-youre-setting-up)
2. [What you need](#2-what-you-need)
3. [Put the code on GitHub](#3-put-the-code-on-github)
4. [Rent the server](#4-rent-the-server)
5. [Point your domain at the server](#5-point-your-domain-at-the-server)
6. [Prepare the server](#6-prepare-the-server)
7. [Download the code onto the server](#7-download-the-code-onto-the-server)
8. [Fill in the settings](#8-fill-in-the-settings)
9. [Start it](#9-start-it)
10. [Set up the app](#10-set-up-the-app)
11. [Backups](#11-backups)
12. [Updating after a code change](#12-updating-after-a-code-change)
13. [When something goes wrong](#13-when-something-goes-wrong)
14. [Security checklist](#14-security-checklist)

---

## 1. What you're setting up

```
Guests, managers, owner
        │  https://yourdomain.com
        ▼
┌─────────────────────────── one server (Ubuntu + Docker) ───────────────────────────┐
│  caddy   HTTPS certificate (free, renews itself), redirects http → https           │
│    │                                                                               │
│  web     nginx: website at /, cafe and back office at /cafe/, API at /api/         │
│    ├── client   the cafe menus, back office and check-in pages                     │
│    └── server   the API, with the database and photos on a Docker volume           │
└────────────────────────────────────────────────────────────────────────────────────┘
```

All your data lives in one place: a Docker volume called `misfits_qr-menu-data`. That is the SQLite database (bookings, expenses, stock, orders, menus, check-ins), the expense bill photos and the guests' ID photos. [Backups](#11-backups) copy exactly that.

## 2. What you need

| What | Notes |
|---|---|
| **A domain** | For example `misfitshostel.com`. If the domain already shows a website hosted somewhere else, pointing it here replaces that site. To keep the old one, use a subdomain such as `book.misfitshostel.com`. |
| **A server (VPS)** | Ubuntu 24.04, **2 GB RAM**, 1–2 CPUs, 25 GB+ disk, in an Indian region so it's fast for guests. Any provider works, for example DigitalOcean (Bangalore), AWS Lightsail (Mumbai) or Google Cloud (Mumbai). Expect roughly US$10–15 a month. Turn on the provider's weekly backups/snapshots if offered. |
| **A GitHub account** | The code goes in a **private** repository so the server can download it. |
| **Razorpay live keys** | Only if guests pay for cafe orders online. Test keys work until your Razorpay KYC is done. |
| **Telegram bot** (optional) | For reminders, the nightly summary and check-in alerts. See `.env.example`. |

## 3. Put the code on GitHub

On your Windows PC, once:

1. On github.com, click **New repository**. Name it `hostel-automation`, choose **Private**, and **don't** add a README or .gitignore.
2. In Git Bash, from the project folder (`D:\hostel`):

   ```bash
   git remote add origin https://github.com/<your-username>/hostel-automation.git
   git push -u origin main
   ```

The `.env` file (your passwords), the Excel sheets, the history-import files and backups are never committed: `.gitignore` excludes them. Check that GitHub doesn't show a `.env` file before you go on.

## 4. Rent the server

Create the server with your provider:

- **Image:** Ubuntu 24.04 LTS
- **Size:** 2 GB RAM (1 GB is too small to build the app)
- **Authentication:** SSH key. If you don't have one, run `ssh-keygen -t ed25519` in Git Bash, press Enter for every question, and paste the contents of `~/.ssh/id_ed25519.pub` into the provider's "SSH key" box.

Note the server's **public IP address**, for example `203.0.113.10`. Connect from Git Bash:

```bash
ssh root@203.0.113.10        # AWS Lightsail: ssh ubuntu@<ip>
```

## 5. Point your domain at the server

Where you bought the domain (GoDaddy, Namecheap, Cloudflare and so on), open its **DNS** settings and add:

| Type | Name | Value |
|---|---|---|
| A | `@` (the domain itself) | your server's IP |
| A | `www` | your server's IP |

(For a subdomain, use its name, for example `book`, and skip `www`.)

Changes usually take effect within minutes but can take a few hours. Check from your PC:

```bash
nslookup yourdomain.com
```

Wait until it answers with your server's IP. **If you use Cloudflare,** set both records to "DNS only" (grey cloud) for the first start, so the HTTPS certificate can be issued.

## 6. Prepare the server

On the server (over `ssh`), paste these blocks one at a time.

**Updates, firewall and automatic security updates:**

```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install git ufw unattended-upgrades
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw --force enable
sudo dpkg-reconfigure -f noninteractive unattended-upgrades
```

**2 GB of swap,** so building the app never runs out of memory:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

**Docker** (official installer):

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

Log out (`exit`) and `ssh` back in so the Docker permission applies. `docker compose version` should now print a version.

## 7. Download the code onto the server

Give the server read-only access to your private repository with a **deploy key**:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/github -N "" -C "misfits-server"
cat ~/.ssh/github.pub
```

On GitHub, go to the repository's **Settings → Deploy keys → Add deploy key**. Paste the line that was printed and leave "Allow write access" **off**. Then:

```bash
printf 'Host github.com\n  IdentityFile ~/.ssh/github\n' >> ~/.ssh/config
git clone git@github.com:<your-username>/hostel-automation.git ~/hostel
cd ~/hostel
```

Answer `yes` if it asks whether to trust github.com.

## 8. Fill in the settings

```bash
cp .env.example .env
chmod 600 .env
nano .env
```

Set these, then save with `Ctrl+O`, `Enter`, `Ctrl+X`:

| Setting | Set it to |
|---|---|
| `DOMAIN` | Add this line: `DOMAIN=yourdomain.com` (no `https://`, no `www`) |
| `PORT` | `127.0.0.1:8080`. This keeps the plain-HTTP port private; everyone comes in through HTTPS. |
| `PUBLIC_BASE_URL` | `https://yourdomain.com/cafe`. Check-in links and printed menu QR codes use this, so it must be right. |
| `ADMIN_PASSWORD` | A long password for the owner sign-in. To generate one, run `openssl rand -base64 18` in another terminal. |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Your live keys (or test keys for now) |
| `TELEGRAM_*` | Optional; the steps are in the file |
| `ID_RETENTION_DAYS` | How long guests' ID photos are kept after check-out (default 365) |

## 9. Start it

Make a short alias for the long Docker command (once):

```bash
echo "alias dc='docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml'" >> ~/.bashrc
source ~/.bashrc
```

Build and start everything. The first build takes 5–10 minutes:

```bash
dc up -d --build
dc ps
```

All four services (`caddy`, `web`, `client`, `server`) should be `Up`, with `server` showing `(healthy)`. Now open **https://yourdomain.com**. The padlock should show, the website should load, and `https://yourdomain.com/manage` should open the back-office sign-in.

If HTTPS doesn't work straight away, see [the certificate question](#13-when-something-goes-wrong).

## 10. Set up the app

1. **Owner sign-in:** go to `https://yourdomain.com/manage` and use the `ADMIN_PASSWORD`.
2. **Managers:** in **Managers**, add one manager per property with a 4–8 digit PIN. Managers sign in at the same address with their name and PIN.
3. **Room rates:** set the walk-in and phone prices in **Room rates**, for each property.
4. **Menus:** fill in **Menu** for one cafe. The other cafe can start from a copy.
5. **QR codes:** print new table QR codes from **QR codes**. Codes printed while testing on the laptop point at the laptop and won't work.
6. **Telegram (if set up):** send test messages from **Notifications**.
7. **Old bookings (optional):** import the history sheet as described in [README → Importing the old bookings sheet](README.md#importing-the-old-bookings-sheet), with `dc exec -T server …` in place of `docker compose exec -T server …`. Copy the JSON file to the server first with `scp`, but **not** into the repository folder.

**Moving data you already entered on the laptop.** Skip this if the laptop only has test data. On the PC, in Git Bash, from `D:\hostel`, with the laptop's Docker running:

```bash
DOMAIN=localhost MSYS_NO_PATHCONV=1 BACKUP_DIR="D:/hostel/backups" bash deploy/backup.sh
scp backups/misfits-*.tar.gz root@<server-ip>:~/hostel/backups/
```

Then on the server: `deploy/restore.sh backups/misfits-<date>.tar.gz`.

## 11. Backups

`deploy/backup.sh` writes one file holding a consistent copy of the database, all bill photos and all ID photos, for example `backups/misfits-2026-10-18-0300.tar.gz`. It's safe to run while the app is in use. It keeps 30 days of files; set `KEEP_DAYS` to change that.

**Run it every night at 3 am:**

```bash
mkdir -p ~/hostel/backups
(crontab -l 2>/dev/null; echo "0 3 * * * cd $HOME/hostel && deploy/backup.sh >> backups/backup.log 2>&1") | crontab -
```

Run it once by hand now to check it works: `deploy/backup.sh`.

**Keep a copy off the server.** A backup on the same server is lost along with the server. Pick at least one:

- **The provider's automatic backups/snapshots.** The simplest option; turn them on in the provider's dashboard.
- **Google Drive or Backblaze B2 with rclone:**
  1. `sudo apt -y install rclone && rclone config`, then follow the prompts to add a remote called `offsite`.
  2. Add the nightly copy:

     ```bash
     (crontab -l; echo "30 3 * * * rclone copy $HOME/hostel/backups offsite:misfits-backups --include 'misfits-*.tar.gz' --max-age 48h") | crontab -
     ```

  Backups contain guests' names, phone numbers and ID photos. Keep the destination private, and consider rclone's `crypt` remote to encrypt them.

**Restoring.** This replaces everything with the backup. It asks you to type `RESTORE` and takes about half a minute:

```bash
cd ~/hostel
deploy/restore.sh backups/misfits-2026-10-18-0300.tar.gz
```

Try a restore once, early on, so you know it works before you need it.

## 12. Updating after a code change

On the PC, commit the change and run `git push`. Then on the server:

```bash
cd ~/hostel
git pull
dc up -d --build
```

Only the changed parts rebuild and restart. The site is unavailable for a few seconds and no data is touched. Database changes (migrations) apply automatically when the server starts. Taking a backup first (`deploy/backup.sh`) is a good habit before larger updates.

## 13. When something goes wrong

| Problem | What to do |
|---|---|
| **See what's running** | `dc ps` |
| **See errors** | `dc logs --tail 100 server`, or `caddy` / `web` in place of `server`. Add `-f` to follow live. |
| **Restart everything** | `dc restart` |
| **No padlock / certificate error** | The domain must point at this server (`nslookup yourdomain.com`), ports 80 and 443 must be open (`sudo ufw status`), and Cloudflare must be "DNS only" for the first certificate. Then `dc restart caddy` and check `dc logs caddy`. |
| **"Bad gateway" (502)** | The app is starting or has stopped. Check `dc ps`. If `server` isn't healthy, check `dc logs server`. |
| **Build fails partway** | Run `dc up -d --build` again. If it keeps failing with "killed", check that swap is on (`free -h`). |
| **Forgot the owner password** | Change `ADMIN_PASSWORD` in `.env`, then `dc up -d`. |
| **"Too many wrong passwords"** | After 10 wrong owner passwords, that address is blocked for 15 minutes. Wait, or `dc restart server`. |
| **A manager is locked out** | After 5 wrong PINs, that manager is blocked for 15 minutes. The owner can also give them a **New PIN** in **Managers**, which unlocks them straight away. |
| **Server disk filling up** | `df -h`. Old Docker build files can be cleared with `docker builder prune -af`; this doesn't touch data. |
| **Check-in links or QR codes open the wrong address** | `PUBLIC_BASE_URL` in `.env` is wrong. Fix it, run `dc up -d`, and print the QR codes again. |

> **Never run `dc down -v` or `docker volume rm`.** The `-v` deletes the data volume, which holds every booking, expense, photo and check-in. `dc down` without `-v` is safe.

## 14. Security checklist

- [ ] `ADMIN_PASSWORD` is long and random, and only the owner knows it.
- [ ] `.env` is `chmod 600` and has never been committed to GitHub.
- [ ] The firewall allows only SSH, 80 and 443 (`sudo ufw status`).
- [ ] `PORT=127.0.0.1:8080` is set in `.env`, so the plain-HTTP port isn't open to the internet.
- [ ] Automatic security updates are on (`unattended-upgrades`, from step 6).
- [ ] SSH accepts keys only. Once your key login works, set `PasswordAuthentication no` in `/etc/ssh/sshd_config` and run `sudo systemctl restart ssh`.
- [ ] Nightly backups run, a copy goes off the server, and a test restore has worked.
- [ ] The GitHub deploy key is read-only, and the repository is private.
- [ ] Managers have their own PINs. When a manager leaves, deactivate them in **Managers**, which also signs them out.
