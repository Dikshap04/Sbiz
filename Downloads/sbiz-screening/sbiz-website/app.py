import os
import uuid

from dotenv import load_dotenv
from flask import Flask, flash, jsonify, redirect, render_template, request, session, url_for

load_dotenv()  # reads ANTHROPIC_API_KEY and SECRET_KEY from a local .env file, if one exists

_key_preview = os.environ.get("ANTHROPIC_API_KEY")
if _key_preview:
    print(f"[startup] ANTHROPIC_API_KEY found - starts with {_key_preview[:9]!r}, length {len(_key_preview)}")
else:
    print("[startup] ANTHROPIC_API_KEY NOT found in environment.")

from utils import hr_agent
from utils.resume_parser import allowed_file, extract_resume_text

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-key-change-me")
app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024  # 8 MB per upload

# In-memory per-browser-session store for resume text + chat history.
# Fine for a single-instance deployment; swap for Redis/a DB if you ever
# scale this service to more than one instance.
SESSIONS: dict[str, dict] = {}


def get_session_state() -> dict:
    sid = session.get("hr_sid")
    if not sid:
        sid = str(uuid.uuid4())
        session["hr_sid"] = sid
    return SESSIONS.setdefault(sid, {"a": None, "b": None, "history": []})


@app.route("/healthz")
def healthz():
    return {"status": "ok"}, 200


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/about")
def about():
    return render_template("about.html")


@app.route("/submit", methods=["POST"])
def submit():
    name = (request.form.get("name") or "").strip()
    if name:
        flash(f"Thanks for reaching out, {name} — we'll be in touch soon.")
    else:
        flash("Please enter your name.")
    return redirect(url_for("home"))


@app.route("/hr-assistant")
def hr_assistant():
    state = get_session_state()
    return render_template("hr_assistant.html", resume_a=state["a"], resume_b=state["b"])


@app.route("/api/hr/upload", methods=["POST"])
def hr_upload():
    state = get_session_state()

    slot = request.form.get("slot")
    if slot not in ("a", "b"):
        return jsonify(ok=False, error="Invalid upload slot."), 400

    file = request.files.get("resume")
    if not file or file.filename == "":
        return jsonify(ok=False, error="No file selected."), 400

    if not allowed_file(file.filename):
        return jsonify(ok=False, error="Please upload a PDF, DOCX, or TXT file."), 400

    try:
        text, truncated = extract_resume_text(file.filename, file.read())
    except ValueError as exc:
        return jsonify(ok=False, error=str(exc)), 400
    except Exception:
        return jsonify(ok=False, error="Couldn't process that file. Please try a different one."), 400

    state[slot] = {"filename": file.filename, "text": text}
    state["history"] = []  # resumes changed, so any prior comparison context is stale

    return jsonify(
        ok=True,
        slot=slot,
        filename=file.filename,
        word_count=len(text.split()),
        truncated=truncated,
    )


@app.route("/api/hr/clear", methods=["POST"])
def hr_clear():
    state = get_session_state()
    data = request.get_json(silent=True) or {}
    slot = data.get("slot")

    if slot in ("a", "b"):
        state[slot] = None
    else:
        state["a"] = None
        state["b"] = None

    state["history"] = []
    return jsonify(ok=True)


@app.route("/api/hr/ask", methods=["POST"])
def hr_ask():
    state = get_session_state()

    if not state["a"]:
        return jsonify(ok=False, error="Upload at least one resume first."), 400

    data = request.get_json(silent=True) or {}
    message = (data.get("message") or "").strip()
    if not message:
        return jsonify(ok=False, error="Type a question first."), 400

    try:
        reply = hr_agent.ask(state["a"], state["b"], state["history"], message)
    except RuntimeError as exc:
        return jsonify(ok=False, error=str(exc)), 500
    except Exception as exc:
        return jsonify(ok=False, error=f"DEBUG: {exc}"), 502

    state["history"].append({"role": "user", "content": message})
    state["history"].append({"role": "assistant", "content": reply})

    return jsonify(ok=True, reply=reply)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=False)
