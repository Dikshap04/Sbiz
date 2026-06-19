# Sbiz Website + HR Assistant

A small Flask site with an HR resume assistant built on the Claude API.
Upload a resume (PDF, DOCX, or TXT) and ask questions about it, or upload a
second resume to compare two candidates.

## Project structure

```
app.py                  Flask routes and the in-memory session store
utils/resume_parser.py  Extracts text from PDF / DOCX / TXT uploads
utils/hr_agent.py       Builds the prompt and calls the Claude API
templates/               Jinja templates (home, about, HR assistant)
static/                  CSS and JS
requirements.txt
Procfile                 Tells Render how to start the app
render.yaml              Optional one-click Render Blueprint
```

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
