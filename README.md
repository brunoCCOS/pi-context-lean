# pi-context-lean — keep the instructions you need, drop the history you don't

A [Pi](https://pi.dev) extension that makes each request to the model smaller
without touching your session file. It does two things on the way out:

- **retires stale skill instructions** — you only keep the newest copy of each
  skill, not the four times it got re-read;
- **condenses finished tool exchanges** — old `bash`/`read` round-trips become
  short labelled digests instead of full transcripts.

Your saved transcript on disk is never modified. Context Lean rewrites the
*copy* of the conversation that goes to the provider, once per request.

## Why this exists

Long sessions rot in a very specific way. You load a skill, the agent reads
`SKILL.md` — three thousand tokens of instructions. Twenty turns later it reads
the same file again, because the file changed, or because a subagent came back,
or just because it forgot. Now you're paying for both copies, and the model has
to guess which one is current. Meanwhile the `npm test` output from an hour ago
is still sitting in context in full, complete with a progress bar rendered one
carriage-return frame at a time.

None of that is *wrong*, exactly. It just isn't useful anymore, and it's
crowding out things that are. The usual remedy is compaction, which is lossy in
a way you can't predict and throws away recent detail along with the old.

Context Lean takes the narrower bet: some parts of the history are provably
superseded, and those can go without anyone having to summarize anything. A
skill read that was replaced by a newer complete read of the same file is dead
weight. A tool call whose result the assistant already used and replied about is
history. Everything else is left exactly as it was.

The design rule throughout is **fail closed**: when the extension can't prove
something is safe to drop, it keeps it verbatim.

## What you get

| | |
| --- | --- |
| **Skill-aware cleanup** | Keeps the latest complete load of each skill; older copies become a one-line notice. Survives file edits — a re-read after an edit supersedes the pre-edit copy, not the other way round. |
| **Explicit unloading** | The agent can retire a skill it's finished with, and load it again later. See [Unloading](#unloading-a-skill). |
| **Compact tool history** | Completed historical exchanges collapse into labelled digests with bounded excerpts (300 chars of arguments, 800 of output). |
| **Repeat detection** | Two identical exchanges? The second points at the first instead of repeating it. |
| **Terminal de-noising** | Carriage-return progress spam (`Downloading 12% … 34% … 87%`) collapses to its last frame — but only for output that matches a recognizable progress template, so real diagnostics never get mistaken for disposable frames. |
| **Visible effect** | `/context-lean` reports what the last pass actually did. |

## How it works

Every time Pi is about to call the model, the extension gets the outgoing
message list, rebuilds what happened, and rewrites it:

```text
Session history (on disk, untouched)   Context sent to the model
────────────────────────────────────   ──────────────────────────────────
Read skills/foo/SKILL.md               "[skill was loaded again — keeping
                                        only the most recent copy]"
…file gets edited…
Read skills/foo/SKILL.md again         full, current instructions
bash npm test  (finished, replied to)  Tool exchange #1: bash {...} + excerpt
read src/app.ts (current loop)         unchanged
```

Two mechanisms, both conservative.

### Retiring skill loads

The extension reconstructs skill loads from two sources: Pi's native
`/skill:name` expansion (the `<skill name=… location=…>` wrapper in a user
message) and built-in `read` calls on a `SKILL.md`. Identity is the resolved
**file path**, decided lexically — it never stats the filesystem or compares
today's file contents against what history says was read, because that would
make cleanup depend on the state of your disk rather than the state of the
conversation.

A load only counts as *complete* when coverage runs from line 1 to end-of-file.
Paginated reads are stitched together, but only when the extension can prove
contiguous coverage from the read's own truncation metadata — never by parsing
"… 40 more lines" footers out of the text. If coverage can't be established, the
load stays a candidate and its instructions are kept.

Once a newer complete load exists, older ones are replaced with a short notice
in place. Only the instruction payload is rewritten; the tool call and result
envelopes around it stay intact so the transcript structure and tool pairing are
never disturbed.

Deliberately preserved: reads that failed or returned an error, non-text or
image results, ambiguous or unresolvable paths, overlapping concurrent reads of
the same file, and anything read in a session whose working directory has moved
since (relative paths can't be resolved safely there, so only absolute
identities still work).

### Digesting tool exchanges

Only exchanges *before the assistant's last normal reply* are eligible — a
finished reply is the evidence that the loop was consumed. The current tool loop
is always left verbatim, including mid-retry.

A group is digested only if it's whole, contiguous, and unambiguous: every call
has exactly one matching result, no duplicate IDs, nothing interleaved. Calls
and their results are always replaced together, so the model never sees a call
without its answer.

Left alone, on purpose:

- errors (`isError`) — the failure detail is usually the point;
- images and other non-text blocks;
- results that registered deferred tool definitions (removing the result would
  remove the tool's load point);
- groups mixing a skill read with unrelated tools — retiring instructions must
  not quietly shorten a parallel result that had nothing to do with it;
- reasoning blocks from a tool-calling message: spoken text is kept, but
  reasoning that accompanied now-removed calls isn't replayed.

> **Digests are excerpts, not summaries.** This is a lossy character-budget
> transformation, not semantic compression. If omitted output matters, read the
> saved transcript — re-running the command may have side effects or give a
> different answer.

## Install

Requires Pi. This is an extension, not a standalone CLI — use `pi install`, not
`npm install -g`.

```bash
pi install npm:pi-context-lean          # user-wide
pi install -l npm:pi-context-lean       # project-only (.pi/settings.json)
pi -e npm:pi-context-lean               # try it for one session, no registration
pi install npm:pi-context-lean@0.1.0    # pin a version (skipped by pi update)
```

From source, for development:

```bash
pi install git:github.com/brunoCCOS/pi-context-lean
pi install /absolute/path/to/pi-context-lean
```

Start a fresh session afterwards. There's nothing to configure — it runs before
each model request on its own.

> Pi extensions run with full system access; read the source before installing.
> Load exactly **one** copy — if you had a loose `context-lean.ts` lying in an
> extension folder, remove or disable it first, and check both the user and
> project sections of `pi list`. Two copies will each try to rewrite the same
> context.

Updating and removing:

```bash
pi update npm:pi-context-lean
pi remove npm:pi-context-lean
```

Use the exact source string shown by `pi list` (pinned version, Git ref, or
local path), add `-l` for project scope, and start a fresh session after. If
`pi remove` leaves a registration behind, remove the matching entry from the
`packages` array in `~/.pi/agent/settings.json` or `<project>/.pi/settings.json`
by hand. Removing a local registration never deletes your checkout.

## Usage

### Load skills as usual

Use `/skill:name`, or let the agent `read` a `SKILL.md`. The newest complete
instructions stay active; older loads drop out of later requests. Arguments you
passed alongside `/skill:name` are preserved byte-for-byte, whitespace included.

### Unloading a skill

Ask the agent to unload a skill it's done with. It retires the skill by sending
a final reply containing nothing but the marker:

```text
[[UNLOAD_SKILL:example-skill]]
```

This is an **assistant marker, not a slash command** — pasting it yourself as a
user message does nothing. Several markers may appear on their own lines, but
the reply must contain no other prose, no code fences and no tool calls, and
must finish normally. Names are lowercase letters, digits and hyphens, and must
resolve to exactly one skill path (ambiguous names are ignored rather than
guessed at). Reading the skill again, or `/skill:name`, brings it back.

The marker convention is cooperative, not a security boundary — see
[Limits](#limits).

### Seeing what it did

```text
/context-lean
```

Reports serialized characters before and after, retired skill loads, digested
exchanges, repeated-output references, terminal-cleaned and excerpted outputs,
and how many groups were protected from digestion.

Read those numbers honestly: they describe the **latest pass only**, they count
serialized message characters rather than tokens or final provider request size,
and a pass can legitimately come out *larger*. Token, latency and cost savings
are plausible consequences, not guarantees.

## Limits

- Built and checked against Pi **0.85.1** and Node **24.16.0**. Other versions
  are untested, and the read-coverage logic is deliberately tied to the shape of
  Pi's built-in `read` metadata.
- Tracks native `/skill:name` expansion and the built-in `read` tool only — not
  shell `cat`, MCP file tools, or replacement readers.
- Incomplete reads, uncertain paths and missing metadata all reduce cleanup, by
  design. Less cleanup is the safe failure mode.
- Works only from the context it's handed each pass. It can't recover history
  already removed by compaction, and can't guarantee a consistent file snapshot
  across paginated reads.
- Unload-marker validation is a correctness check, not a prompt-injection
  defense. Don't treat it as one.

### What was actually verified

Release 0.1.0 passed 56 isolated runtime smoke checks against Pi 0.85.1 and Node
24.16.0, using Pi's real extension loader, native file reader, and temporary
session storage — covering hook and command registration, changed-file reloads,
unload/reload and malformed markers, pagination and gaps, oversized lines,
wrapper argument and image preservation, digestion and call/result pairing,
preservation of active skills and errors, statistics, session reset, and that
saved transcripts stay byte-identical.

These were ad-hoc checks, not a committed test suite. No model calls were made,
and there was no live provider or TUI end-to-end run. Treat it as "the paths I
exercised behaved", not as exhaustive verification.

## Repo layout

```text
package.json                  pi package manifest (pi.extensions)
extensions/context-lean.ts    the whole extension — Pi loads the TS directly
```

## Releasing (maintainers)

No build step: Pi loads the shipped TypeScript as-is.

Bump `version` in `package.json` first — npm name/version pairs can never be
reused, even after an unpublish. Then, from an ordinary interactive terminal
(not through Pi's shell runner, so npm can finish its browser/2FA challenge):

```bash
npm pack --dry-run --ignore-scripts     # expect exactly 4 files
npm login  --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm publish --access public --registry=https://registry.npmjs.org/
```

`npm pack` should list only `package.json`, `extensions/context-lean.ts`,
`README.md` and `LICENSE` — the `files` allowlist keeps `.local/` and `.pi/` out
of the tarball. Login alone doesn't approve a publish: follow the URL npm
prints, complete the browser challenge (open it manually under WSL), and leave
the terminal running until it finishes. An `EOTP` error usually means npm
couldn't start that flow — retry interactively. Never share approval URLs, OTPs
or tokens.

Then verify for real, in a Pi configuration with no other copy enabled:

```bash
npm view pi-context-lean version
pi install npm:pi-context-lean
```

Start a session, make a request, check `/context-lean`. A package preview proves
nothing about runtime behaviour. Note that README changes in this repo do *not*
update the README bundled in an already-published version — docs ship with the
next release.


## License

[MIT](LICENSE) © 2026 Bruno Llacer Trotti
