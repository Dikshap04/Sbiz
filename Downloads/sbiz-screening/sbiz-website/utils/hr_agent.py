"""Talks to the Claude API on behalf of the HR assistant.

Keeps a clean separation from app.py: this module only knows how to build a
prompt from resume context + chat history and call the model. It doesn't know
about Flask, sessions, or HTTP at all.
"""

import os

import anthropic

MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 1024
MAX_HISTORY_TURNS = 8  # last N user/assistant exchanges kept for follow-up questions

_client = None


def get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            raise RuntimeError(
                "ANTHROPIC_API_KEY is not set on the server. Add it in your "
                "Render service's Environment settings."
            )
        _client = anthropic.Anthropic(api_key=api_key)
    return _client


def build_system_prompt(resume_a: dict, resume_b: dict | None) -> str:
    parts = [
        "You are an HR assistant helping a recruiter or hiring manager review "
        "candidate resumes.",
        "Answer strictly using the resume text provided below. If something "
        "isn't mentioned in the resume(s), say plainly that it isn't mentioned "
        "instead of guessing or inventing details.",
        "Keep answers concise and skimmable — short paragraphs or bullet "
        "points when listing skills, roles, or comparison points.",
        "You are an analysis aid, not a hiring decision-maker. Avoid blanket "
        "verdicts like 'hire this person'; instead describe fit, strengths, "
        "and gaps relative to whatever the user is asking about.",
        f"\n--- Candidate A resume ({resume_a['filename']}) ---\n{resume_a['text']}",
    ]

    if resume_b:
        parts.append(
            f"\n--- Candidate B resume ({resume_b['filename']}) ---\n{resume_b['text']}"
        )
        parts.append(
            "\nWhen asked to compare the two, organize the answer by relevant "
            "dimension (experience, skills, education, etc.) rather than "
            "restating each resume in full."
        )

    return "\n".join(parts)


def ask(resume_a: dict, resume_b: dict | None, history: list[dict], user_message: str) -> str:
    if not resume_a:
        raise ValueError("At least one resume must be uploaded before asking a question.")

    client = get_client()
    system_prompt = build_system_prompt(resume_a, resume_b)

    trimmed_history = history[-(MAX_HISTORY_TURNS * 2):]
    messages = trimmed_history + [{"role": "user", "content": user_message}]

    response = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=system_prompt,
        messages=messages,
    )

    return "".join(block.text for block in response.content if block.type == "text").strip()


def screen_candidate(resume_text: str, filename: str, pqs: list[str]) -> dict:
    """Evaluate a resume against minimum qualifications and up to 6 PQs.

    Returns a dict:
      {
        "filename": "...",
        "name": "John Smith",          # extracted from the resume
        "min_quals": "Yes" | "No",     # does the resume show basic professional experience?
        "pqs": ["Yes", "No", ...]      # one entry per PQ in the same order as pqs list
      }
    """
    import json as _json

    client = get_client()

    pq_block = "\n".join(
        f"PQ #{i+1}: {pq}" for i, pq in enumerate(pqs)
    )

    system = (
        "You are a precise HR screening assistant. "
        "You will be given a resume and a list of preferred qualifications (PQs). "
        "Your job is to evaluate the resume against each criterion and return ONLY a "
        "JSON object — no prose, no markdown fences, just raw JSON. "
        "Extract the candidate's full name from the resume if visible, otherwise use the filename. "
        "For min_quals, answer Yes if the resume shows any legitimate work or education history. "
        "For each PQ, answer Yes only if the resume clearly evidences that qualification; "
        "answer No if it is absent or not clear; answer N/A only if the PQ field is empty."
    )

    user_msg = (
        f"Resume filename: {filename}\n\n"
        f"--- Resume text ---\n{resume_text}\n\n"
        f"--- Preferred Qualifications to evaluate ---\n{pq_block}\n\n"
        "Return ONLY this JSON structure (no extra text):\n"
        "{\n"
        '  "name": "<candidate full name or filename>",\n'
        '  "min_quals": "Yes" or "No",\n'
        '  "pqs": ["Yes/No/N/A", "Yes/No/N/A", ...]\n'
        "}\n"
        f"The pqs array must have exactly {len(pqs)} entries, one per PQ above."
    )

    response = client.messages.create(
        model=MODEL,
        max_tokens=300,
        system=system,
        messages=[{"role": "user", "content": user_msg}],
    )

    raw = "".join(b.text for b in response.content if b.type == "text").strip()

    # Strip accidental markdown fences if the model adds them
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    try:
        data = _json.loads(raw)
    except Exception:
        # Fallback: couldn't parse — return unknowns rather than crashing
        data = {
            "name": filename,
            "min_quals": "?",
            "pqs": ["?"] * len(pqs),
        }

    # Normalise
    data["filename"] = filename
    data.setdefault("name", filename)
    data.setdefault("min_quals", "?")
    # Ensure pqs list is the right length
    pqs_out = data.get("pqs", [])
    while len(pqs_out) < len(pqs):
        pqs_out.append("?")
    data["pqs"] = pqs_out[:len(pqs)]

    return data
