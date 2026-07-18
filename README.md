# JimpAI – Your AI Marketing Assistant

## Deploy to Deno Deploy

1. Push this repo to GitHub.
2. Go to [deno.com/deploy](https://deno.com/deploy).
3. Click **"New Project"** → **"Deploy from GitHub"**.
4. Select this repo.
5. Set entry point to `src/main.ts`.
6. Add environment variables (see below).
7. Click **"Deploy"**.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Your bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Your Telegram user ID |
| `GITHUB_VAULT_OWNER` | Your GitHub username |
| `GITHUB_VAULT_REPO` | Your repo name (e.g., "Business") |
| `GITHUB_VAULT_BRANCH` | Branch (default "main") |
| `GEMINI_API_KEY` | Google Gemini API key |
| `GROQ_API_KEY` | Groq API key |
| `MEDIUM_INTEGRATION_TOKEN` | Medium integration token |
| `PINTEREST_ACCESS_TOKEN` | Pinterest API token |
| `PINTEREST_BOARD_ID` | Pinterest board ID |
| `TWITTER_BEARER_TOKEN` | Twitter API bearer token |
| `META_ACCESS_TOKEN` | Facebook access token |
| `META_AD_ACCOUNT_ID` | Facebook ad account ID |

## Set Telegram Webhook

After deploy, visit in your browser:
