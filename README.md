# Sender Contact Manager - Google Workspace Add-on

A complete, production-ready **Google Workspace Add-on** HTTP backend built with **Node.js** and **Express**.

**Sender Contact Manager** is a **Gmail Add-on** built using Google's **CardsV2** interface. When opening an email in Gmail, it contextually detects the sender via the Gmail REST API and allows users to quickly review and add them to their persistent **Cloud Firestore** contacts list with one click.

---

## 🚀 Key Features

- **Express.js HTTP Backend**: Handles Google Workspace JSON event payloads securely with Google ID Bearer Token verification.
- **Gmail Contextual Trigger (`onGmailMessageOpen`)**: When an email is opened in Gmail, the add-on uses the contextual ephemeral `event.gmail.accessToken` to fetch the real sender's name and email from the Gmail REST API (no hardcoded demo data).
- **Persistent Cloud Firestore Storage**:
  - `contacts`: Saves and lists user contacts across sessions.
  - `tokens`: Persists third-party OAuth connection tokens when the user connects, and deletes them when the user disconnects.
- **Third-Party OAuth Overlay Flow (`OVERLAY` + `RELOAD`)**: Implements Google's official [Connect Third-Party Service](https://developers.google.com/workspace/add-ons/guides/connect-third-party-service#prompt-sign-in) pattern using an in-app overlay dialog that automatically reloads the add-on once authorized.
- **Contact Management**: Features quick contact adding, duplicate prevention, and a **Clear Contacts** action to reset contacts.
- **CardsV2 Builder**: Modular utilities in [`src/utils/cardBuilder.js`](src/utils/cardBuilder.js) for building Cards, Sections, Text, DecoratedText, Inputs, and Action Buttons conforming to `google.apps.card.v1`.
- **Automated Integration Tests**: Comprehensive unit and integration test suite using Node's native test runner (`npm test`).

---

## 📁 Project Structure

```text
gmail-addon/
├── deployment.json            # Google Workspace Add-on deployment configuration
├── deployment.json.example    # Deployment configuration template
├── Dockerfile                 # Container definition for Google Cloud Run
├── firebase.json              # Firebase Hosting configuration for OAuth overlay
├── package.json
├── .env.example               # Environment variable documentation template
├── .gitignore                 # Excludes secrets, caches, and dependencies
├── README.md
├── public/
│   └── oauth.html             # Static OAuth consent dialog for in-app overlay
├── src/
│   ├── index.js               # Express server entry point & route dispatcher
│   ├── store.js               # Firestore & in-memory store for contacts and tokens
│   ├── routes/
│   │   └── oauth.js           # Server-side OAuth overlay endpoints
│   ├── middleware/
│   │   └── auth.js            # Google Bearer Token verification middleware
│   ├── cards/
│   │   ├── connect.js         # Connect Account Card UI (OVERLAY + RELOAD)
│   │   ├── homepage.js        # Add-on Homepage Card UI (Contacts list & status)
│   │   ├── gmailMessage.js    # Gmail Contextual Card UI (prefilled sender)
│   │   ├── contactDetails.js  # Contact confirmation & details card
│   │   └── actionResponse.js  # Form submissions & button click handlers
│   └── utils/
│       ├── cardBuilder.js     # CardsV2 JSON builder utilities
│       └── senderHelper.js    # Gmail API message fetcher & MIME/RFC 5322 header parser
└── test/
    └── server.test.js         # 26 automated integration and unit tests
```

---

## ☁️ Required Google Cloud Services & APIs

Before deploying, ensure you have an active Google Cloud Platform (GCP) project and enable the following APIs:

