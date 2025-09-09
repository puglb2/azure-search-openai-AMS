# AMS Intake Assistant — Starter (Static Web Apps + Functions)

This repo is a **drop-in starter** for embedding an intake chatbot on your website, with a secure backend that can search your provider directory and schedule via your EMR.

## What’s inside
- **React/Vite widget** (root) — renders into `<div id="ams-intake-chat"></div>` and calls your API.
- **Azure Functions (Node 20)** under `/api` with endpoints:
  - `POST /api/chat` — calls Azure OpenAI with tool/function calling.
  - `GET  /api/providers/search` — queries Azure AI Search for provider matches.
  - `POST /api/schedule/appointment` — books an appointment through your EMR adapter.
- **`staticwebapp.config.json`** — SPA routing and allowed headers.
- **GitHub Actions** workflow for Azure Static Web Apps (optional; the Portal can create it for you).

## Prereqs
- Azure subscription with BAA (for PHI).
- Resources: **Static Web App**, **Azure Functions (built-in with SWA)**, **Azure OpenAI**, **Azure AI Search**, **Key Vault** (recommended), **App Insights**.
- Node 20 locally; PNPM/NPM/Yarn OK.

## Local dev
```bash
# install deps
npm i

# run dev server
npm run dev
```

The widget will call `/api/*`. You can run the Functions locally with Azure Functions Core Tools if needed.

## Deploy (high level)
1. In Azure Portal, create **Static Web App**, connect your GitHub repo/branch.
   - App location: `/`
   - Output location: `dist`
   - Api location: `/api`
2. The Portal will create a GitHub Actions workflow and a deployment token secret.
3. Add **Configuration** (environment variables) in SWA:
   - `AZURE_OPENAI_ENDPOINT`
   - `AZURE_OPENAI_API_KEY`
   - `AZURE_OPENAI_DEPLOYMENT` (e.g., `gpt-4o-mini`)
   - `AZURE_SEARCH_ENDPOINT`
   - `AZURE_SEARCH_KEY`
   - `AZURE_SEARCH_INDEX` (e.g., `providers`)
   - `EMR_BASE_URL` (or FHIR base), `EMR_CLIENT_ID`, `EMR_CLIENT_SECRET` (or API key)
4. Commit & push → CI/CD builds frontend and Functions and deploys.

## Embed on your site
In the page where you want the chat:
```html
<script src="https://<your-swa-domain>/widget.js" defer></script>
<div id="ams-intake-chat" data-env="prod"></div>
```
> By default, this starter emits `widget.js` (built bundle). You can also mount the widget directly from within your site’s codebase.

## Security & compliance checklist
- Put **all secrets** into SWA/Functions configuration or **Key Vault**; not in code.
- Implement **consent** and **crisis** handling. The starter includes placeholders.
- Log to **Application Insights** with PHI redaction, and keep **audit** logs for EMR actions.
- For EMR, prefer **SMART on FHIR** OAuth if available. Otherwise use vendor API keys via Key Vault.

## Notes
This is a scaffold. The `providers` and `schedule` functions contain stubs — replace with real Azure AI Search and EMR adapter logic.
