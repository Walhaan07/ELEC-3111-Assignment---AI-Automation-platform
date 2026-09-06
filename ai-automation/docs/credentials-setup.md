# Connecting Google, and running the AI node

Two separate jobs. The Google nodes need a real Google account and about fifteen
minutes of clicking in the Cloud Console. The AI node needs either an API key
**or** nothing at all if you run a model on your own laptop.

---

## Part 1 — The Google nodes

### 1 · Create the project and switch on the four APIs

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and sign in
   with the account that will own this.
2. Project dropdown in the top bar → **NEW PROJECT** → name it `ai-automation`
   → **CREATE**.
3. Wait for the notification, then **select the new project** from the same
   dropdown. Everything after this happens inside it — this is the step people miss.
4. In the search bar type **Google Sheets API** → open it → **ENABLE**.
5. Repeat for **Google Drive API**, **Google Docs API** and **Gmail API**.
   Four separate enables.

### 2 · The consent screen, and the test-user list

1. Left menu → **APIs & Services → OAuth consent screen**.
2. Choose **External** → **CREATE**. Leave publishing status as **Testing** —
   we never publish.
3. App name `AI Automation Platform`, your email for both support and developer
   contact → **SAVE AND CONTINUE**.
4. **ADD OR REMOVE SCOPES** → tick these four:
   - `.../auth/spreadsheets`
   - `.../auth/drive.file`
   - `.../auth/documents`
   - `.../auth/gmail.send`

   → **UPDATE** → **SAVE AND CONTINUE**.
5. **Test users → ADD USERS** → paste every group member's Gmail address, plus
   the demonstrator's. **Anybody not on this list simply cannot connect.**

### 3 · The client ID and the exact redirect address

1. **APIs & Services → Credentials → CREATE CREDENTIALS → OAuth client ID**.
2. Application type **Web application**, name it `server`.
3. Under **Authorised redirect URIs** click **ADD URI** and paste this,
   character for character including the trailing path:

   ```
   http://localhost:5678/rest/oauth2-credential/callback
   ```

   Add the live one now too, if you already have a domain:

   ```
   https://your-domain.com/rest/oauth2-credential/callback
   ```

4. **CREATE**, then copy the **Client ID** and **Client secret**. The secret is
   shown once.

### 4 · Put them in `.env`

Open `.env` in VS Code and fill in three things:

```ini
GOOGLE_CLIENT_ID=1234567890-abcdef.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-secret-here
ENCRYPTION_KEY=<64 hex characters, see below>
```

**Generate a real encryption key before you connect anything:**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The example file ships with 64 zeros, which boots fine but is not a secret. It
matters here because this key is what encrypts the Google tokens. **Change it
after connecting and every stored credential becomes unreadable** — you would
get `Credential could not be decrypted - has ENCRYPTION_KEY changed?` and have
to press Connect again.

Then restart the app, because `.env` is only read at startup:

```bash
# Ctrl+C to stop, then
npm run dev
```

### 5 · Connect an account

1. Open <http://localhost:5173> → **Credentials**.
2. Type a name you will recognise — `Sheets - group account` — pick the type,
   press **Add**.
3. Press **Connect**. Google opens.
4. **"Google hasn't verified this app"** appears. This is expected while the app
   is in Testing mode, not a mistake. Click **Advanced** →
   **Go to AI Automation Platform (unsafe)**.
5. Approve the permissions. You land back on a page saying **Connected**.

The credential row now says *Connected*, with an expiry. No token is ever shown
on that page, and none is ever sent to a browser — the server holds an
AES-256-GCM envelope and hands out only "connected" and "expires at".

### 6 · Use it in a workflow

1. Drag **Google Sheets** onto the canvas and click it.
2. The panel's first field is **Credential** — choose the account you just
   connected. Until you do, the field is red and **Run is disabled**.
3. Fill in the spreadsheet URL, sheet name and columns:

   ```json
   { "customer": "{{ $json.body.customer }}", "total": "{{ $json.body.total }}" }
   ```

4. Press **Run**.

Column order follows the **header row in the sheet**, not the order of keys in
your JSON — rename a column in Google Sheets and the node follows it without a
code change. Fifty items become one API call, not fifty.

### When it goes wrong

| What you see | What it means |
| --- | --- |
| `This node has no credential selected` | Nothing chosen in the panel's Credential box |
| `"X" is a googleSheets credential, not gmail` | Wrong account type for that node |
| `was not granted the scope this node needs` | You ticked the wrong scopes at step 2.4 — reconnect |
| `Google did not send a refresh token` | You approved this app before. Remove it at [myaccount.google.com/permissions](https://myaccount.google.com/permissions) and press Connect again |
| `Google has expired this connection` | Testing-mode tokens last **seven days**. Press Connect again |

**Put a reminder in the group chat for the morning of the demonstration: press
Connect once on every credential.** It takes forty seconds and it has ended more
student demos than any bug.

---

## Part 2 — The AI node, on your own laptop

The AI node speaks two dialects. The local one needs no key, no account, no
internet and costs nothing, which makes it the sensible choice while building.

### With LM Studio

1. Install [LM Studio](https://lmstudio.ai) and open it.
2. **Discover** (magnifying glass) → download a small instruct model. Something
   in the 7–8B range is plenty for classification, for example
   `Qwen2.5 7B Instruct` or `Llama 3.1 8B Instruct`.
3. **Developer** tab (`>_` icon on the left) → load the model → **Start Server**.
   It says `http://localhost:1234`.
4. In the editor, drag in the **AI** node and set:
   - **Where the model runs** → `On this machine - LM Studio, Ollama, vLLM`
   - **Server address** → `http://localhost:1234/v1`
   - **Model name** → leave **empty**. The node asks LM Studio which model is
     loaded and uses that.
5. Press **Run**.

### With Ollama instead

Same node, one different address:

```
Server address:  http://localhost:11434/v1
Model name:      llama3.1        (Ollama needs the name; it serves several at once)
```

### Getting good JSON out of a small model

Leave **Expect JSON** on and keep **Required keys** filled in. The node pulls
the JSON out of a ```` ```json ```` fence if the model wraps it, and fails with
*"The model did not return JSON. It said: …"* if it answers in prose — which is
much easier to debug than a downstream node mysteriously seeing `undefined`.

A system prompt of `Answer with JSON only. No explanation.` makes a noticeable
difference on smaller models.

### With the hosted API instead

Set **Where the model runs** to *Anthropic - hosted*, put a key in `.env`:

```ini
ANTHROPIC_API_KEY=sk-ant-...
```

and restart. Pick the model from the dropdown.

### When it goes wrong

| What you see | What it means |
| --- | --- |
| `Could not reach a model server at …` | LM Studio is not running, or **Start Server** was never pressed |
| `No model is loaded at …` | The server is up but no model is loaded — load one, or type its name |
| `did not answer within two minutes` | A big model on CPU. Use a smaller one, or lower Max tokens |
| `The model did not return JSON` | It answered in prose. Strengthen the system prompt |
| `The answer is missing: urgency` | It returned JSON without a key you required |

### Worth saying in the report

The same node, the same prompt and the same downstream IF work against a hosted
frontier model and a 7B model on a laptop — because the node's only contract
with the rest of the workflow is *"items in, items out"*. Being able to
demonstrate the platform with no internet and no API spend is a real result, and
so is the honest observation that the small local model needs a firmer prompt to
produce reliable JSON.
