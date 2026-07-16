"""
Daily outreach engine.

1. Reads the vault (Marketing/) for offer/tone/audience context
2. Reads outreach/sent-log.csv to know who's already been contacted
3. Pulls candidate UK businesses from the Companies House API
4. Filters out anything already in the sent-log
5. For each new business: drafts a personalized email via Gemini,
   sends it via the Gmail API, appends it to the sent-log
6. Stops itself once it hits the daily cap (protects Gemini free-tier
   limits and sending reputation)
7. Reports the day's total + business list to Telegram

Requires env vars (set as GitHub Actions secrets):
  GEMINI_API_KEY
  COMPANIES_HOUSE_API_KEY
  GMAIL_REFRESH_TOKEN, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET
  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
"""

import os
import csv
import json
import base64
import datetime
import urllib.request
import urllib.parse

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VAULT = os.path.join(REPO_ROOT, "Marketing")
SENT_LOG = os.path.join(REPO_ROOT, "outreach", "sent-log.csv")
DAILY_CAP = int(os.environ.get("DAILY_EMAIL_CAP", "100"))

GEMINI_API_KEY = os.environ["GEMINI_API_KEY"]
GEMINI_MODEL = "gemini-3.5-flash"
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"

COMPANIES_HOUSE_KEY = os.environ["COMPANIES_HOUSE_API_KEY"]

TELEGRAM_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
TELEGRAM_CHAT_ID = os.environ["TELEGRAM_CHAT_ID"]


# ---------- vault reading ----------

def read_file(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def load_vault_context():
    files = [
        os.path.join(VAULT, "foundations.md"),
        os.path.join(VAULT, "core-principles.md"),
        os.path.join(VAULT, "cold-email-structure.md"),
        os.path.join(VAULT, "Offers", "ai-automation", "offer.md"),
        os.path.join(VAULT, "Offers", "ai-automation", "audience.md"),
        os.path.join(VAULT, "Offers", "ai-automation", "tone.md"),
        os.path.join(VAULT, "Offers", "ai-automation", "hooks-and-angles.md"),
        os.path.join(VAULT, "Offers", "ai-automation", "proof.md"),
    ]
    parts = []
    for path in files:
        if os.path.exists(path):
            parts.append(f"--- {os.path.basename(path)} ---\n{read_file(path)}")
        else:
            print(f"  WARNING: expected vault file missing: {path}")
    return "\n\n".join(parts)


# ---------- dedup log ----------

def load_sent_log():
    contacted = set()
    if not os.path.exists(SENT_LOG):
        return contacted
    with open(SENT_LOG, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            contacted.add(row["business_name"].strip().lower())
    return contacted


def append_sent_log(business_name, email, sector):
    file_exists = os.path.exists(SENT_LOG)
    with open(SENT_LOG, "a", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        if not file_exists:
            writer.writerow(["date", "business_name", "email", "sector", "status"])
        writer.writerow([
            datetime.date.today().isoformat(),
            business_name,
            email,
            sector,
            "emailed",
        ])


# ---------- learnings log ----------

def log_learning(text):
    learnings_path = os.path.join(REPO_ROOT, "outreach", "learnings.md")
    timestamp = datetime.date.today().isoformat()
    with open(learnings_path, "a", encoding="utf-8") as f:
        f.write(f"{timestamp} — {text}\n")
    print(f"  [learning logged] {text}")


# ---------- Companies House ----------

def search_companies(query, max_results=50):
    """Pulls active UK companies matching a search term (e.g. 'plumbing')."""
    url = "https://api.company-information.service.gov.uk/search/companies?" + urllib.parse.urlencode({
        "q": query,
        "items_per_page": max_results,
    })
    req = urllib.request.Request(url)
    auth = base64.b64encode(f"{COMPANIES_HOUSE_KEY}:".encode()).decode()
    req.add_header("Authorization", f"Basic {auth}")
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode())
    results = []
    for item in data.get("items", []):
        if item.get("company_status") == "active":
            results.append({
                "name": item.get("title", "").strip(),
                "address": item.get("address_snippet", ""),
            })
    return results


def find_candidate_businesses(contacted, limit):
    """Searches a rotating set of sector terms, filters out already-contacted."""
    search_terms = ["plumbing", "electrician", "locksmith", "hair salon", "barber", "beauty clinic"]
    candidates = []
    for term in search_terms:
        if len(candidates) >= limit:
            break
        before_count = len(candidates)
        try:
            for company in search_companies(term, max_results=30):
                if company["name"].strip().lower() not in contacted:
                    candidates.append(company)
                    if len(candidates) >= limit:
                        break
        except Exception as e:
            print(f"  Companies House search failed for '{term}': {e}")
        new_from_term = len(candidates) - before_count
        if new_from_term == 0:
            log_learning(f"'{term}' search returned 0 new candidates — "
                         f"likely exhausted or needs a different search term")
    return candidates[:limit]


# TODO: once the website-scraper is built alongside find_contact_email(),
# add a chatbot-detection check here and call:
#   log_learning(f"Skipped {business['name']} — already has a visible chatbot/booking widget")
# This does not exist yet — do not assume it's running.


# NOTE: Companies House gives company names/addresses, not emails or
# websites. Finding an actual contact email per business (site scraping
# or a paid enrichment API) is the next piece to wire in here — this
# function is the seam where that plugs in. Until then, `email` will be
# a placeholder and sending is skipped with a warning, so the dedup log
# and Telegram report still work end-to-end for testing.
def find_contact_email(business_name):
    return None


# ---------- Gemini drafting ----------

def call_gemini(prompt, max_output_tokens=2000):
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"maxOutputTokens": max_output_tokens, "temperature": 0.8},
    }
    req = urllib.request.Request(
        GEMINI_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=90) as resp:
        data = json.loads(resp.read().decode())
    return "".join(p.get("text", "") for p in data["candidates"][0]["content"]["parts"])


