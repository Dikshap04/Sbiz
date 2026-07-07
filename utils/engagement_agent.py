"""Candidate engagement agent.

Once a candidate is screened and selected, this module drafts warm,
personalised email updates (via Claude) to keep them excited about joining
Sbiz between offer acceptance and their start date, and sends them by SMTP
if credentials are configured (falls back to a "simulated send" that's
still logged to the timeline, so the feature works fully in a demo/dev
environment with no mail server set up).
"""

from __future__ import annotations  # lets `list[dict] | None` etc. work on Python 3.9 too

import email as _email
import imaplib
import json as _json
import os
import re
import smtplib
from datetime import datetime, timedelta
from email.header import decode_header
from email.mime.text import MIMEText
from email.utils import parseaddr, parsedate_to_datetime

from .hr_agent import MODEL, get_client

EMAIL_RE = re.compile(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+")

# Update types offered in the UI — each nudges Claude toward a different
# angle so a candidate doesn't get five copies of the same email.
UPDATE_TYPES = [
    {
        "id": "offer_confirmation",
        "label": "Offer confirmation & welcome",
        "hint": "Warmly confirm the offer, celebrate them joining the team, and set an exciting, "
                "confident tone for what's ahead.",
    },
    {
        "id": "countdown",
        "label": "Countdown to day one",
        "hint": "Build excitement as the start date approaches — preview what week one will look "
                "like and what they can look forward to.",
    },
    {
        "id": "culture_preview",
        "label": "Team & culture preview",
        "hint": "Share what the team and culture are like, tying it naturally to the candidate's "
                "own background, skills, or interests from their resume.",
    },
    {
        "id": "logistics",
        "label": "Pre-boarding logistics",
        "hint": "A practical, reassuring heads-up about paperwork, equipment, or orientation — "
                "keep it light, not bureaucratic.",
    },
    {
        "id": "check_in",
        "label": "Personal check-in",
        "hint": "A casual, genuinely personal note checking in, reaffirming they made a great "
                "choice, and inviting any questions before day one.",
    },
    {
        "id": "custom",
        "label": "Custom message",
        "hint": "Write freely based only on the recruiter's notes below.",
    },
]


def extract_email(text: str) -> str:
    """Best-effort email extraction from resume text."""
    m = EMAIL_RE.search(text or "")
    return m.group(0) if m else ""


# ── Drafting ──────────────────────────────────────────────────────────

def draft_update(candidate: dict, position: dict, update_type: str,
                  joining_date: str, custom_notes: str, history: list[dict] | None = None) -> dict:
    """Ask Claude for a personalised {subject, body} update for one candidate."""
    history = history if history is not None else candidate.get("engagement_log", [])
    type_info = next((t for t in UPDATE_TYPES if t["id"] == update_type), UPDATE_TYPES[-1])

    role_bits = ", ".join(b for b in [position.get("title"), position.get("location")] if b)
    prior = "\n".join(
        f"- {h.get('label', h.get('type'))}: {h.get('subject')}" for h in history[-5:]
    ) or "None yet — this is the first update to this candidate."

    system = (
        "You are the Talent Engagement Specialist at Sbiz. You write warm, genuine, exciting emails "
        "to candidates who have accepted an offer but haven't started yet, keeping them engaged and "
        "excited about joining rather than drifting toward a counter-offer elsewhere. "
        "Personalise using the candidate's resume — reference specific skills, past roles, or "
        "interests naturally, without sounding like a generic form letter or over-hyped marketing "
        "copy. Keep the tone confident, human, and specific to this person. "
        "Body length roughly 120-220 words, plain text with \\n for line breaks (no HTML, no "
        "markdown formatting). Sign off warmly from 'The Sbiz Team' unless told otherwise. "
        "Return ONLY a JSON object — no prose, no markdown code fences."
    )
    user_msg = (
        f"Candidate: {candidate.get('name', candidate.get('filename', 'the candidate'))}\n"
        f"Role: {role_bits or 'Not specified'}\n"
        f"Joining date: {joining_date or 'Not yet set'}\n"
        f"Update type: {type_info['label']} — {type_info['hint']}\n"
        f"Extra talking points from the recruiter: {custom_notes or 'None'}\n"
        f"Updates already sent to this candidate (write a fresh angle, don't repeat these):\n{prior}\n\n"
        f"--- Candidate resume (for personalisation only) ---\n{(candidate.get('text') or '')[:6000]}\n\n"
        "Return ONLY this JSON:\n"
        '{"subject": "<short, warm email subject line>", "body": "<email body>"}'
    )

    response = get_client().messages.create(
        model=MODEL, max_tokens=700, system=system,
        messages=[{"role": "user", "content": user_msg}])
    raw = "".join(b.text for b in response.content if b.type == "text").strip()

    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    try:
        data = _json.loads(raw)
    except Exception:
        data = {"subject": "An update on your upcoming role at Sbiz", "body": raw}

    data.setdefault("subject", "An update from Sbiz")
    data.setdefault("body", "")
    return data


# ── Sending ───────────────────────────────────────────────────────────

def send_email(to_email: str, subject: str, body: str) -> tuple[bool, str]:
    """Send via SMTP if credentials are configured; otherwise report a
    graceful "simulated" send so the feature stays usable without a mail
    server (the update is still recorded on the candidate's timeline).

    Returns (ok, status) where status is "sent", "simulated", or an error
    message.
    """
    host = os.environ.get("SMTP_HOST")
    port = os.environ.get("SMTP_PORT", "587")
    user = os.environ.get("SMTP_USERNAME")
    password = os.environ.get("SMTP_PASSWORD")
    from_email = os.environ.get("FROM_EMAIL", user)
    from_name = os.environ.get("FROM_NAME", "Sbiz Talent Team")

    if not (host and user and password and from_email):
        return True, "simulated"

    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = f"{from_name} <{from_email}>"
    msg["To"] = to_email

    try:
        with smtplib.SMTP(host, int(port), timeout=15) as server:
            server.starttls()
            server.login(user, password)
            server.sendmail(from_email, [to_email], msg.as_string())
        return True, "sent"
    except Exception as exc:
        return False, f"{exc}"


# ── Receiving replies ────────────────────────────────────────────────

def _decode_str(value: str | None) -> str:
    if not value:
        return ""
    parts = decode_header(value)
    out = []
    for text, enc in parts:
        if isinstance(text, bytes):
            out.append(text.decode(enc or "utf-8", errors="ignore"))
        else:
            out.append(text)
    return "".join(out)


def _extract_plain_body(msg) -> str:
    """Pull the plain-text body out of a (possibly multipart) email.Message."""
    if msg.is_multipart():
        # Prefer a real text/plain part; fall back to a stripped text/html part.
        html_fallback = ""
        for part in msg.walk():
            ctype = part.get_content_type()
            disp = str(part.get("Content-Disposition") or "")
            if "attachment" in disp:
                continue
            if ctype == "text/plain":
                charset = part.get_content_charset() or "utf-8"
                return part.get_payload(decode=True).decode(charset, errors="ignore").strip()
            if ctype == "text/html" and not html_fallback:
                charset = part.get_content_charset() or "utf-8"
                html_fallback = part.get_payload(decode=True).decode(charset, errors="ignore")
        return re.sub(r"<[^>]+>", " ", html_fallback).strip()
    else:
        charset = msg.get_content_charset() or "utf-8"
        payload = msg.get_payload(decode=True)
        return payload.decode(charset, errors="ignore").strip() if payload else ""


def check_replies(candidate_emails: dict, seen_ids: set) -> list[dict]:
    """Poll the configured Gmail/Workspace inbox (IMAP) for replies from
    engaged candidates.

    candidate_emails: {lowercased email -> candidate id}
    seen_ids: a set (mutated in place) of Message-IDs already imported, so
        repeated checks don't create duplicate timeline entries.

    Returns a list of new reply dicts: {candidate_id, subject, body, received_at}.
    Raises RuntimeError if IMAP isn't configured.
    """
    host = os.environ.get("IMAP_HOST", "imap.gmail.com")
    port = int(os.environ.get("IMAP_PORT", "993"))
    user = os.environ.get("SMTP_USERNAME")
    password = os.environ.get("SMTP_PASSWORD")

    if not (user and password):
        raise RuntimeError(
            "Inbox checking isn't configured yet. Set SMTP_USERNAME and SMTP_PASSWORD "
            "(the same Gmail/Workspace app password used for sending) on the server."
        )
    if not candidate_emails:
        return []

    results: list[dict] = []
    conn = imaplib.IMAP4_SSL(host, port)
    try:
        conn.login(user, password)
        conn.select("INBOX")

        since = (datetime.now() - timedelta(days=45)).strftime("%d-%b-%Y")
        status, data = conn.search(None, f'(SINCE {since})')
        if status != "OK":
            return []

        for eid in data[0].split():
            status, msg_data = conn.fetch(eid, "(RFC822)")
            if status != "OK" or not msg_data or not msg_data[0]:
                continue
            msg = _email.message_from_bytes(msg_data[0][1])

            from_email = parseaddr(msg.get("From"))[1].lower()
            if from_email not in candidate_emails:
                continue

            msg_id = msg.get("Message-ID") or f"{eid.decode()}-{from_email}"
            if msg_id in seen_ids:
                continue

            try:
                received_at = parsedate_to_datetime(msg.get("Date")).strftime("%d %b %Y, %I:%M %p")
            except Exception:
                received_at = datetime.now().strftime("%d %b %Y, %I:%M %p")

            results.append({
                "candidate_id": candidate_emails[from_email],
                "from_email": from_email,
                "subject": _decode_str(msg.get("Subject")) or "(no subject)",
                "body": _extract_plain_body(msg)[:3000],
                "received_at": received_at,
            })
            seen_ids.add(msg_id)
    finally:
        try:
            conn.logout()
        except Exception:
            pass

    return results