| API Service | Identifier | Purpose |
| :--- | :--- | :--- |
| **Google Workspace Add-ons API** | `gsuiteaddons.googleapis.com` | Enables deploying and managing Google Workspace Add-ons |
| **Gmail API** | `gmail.googleapis.com` | Required by the add-on to fetch email sender metadata |
| **Cloud Firestore API** | `firestore.googleapis.com` | NoSQL database for persisting contacts and connection tokens |
| **Cloud Run API** | `run.googleapis.com` | Serverless container platform to host the Node.js backend |
| **Cloud Build API** | `cloudbuild.googleapis.com` | Builds the container image during `gcloud run deploy` |
| **Artifact Registry API** | `artifactregistry.googleapis.com` | Stores built container images for Cloud Run |

### Enable via Google Cloud CLI (`gcloud`)

```bash
gcloud services enable \
  gsuiteaddons.googleapis.com \
  gmail.googleapis.com \
  firestore.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com
```

---

## 🗄️ Setting Up Cloud Firestore

Cloud Firestore is used to persist contacts and OAuth connection tokens across serverless container restarts.

### 1. Create the Database

#### Option A: Via Google Cloud CLI (`gcloud`)
```bash
gcloud firestore databases create \
  --location=us-central1 \
  --type=firestore-native
```