def draft_email(vault_context, business):
    prompt = f"""Using the writing rules, offer details, audience notes, tone
guide, and hooks below, draft ONE cold outreach email to this specific UK
business. Follow cold-email-structure.md exactly, including the required
identity line and opt-out line.

{vault_context}

--- BUSINESS TO EMAIL ---
Name: {business['name']}
Address: {business['address']}
---

Output ONLY the email — a subject line on the first line prefixed
"Subject: ", then a blank line, then the body. No commentary."""
    return call_gemini(prompt)


# ---------- Gmail sending ----------

def get_gmail_access_token():
    data = urllib.parse.urlencode({
        "client_id": os.environ["GMAIL_CLIENT_ID"],
        "client_secret": os.environ["GMAIL_CLIENT_SECRET"],
        "refresh_token": os.environ["GMAIL_REFRESH_TOKEN"],
        "grant_type": "refresh_token",
    }).encode()
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=data, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())["access_token"]


def send_gmail(access_token, to_email, subject, body):
    message = f"To: {to_email}\r\nSubject: {subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n{body}"
    raw = base64.urlsafe_b64encode(message.encode("utf-8")).decode("utf-8")
    req = urllib.request.Request(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        data=json.dumps({"raw": raw}).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.status


# ---------- Telegram report ----------

def send_telegram(message):
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    data = urllib.parse.urlencode({"chat_id": TELEGRAM_CHAT_ID, "text": message}).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    urllib.request.urlopen(req, timeout=30)


# ---------- main ----------

def main():
    print("Loading vault context...")
    vault_context = load_vault_context()

    print("Loading sent-log for dedup...")
    contacted = load_sent_log()
    print(f"  {len(contacted)} businesses already contacted historically.")

    print("Finding candidate businesses via Companies House...")
    candidates = find_candidate_businesses(contacted, limit=DAILY_CAP)
    print(f"  Found {len(candidates)} new candidates.")

    sent_count = 0
    sent_names = []
    skipped_no_email = 0
    failures = []

    access_token = None

    for business in candidates:
        if sent_count >= DAILY_CAP:
            break

        email = find_contact_email(business["name"])
        if not email:
            skipped_no_email += 1
            continue

        try:
            draft = draft_email(vault_context, business)
            subject_line, _, body = draft.partition("\n\n")
            subject = subject_line.replace("Subject:", "").strip()

            if access_token is None:
                access_token = get_gmail_access_token()

            send_gmail(access_token, email, subject, body)
            append_sent_log(business["name"], email, "unknown")
            sent_count += 1
            sent_names.append(business["name"])
            print(f"  Sent to {business['name']}")
        except Exception as e:
            print(f"  Failed on {business['name']}: {e}")
            failures.append(str(e))

    if len(failures) >= 2:
        log_learning(f"{len(failures)} send failures in one run — "
                     f"most recent error: {failures[-1][:200]}")

    report = (
        f"Outreach run complete for {datetime.date.today().isoformat()}\n"
        f"Sent: {sent_count}\n"
        f"Skipped (no email found): {skipped_no_email}\n"
    )
    if sent_names:
        report += "\nBusinesses emailed:\n" + "\n".join(f"- {n}" for n in sent_names)

    print(report)
    send_telegram(report)


if __name__ == "__main__":
    main()
