# pi-context-lean

**Keep the instructions you need. Trim the history you don’t.**

A [Pi](https://pi.dev) extension that reduces outgoing context by removing
superseded skill instructions and condensing old tool exchanges. Your saved
session transcript stays unchanged.

## Features

- **Skill-aware cleanup.** Keeps the latest complete load of each active skill
  and omits older copies, including instructions from before a file was edited.
- **Explicit unloading.** Lets the assistant retire skills it no longer needs
  and load them again later.
- **Compact tool history.** Replaces completed historical tool exchanges with
  labeled digests, bounded excerpts, and references to repeated output.
- **Conservative preservation.** Leaves active or uncertain skill reads, errors,
  images, and unfinished tool exchanges out of generic digestion.
- **Visible savings.** `/context-lean` shows what changed in the latest pass.

## Installation

Install from this repository:

```bash
pi install git:github.com/brunoCCOS/pi-context-lean
```

Or try it for one session without registering it:

```bash
pi -e git:github.com/brunoCCOS/pi-context-lean
```

For a project-only installation, add `-l` to `pi install`. To use a local
checkout instead:

```bash
pi install /absolute/path/to/pi-context-lean
```

Start a fresh Pi session after installing. Context Lean runs automatically
before each model request; no additional configuration is required.

> Pi extensions run with full system access. Review the source before installing,
> and load only one copy of Context Lean. Remove any previous loose
> `context-lean.ts` installation first.

## Usage

### Load skills as usual

Use `/skill:name` or let the assistant read a skill’s `SKILL.md` with Pi’s
built-in `read` tool. The latest complete instructions remain active; older
loads are omitted from subsequent model requests. User arguments accompanying
`/skill:name` are preserved.

Partial reads are combined only when the extension can establish complete
coverage from line 1 through the end of the file. Otherwise, it keeps the
instructions rather than risk dropping them.

### Unload a skill

Ask the assistant to unload a skill it no longer needs. The assistant must send
a final reply containing only this marker, with the skill’s name:

```text
[[UNLOAD_SKILL:example-skill]]
```

This is an **assistant marker, not a slash command**. Pasting it as a user
message does not unload anything. Multiple markers may appear on separate
lines, but the reply must contain no other prose, code fences, or tool calls
and must finish normally. Names may contain only lowercase letters, digits,
and hyphens, and must identify one skill path unambiguously.

Reading the skill again or invoking `/skill:name` reloads it.

### Check context savings

After a model request, run:

```text
/context-lean
```

The notification shows message size before and after cleanup, retired skill
loads, digested tool exchanges, repeated-output references, and preservation
counts.

These figures describe the **latest pass**, not cumulative savings. Sizes are
serialized message characters—not tokens or final provider request size.
A pass can increase size; token, latency, and cost reductions are not guaranteed.

## How it works

```text
Session history                      Context sent to the model
──────────────────────────────────   ──────────────────────────────────
Read a skill                         Notice: older skill load omitted
Read the same skill after an edit    Latest complete instructions
Old, completed command exchange      Historical digest with excerpts
Current tool exchange                Unchanged
```

Only complete tool exchanges before a normal final assistant reply are eligible
for digestion. Calls and their matching results are replaced together; the
current tool loop stays intact. Groups with ambiguous pairing or a mix of skill
reads and unrelated tools are preserved.

Digests retain excerpts, **not every detail**. This is a lossy context
transformation, not a semantic summary or transcript deletion. Consult the saved
transcript when omitted output matters; rerunning a command may have side
effects or produce different results.

## Limitations

- Targets Pi **0.85.1**. Compatibility with other versions is not established.
- Tracks native `/skill:name` expansions and built-in `read` calls, not shell
  reads, MCP tools, or replacement readers.
- Incomplete reads, uncertain paths, and missing metadata can reduce cleanup.
- Works from the context available on each pass. It cannot recover history
  removed by compaction or guarantee a consistent file snapshot across
  paginated reads.
- Unload-marker checks are not a prompt-injection security boundary.

## Uninstall

```bash
pi remove git:github.com/brunoCCOS/pi-context-lean
```

Add `-l` for a project-only installation. If you installed from a local path,
use that path instead of the Git source. Start a fresh Pi session afterward.

## License

[MIT](LICENSE) © 2026 Bruno Llacer Trotti
