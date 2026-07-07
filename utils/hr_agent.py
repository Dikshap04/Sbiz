"""Claude API calls for the unified HR agent."""

from __future__ import annotations  # lets `dict | None` etc. work on Python 3.9 too

import json as _json
import os

import anthropic

MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 1024
MAX_HISTORY_TURNS = 8

_client = None


def get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError(
                "ANTHROPIC_API_KEY is not set on the server. "
                "Add it in your Render service's Environment settings."
            )
        _client = anthropic.Anthropic(api_key=api_key)
    return _client


# ── Single-candidate chat ────────────────────────────────────────────

def ask(resume_a: dict, resume_b: dict | None, history: list[dict], user_message: str) -> str:
    """Q&A about one or two resumes (original HR assistant mode)."""
    if not resume_a:
        raise ValueError("At least one resume must be uploaded before asking a question.")

    client = get_client()

    parts = [
        "You are an HR assistant helping a recruiter review candidate resumes.",
        "Answer strictly using the resume text provided. If something isn't mentioned, say so.",
        "Keep answers concise — short paragraphs or bullet points when listing skills or roles.",
        f"\n--- Candidate A resume ({resume_a['filename']}) ---\n{resume_a['text']}",
    ]
    if resume_b:
        parts.append(f"\n--- Candidate B resume ({resume_b['filename']}) ---\n{resume_b['text']}")
        parts.append("\nWhen comparing, organise by dimension (experience, skills, education).")

    system = "\n".join(parts)
    trimmed = history[-(MAX_HISTORY_TURNS * 2):]
    messages = trimmed + [{"role": "user", "content": user_message}]

    response = get_client().messages.create(
        model=MODEL, max_tokens=MAX_TOKENS, system=system, messages=messages)
    return "".join(b.text for b in response.content if b.type == "text").strip()


# ── Single-candidate chat (unified agent) ────────────────────────────

def ask_single(candidate: dict, history: list[dict], user_message: str) -> str:
    """Chat about one specific candidate from the unified pool."""
    system = (
        f"You are an HR assistant reviewing a specific candidate's resume.\n"
        f"Candidate name: {candidate.get('name', candidate['filename'])}\n"
        f"Answer strictly from the resume below. If something isn't mentioned, say so clearly.\n\n"
        f"--- Resume ({candidate['filename']}) ---\n{candidate['text']}"
    )
    trimmed = history[-(MAX_HISTORY_TURNS * 2):]
    messages = trimmed + [{"role": "user", "content": user_message}]
    response = get_client().messages.create(
        model=MODEL, max_tokens=MAX_TOKENS, system=system, messages=messages)
    return "".join(b.text for b in response.content if b.type == "text").strip()


# ── Group chat (all candidates) ──────────────────────────────────────

def ask_group(candidates: list[dict], history: list[dict], user_message: str) -> str:
    """Chat comparing / ranking all uploaded candidates."""
    if not candidates:
        raise ValueError("Upload at least one candidate first.")

    candidate_blocks = "\n\n".join(
        f"--- Candidate {i+1}: {c.get('name', c['filename'])} ({c['filename']}) ---\n{c['text']}"
        for i, c in enumerate(candidates)
    )
    system = (
        f"You are an HR assistant reviewing {len(candidates)} candidate resumes.\n"
        "Answer strictly using the resume texts below. When comparing, organise by relevant "
        "dimension (experience, skills, education, qualifications). "
        "Avoid blanket hire/reject verdicts — describe fit, strengths, and gaps instead.\n\n"
        + candidate_blocks
    )
    trimmed = history[-(MAX_HISTORY_TURNS * 2):]
    messages = trimmed + [{"role": "user", "content": user_message}]
    response = get_client().messages.create(
        model=MODEL, max_tokens=MAX_TOKENS, system=system, messages=messages)
    return "".join(b.text for b in response.content if b.type == "text").strip()


# ── PQ screening ─────────────────────────────────────────────────────

def screen_candidate(resume_text: str, filename: str, pqs: list[str]) -> dict:
    """Evaluate a resume against minimum qualifications and up to 6 PQs.
    Returns dict with name, min_quals, pqs list."""
    pq_block = "\n".join(f"PQ #{i+1}: {pq}" for i, pq in enumerate(pqs))
    system = (
        "You are a precise HR screening assistant. "
        "Given a resume and a list of preferred qualifications (PQs), evaluate each criterion "
        "and return ONLY a JSON object — no prose, no markdown fences, just raw JSON. "
        "Extract the candidate's full name if visible, otherwise use the filename. "
        "For min_quals, answer Yes if the resume shows any legitimate work or education history. "
        "For each PQ, answer Yes only if clearly evidenced; No if absent or unclear."
    )
    user_msg = (
        f"Resume filename: {filename}\n\n"
        f"--- Resume text ---\n{resume_text}\n\n"
        f"--- Preferred Qualifications ---\n{pq_block}\n\n"
        "Return ONLY this JSON:\n"
        '{"name": "<full name or filename>", "min_quals": "Yes or No", '
        '"pqs": ["Yes/No/N/A", ...]}\n'
        f"The pqs array must have exactly {len(pqs)} entries."
    )
    response = get_client().messages.create(
        model=MODEL, max_tokens=300, system=system,
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
        data = {"name": filename, "min_quals": "?", "pqs": ["?"] * len(pqs)}
    data["filename"] = filename
    data.setdefault("name", filename)
    data.setdefault("min_quals", "?")
    pqs_out = data.get("pqs", [])
    while len(pqs_out) < len(pqs):
        pqs_out.append("?")
    data["pqs"] = pqs_out[:len(pqs)]
    return data