#### Option B: Via Google Cloud Console
1. In the [Google Cloud Console](https://console.cloud.google.com/), navigate to **Firestore**.
2. Click **Create Database**.
3. Select **Native Mode** (recommended) and choose your preferred region (e.g., `us-central1`).
4. Click **Create**.

---

### 2. Configure IAM Roles for Cloud Run

Cloud Run uses Application Default Credentials (ADC). Ensure your Cloud Run runtime service account (usually the default Compute Engine service account `PROJECT_NUMBER-compute@developer.gserviceaccount.com`) has the **Cloud Datastore User** role:

```bash
PROJECT_ID=$(gcloud config get-value project)
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/datastore.user"
```

---

### 3. Firestore Collections & Schema

The application automatically creates and manages two collections:

#### `contacts` Collection
Stores user-saved contacts. Documents are created when you click **"Add Contact"** and deleted when you click **"Clear Contacts"**.
- **Document ID**: Unique contact ID (e.g. `contact_<timestamp>_<random>`)
- **Fields**:
  - `id` *(string)*: Unique contact identifier
  - `name` *(string)*: Contact's full name (e.g. `"Sarah Connor"`)
  - `email` *(string)*: Contact's email address (e.g. `"sarah@example.com"`)
  - `addedAt` *(string)*: ISO 8601 timestamp of when contact was saved

#### `tokens` Collection
Stores connection tokens for authenticated sessions. Created when the user connects their account and completely deleted when the user clicks **"Disconnect Account"**.
- **Document ID**: User email or account identifier (`userId`)
- **Fields**:
  - `userId` *(string)*: User email or identifier (e.g. `"user@example.com"`)
  - `accessToken` *(string)*: OAuth access token (e.g. `"ya29.xxxx"`)
  - `refreshToken` *(string)*: OAuth refresh token (e.g. `"1//xxxx"`)
  - `tokenType` *(string)*: `"Bearer"`
  - `expiresIn` *(number)*: Token lifetime in seconds (e.g. `3600`)
  - `expiresAt` *(number)*: Epoch timestamp when token expires
  - `connected` *(boolean)*: Connection state flag (`true`)
  - `updatedAt` *(string)*: ISO 8601 timestamp of last token update

---

### 4. Local Development with Firestore

When running locally (`npm run dev`), the app will automatically connect to your live Google Cloud Firestore if:
1. `GOOGLE_CLOUD_PROJECT` is defined in `.env`.
2. You authenticate your local machine using Application Default Credentials:
   ```bash
   gcloud auth application-default login
   ```
If Firestore is unreachable or credentials are not found, the app gracefully falls back to in-memory mock storage.

---

## 🔐 Environment Variables (`.env`)

Critical sensitive parameters, project identifiers, and secrets are configured via environment variables.

### 1. Create your local `.env` file

```bash
cp .env.example .env
```

### 2. Available Variables

| Variable | Default (Local) | Production Example | Description |
| :--- | :--- | :--- | :--- |
| `PORT` | `3000` | `8080` | Port Express listens on (Cloud Run sets this to 8080). |
| `NODE_ENV` | `development` | `production` | Environment mode (`development`, `test`, `production`). |
| `APP_URL` | `http://localhost:3000` | `https://<service>.a.run.app` | Base URL of your deployed backend service. |
| `GOOGLE_CLOUD_PROJECT` | _(ambient)_ | `your-gcp-project-id` | Google Cloud Project ID hosting Firestore and Cloud Run. |
| `GOOGLE_CLIENT_ID` | _(empty)_ | `xxxx.apps.googleusercontent.com` | Optional OAuth Client ID to enforce token audience validation. |
| `SKIP_AUTH_VALIDATION` | `true` | `false` | Set to `true` locally to test without Google ID tokens. Must be `false` in production. |
| `PUBLIC_OAUTH_URL` | _(empty)_ | `https://<project>.web.app/oauth.html` | Public HTTPS URL for the OAuth overlay dialog (e.g. on Firebase Hosting). |
| `DEFAULT_USER` | _(auto-detected)_ | `user@example.com` | Optional fallback user for testing. If omitted, the active signed-in gcloud user is dynamically detected. |

> [!IMPORTANT]
> The `.env` file is excluded from version control by `.gitignore` to prevent accidental credential leaks. Never commit `.env` or private keys to git repositories.

---

## 🛠️ Local Development & Testing

### 1. Install Dependencies

```bash
npm install
```

### 2. Run Locally in Development Mode

```bash
npm run dev
```

The server starts at `http://localhost:3000`. You can verify the health check:

```bash
curl http://localhost:3000/health
```

### 3. Run Automated Tests

The test suite runs 26 unit and integration tests covering card rendering, OAuth overlay transitions, Gmail API contextual triggers, and Firestore token persistence:

```bash
npm test
```

### 4. Local Testing with Google Workspace (via Tunnel)

To test your local server inside live Gmail before deploying:

1. Expose your local port 3000 using `ngrok` or `localtunnel`:
   ```bash
   ngrok http 3000
   ```
2. Copy your forwarding HTTPS URL (e.g., `https://abc1234.ngrok-free.app`).
3. Set `APP_URL=https://abc1234.ngrok-free.app` in your `.env`.
4. Copy `deployment.json.example` to `deployment.json` (if not already done), update `runFunction` with your URL, and deploy as a test add-on (see deployment steps below).

---

## 🚀 Deploying to Production

### Step 1: Deploy Backend to Google Cloud Run

Deploy the Node.js application container directly to Cloud Run:

```bash
gcloud run deploy gmail-workspace-addon \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars "NODE_ENV=production,SKIP_AUTH_VALIDATION=false,GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID,APP_URL=https://YOUR_SERVICE_URL.a.run.app"
```

Once deployment completes, note your Cloud Run Service URL (e.g. `https://gmail-workspace-addon-xxxxx.us-central1.run.app/`).

---

### Step 2: (Optional) Deploy Static OAuth Overlay to Firebase Hosting

To host the OAuth consent dialog on Firebase Hosting (preventing iframe 403 issues inside Gmail):

```bash
# Initialize Firebase if not done
firebase login
firebase use YOUR_PROJECT_ID

# Deploy public/ directory to Firebase Hosting
firebase deploy --only hosting
```

Set `PUBLIC_OAUTH_URL` on your Cloud Run service:

```bash
gcloud run services update gmail-workspace-addon \
  --region us-central1 \
  --set-env-vars "PUBLIC_OAUTH_URL=https://YOUR_PROJECT_ID.web.app/oauth.html"
```

---

### Step 3: Configure `deployment.json` with your Cloud Run URL

Create `deployment.json` from `deployment.json.example` (if not created), then replace the URLs with your Cloud Run Service URL:

```bash
cp deployment.json.example deployment.json
```

```json
{
  "oauthScopes": [
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/gmail.addons.execute",
    "https://www.googleapis.com/auth/gmail.addons.current.message.metadata",
    "https://www.googleapis.com/auth/gmail.addons.current.message.readonly",
    "https://www.googleapis.com/auth/gmail.readonly"
  ],
  "addOns": {
    "common": {
      "name": "Sender Contact Manager",
      "logoUrl": "https://www.gstatic.com/images/branding/product/2x/googleg_48dp.png",
      "homepageTrigger": {
        "runFunction": "https://YOUR_CLOUD_RUN_URL/"
      }
    },
    "gmail": {
      "homepageTrigger": {
        "runFunction": "https://YOUR_CLOUD_RUN_URL/"
      },
      "contextualTriggers": [
        {
          "unconditional": {},
          "onTriggerFunction": "https://YOUR_CLOUD_RUN_URL/"
        }
      ]
    },
    "httpOptions": {
      "granularOauthPermissionSupport": "OPT_IN"
    }
  }
}
```

---

### Step 4: Create or Update the Google Workspace Add-on Deployment

Create or update the deployment using the `gcloud` CLI:

```bash
gcloud workspace-add-ons deployments replace node-workspace-addon \
  --deployment-file=deployment.json
```

Or via Google Cloud Console:
1. Go to **Google Workspace Add-ons > Deployments**.
2. Click **Create Deployment** (or edit existing).
3. Upload or paste [`deployment.json`](deployment.json).
4. Save and copy the generated **Deployment ID**.

---

### Step 5: Install & Test in Gmail

1. Open [Gmail](https://mail.google.com/).
2. Click the **Gear icon (Settings)** in the top right > **See all settings**.
3. Go to the **Add-ons** tab.
4. Under **Developer add-ons**, enter your **Deployment ID** and click **Install**.
5. Refresh Gmail:
   - In your inbox sidebar, click the add-on icon to open the **Contacts Manager** homepage.
   - Click any email message to trigger the contextual card, which automatically prefills the real sender's details and lets you add them to Firestore!

---

## 🔒 Security & OAuth Scopes

The add-on requests only the minimal scopes required to operate:

| Scope | Purpose |
| :--- | :--- |
| `https://www.googleapis.com/auth/userinfo.email` | Identifies the active user in Google Workspace. |
| `https://www.googleapis.com/auth/gmail.addons.execute` | Authorizes Google Workspace to execute the add-on's trigger webhooks. |
| `https://www.googleapis.com/auth/gmail.addons.current.message.metadata` | Grants ephemeral access to read the `From` header of the currently opened email. |
| `https://www.googleapis.com/auth/gmail.addons.current.message.readonly` | Allows reading message details when the contextual trigger fires. |

### Request Verification
Every incoming request to the HTTP backend is validated by [`src/middleware/auth.js`](src/middleware/auth.js):
- Verifies that the Google Bearer token in the `Authorization` header was signed by Google (`accounts.google.com`).
- Enforces audience matching if `GOOGLE_CLIENT_ID` is configured.

---

## 🐛 Troubleshooting

### 1. Sender info shows empty when opening an email
- Verify that `deployment.json` includes `https://www.googleapis.com/auth/gmail.addons.current.message.metadata`.
- Ensure the user accepted the permissions dialog when installing or updating the add-on.

### 2. Overlay shows "403 Forbidden" or refuses to load inside iframe
- Google Workspace Add-on `OVERLAY` windows enforce strict frame and HTTPS rules.
- Deploy the overlay HTML to **Firebase Hosting** or a public HTTPS CDN and set `PUBLIC_OAUTH_URL`.

### 3. "Unauthorized: Missing or invalid Authorization header" (401)
- In local development, ensure `SKIP_AUTH_VALIDATION=true` in `.env`.
- In production, ensure `SKIP_AUTH_VALIDATION=false` and that requests originate from Google Workspace.

### 4. Firestore permission denied error
- Check that the Cloud Run service account has the **Cloud Datastore User** or **Firestore User** IAM role in your Google Cloud Project.

---

## 📄 License

Apache-2.0

