"""
Polls Telegram's getUpdates for any new message since the last check.
If it finds a recognized command, sets a GitHub Actions output so the
workflow knows whether to run the outreach job (and, later, ad/pin/
article jobs) this cycle.

Keeps track of the last processed Telegram update_id in a small state
file committed to the repo, so it doesn't reprocess the same command
on every 5-minute poll.

Usage: python tasks/router.py --check-only
"""

import os
import sys
import json
import urllib.request

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE_FILE = os.path.join(REPO_ROOT, "outreach", "telegram-state.json")

TELEGRAM_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
API_BASE = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}"

# command text (lowercased, stripped) -> github actions output flag to set
COMMAND_MAP = {
    "start outreach": "run_outreach",
    "/start_outreach": "run_outreach",
    # add more as new tasks come online, e.g.:
    # "make pins": "run_pinterest",
    # "write article": "run_medium",
}


def load_last_update_id():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE, "r") as f:
            return json.load(f).get("last_update_id", 0)
    return 0


def save_last_update_id(update_id):
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump({"last_update_id": update_id}, f)


def get_updates(offset):
    url = f"{API_BASE}/getUpdates?offset={offset}&timeout=0"
    with urllib.request.urlopen(url, timeout=30) as resp:
        return json.loads(resp.read().decode())


def set_github_output(key, value):
    output_file = os.environ.get("GITHUB_OUTPUT")
    if output_file:
        with open(output_file, "a") as f:
            f.write(f"{key}={value}\n")
    else:
        print(f"[dry-run output] {key}={value}")


def main():
    last_id = load_last_update_id()
    data = get_updates(offset=last_id + 1)

    triggered_outputs = set()
    newest_id = last_id

    for update in data.get("result", []):
        newest_id = max(newest_id, update["update_id"])
        message = update.get("message", {})
        text = message.get("text", "").strip().lower()

        if text in COMMAND_MAP:
            output_key = COMMAND_MAP[text]
            triggered_outputs.add(output_key)
            print(f"Matched command '{text}' -> {output_key}")

    if newest_id != last_id:
        save_last_update_id(newest_id)
        # commit the state file so the next poll doesn't reprocess this
        os.system('git config user.name "github-actions"')
        os.system('git config user.email "actions@github.com"')
        os.system(f'git add {STATE_FILE}')
        os.system('git diff --staged --quiet || git commit -m "Update telegram poll state"')
        os.system('git push')

    for key in ["run_outreach", "run_pinterest", "run_medium", "run_fb_ads"]:
        set_github_output(key, "true" if key in triggered_outputs else "false")


if __name__ == "__main__":
    main()
