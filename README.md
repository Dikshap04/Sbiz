# Sbiz Website + HR Assistant

A small Flask site with an HR resume assistant built on the Claude API.
Upload a resume (PDF, DOCX, or TXT) and ask questions about it, or upload a
second resume to compare two candidates.

## Project structure

```
app.py                       Flask routes and the in-memory session store
utils/resume_parser.py       Extracts text from PDF / DOCX / TXT uploads
utils/hr_agent.py            Builds the screening/chat prompts and calls the Claude API
utils/engagement_agent.py    Drafts candidate engagement emails and sends them via SMTP
templates/                    Jinja templates (home, about, HR assistant, engagement)
static/                       CSS and JS
requirements.txt
Procfile                      Tells Render how to start the app
render.yaml                   Optional one-click Render Blueprint
```

## Engagement Agent

Once a resume is screened on the **HR Agent** tab, head to the **Engagement**
tab to keep selected candidates warm between offer and start date:

1. Tick "engage" on a candidate, confirm their email (auto-extracted from the
   resume where possible) and joining date.
2. Pick an update type — offer confirmation, countdown to day one, culture
   preview, pre-boarding logistics, or a personal check-in — add optional
   talking points, and generate a draft. Claude personalises it using the
   candidate's resume and avoids repeating angles already sent.
3. Review/edit the draft, then send it.
4. Every update is logged to that candidate's timeline and included as a
   third sheet ("Engagement Log") in the exported HR report.

**Sending real email** requires SMTP credentials as environment variables:

- `SMTP_HOST`, `SMTP_PORT` (defaults to 587), `SMTP_USERNAME`, `SMTP_PASSWORD`
- `FROM_EMAIL` (defaults to `SMTP_USERNAME`), `FROM_NAME` (defaults to
  "Sbiz Talent Team")

If these aren't set, sends are **simulated**: the draft is still saved to the
candidate's timeline and included in exports, clearly marked as simulated, so
the feature is fully demoable without a mail server.

**Seeing candidate replies** uses IMAP to poll the same inbox. Click
"Check for replies" on the Engagement tab to pull in any new messages from
engaged candidates — matched by their email address — and log them onto the
timeline (and into the export) as inbound entries. This reuses `SMTP_USERNAME`
/ `SMTP_PASSWORD`, so no extra credentials are needed once sending is set up.
Optional overrides: `IMAP_HOST` (defaults to `imap.gmail.com`), `IMAP_PORT`
(defaults to `993`).

### Setting this up with a Gmail / Google Workspace address

1. Turn on **2-Step Verification** on that Google account (Google requires
   this before it will issue app passwords; a Workspace admin may need to
   enable it for the org).
2. Generate an **App Password**: myaccount.google.com/apppasswords → choose
   "Mail" → copy the 16-character password it gives you.
3. Make sure **IMAP is enabled**: Gmail → Settings → *See all settings* →
   *Forwarding and POP/IMAP* → Enable IMAP → Save Changes.
4. Set these environment variables (in Render's dashboard, or a local `.env`
   file when running on your machine):
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USERNAME=you@yourcompany.com
   SMTP_PASSWORD=<the 16-character app password>
   FROM_EMAIL=you@yourcompany.com
   FROM_NAME=Sbiz Talent Team
   ```
   No separate IMAP variables are needed — `imap.gmail.com:993` is the
   default and reuses the same login.

Note: regular Gmail accounts cap outgoing mail at ~500/day; Workspace
accounts are higher (~2,000/day) — plenty for this use case.

## Run it locally

```bash
python -m venv venv
source venv/bin/activate          # venv\Scripts\activate on Windows
pip install -r requirements.txt
export SECRET_KEY="something-random"
export ANTHROPIC_API_KEY="sk-ant-..."
python app.py
```

Visit `http://localhost:5000`.

## Deploy on Render

1. Push this folder to a GitHub repo (see commands below).
2. In the Render dashboard: **New > Web Service** and connect that repo.
3. Settings:
   - **Build command:** `pip install -r requirements.txt`
   - **Start command:** `gunicorn app:app`
4. Under **Environment**, add:
   - `SECRET_KEY` — any random string (Render can generate one)
   - `ANTHROPIC_API_KEY` — your Claude API key from the Anthropic Console
5. Click **Create Web Service**. Render builds and deploys; you'll get a
   `https://your-app.onrender.com` URL.

If you'd rather not click through the dashboard, `render.yaml` lets you use
**New > Blueprint** instead and Render reads the config from this repo
directly (you'll still be prompted to paste in `ANTHROPIC_API_KEY` since
secrets aren't stored in the file).

```bash
git init
git add .
git commit -m "Deployable Sbiz site with HR resume assistant"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```

## Notes

- **Resume storage is in-memory and per-browser-session.** It resets on
  every redeploy or restart, and won't be shared correctly if you scale to
  more than one instance. That's fine for an internal tool used by a few
  people; swap in Redis or a database if this needs to scale or persist.
- **Resumes are never written to disk** — they're parsed straight from the
  upload into memory, since they contain personal data.
- **Rotate the old ngrok auth token** that was hardcoded in the original
  notebook (`ngrok.set_auth_token(...)`). It's no longer used anywhere in
  this version, but since it was shared in plain text, treat it as
  compromised and revoke/regenerate it from your ngrok dashboard.
