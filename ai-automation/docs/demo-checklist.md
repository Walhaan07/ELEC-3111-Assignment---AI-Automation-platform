# Level 4 — the checklist we work through before every demonstration

Levels 1–3 run automatically. These are the things only a person can confirm,
and every one of them has ended somebody's demo at some point.

## The day before

- [ ] `git clone` into a **brand-new folder**, then the five commands from the
      README. Whatever breaks is the evening's priority.
- [ ] `npm test` and `npm run e2e` both green on that fresh clone.
- [ ] Restore a backup into a scratch database: `./infra/restore.sh backups/<latest>.sql.gz`.
      A backup nobody has restored is not a backup.
- [ ] The live site answers over HTTPS from a phone **on mobile data**, not the
      campus wifi.
- [ ] Reboot the server from the AWS console. All three containers come back by
      themselves, and `restored N schedule(s)` appears in the log.

## The morning of

- [ ] **Press Connect on every Google credential.** In Testing mode a refresh
      token lasts seven days. This takes forty seconds and it has ended more
      student demos than any bug.
- [ ] Fire the webhook once from a phone and confirm a row appears.
- [ ] Check `ANTHROPIC_API_KEY` still works: run the AI node once.
- [ ] Clear old executions if the list is noisy, so the demo's runs stand out.
- [ ] Have the failure screenshots ready in a tab — they are half the marks.

## The demonstration itself, in order

1. **Draw it.** Drag Webhook, AI, IF, Gmail and Sheets onto an empty canvas and
   connect them. Do not use a prepared workflow for this part.
2. **Show the panel drawing itself.** Change the Gmail node's operation and
   watch the fields change. Say the sentence: nobody wrote that form.
3. **Show an expression.** Type `{{ $json.body.message }}` and point at the
   preview showing what it will actually become.
4. **Fire it from a phone.** Real webhook, real network, mobile data.
5. **Watch the canvas.** Nodes light up one at a time; the IF node's false
   branch greys out. Item counts and milliseconds appear under each box.
6. **Show the result.** A real email arrives; a real row appears in a
   spreadsheet that is already open on screen.
7. **Break it on purpose.** Point the HTTP node at `https://httpstat.us/503`
   and show three retries and then a clean failure that names the node.
8. **Show the executions list.** The failed run is there, with the node name in
   the message, three days after the fact.

## Things to have ready to say

- The Code node's sandbox is a worker thread with a timeout and a memory limit.
  A determined attacker can still escape a `vm` context; a production platform
  uses `isolated-vm` or a container per execution. We know which wall we built.
- n8n does far more per run than we do, so being faster mostly means we do less.
  Saying that plainly is worth more than the number.
- Our p(95) beside n8n's, from three runs each, with the container limits stated.

## The six deliberate failures to rehearse

| Show this | It proves |
| --- | --- |
| A misspelled node name in a connection | validation happens before anything runs |
| `while (true) {}` in the Code node | the timeout fires, and the server still answers |
| A Sheets-only credential on the Gmail node | the scope message, not a bare 403 |
| The same webhook delivered twice with one `Idempotency-Key` | one execution, not two |
| Saving the same workflow from two browser tabs | 409, and nobody's work is lost |
| An expression with a typo | the panel warns instead of crashing |
