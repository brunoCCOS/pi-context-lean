# pi-context-lean

**Keep the instructions you need. Trim the history you don’t.**

A Pi extension that removes superseded skill instructions and condenses old tool exchanges before they reach the model.
Your saved session transcript stays unchanged.

Long sessions accumulate repeated skill loads, verbose command output, and tool
results the assistant has already consumed. Context Lean reduces that repetition
without treating an active skill as disposable just because its tool call is old.

## What it does

- **Keeps the latest complete skill load.** Rereading a skill replaces its older
  instructions in outgoing context—even when the file’s contents have changed.
- **Supports explicit unloading.** The assistant can retire a skill when it is
  no longer needed, then load it again later.
- **Condenses eligible tool history.** Completed exchanges become labeled
  digests with bounded excerpts, cleaned terminal output, and references to
  repeated results.
- **Preserves uncertain cases.** Active skill instructions, incomplete reads,
  errors, images, and unfinished tool exchanges stay out of generic digestion.
- **Shows what changed.** `/context-lean` reports the latest pass’s size and
  cleanup counts.

For example:

```text
Session history                      Context sent to the model
──────────────────────────────────   ──────────────────────────────────
Read a skill                         Notice: older skill load omitted
Read the same skill after an edit    Latest complete instructions
Old, completed command exchange      Historical digest with excerpts
Current tool exchange                Unchanged
```

This is a context transformation, not transcript deletion or a semantic summary.
Tool digests are lossy; the original exchanges remain in the saved session.

## Install

With Pi installed, register your local checkout:

```bash
pi install /absolute/path/to/pi-context-lean
```

Start a fresh Pi session. The extension runs automatically before each model
request; there is nothing else to enable in the conversation.

For a project-only installation, use `pi install -l` instead. Local installations
reference the checkout directly, so edits there affect the loaded extension.

Pi also supports Git sources. Substitute this repository’s actual URL and an
existing release tag:

```bash
pi install 'git:<host>/<owner>/pi-context-lean@<tag>'
```

Review extensions before installing them: they run with your system privileges.
Install only one copy. If you already load a loose `context-lean.ts`, see
[Migration](#migration).

## Usage

### Load skills normally

Use Pi’s `/skill:name` command or let the assistant read a skill’s `SKILL.md` with
the built-in `read` tool. Context Lean identifies loads by their paths and paired
tool calls—not by searching for matching instruction text.

A skill stays active until a complete replacement is available or the assistant
explicitly unloads it. Paginated reads are combined only when continuous coverage
from line 1 through EOF can be established. Uncertain reads preserve instructions
rather than risk dropping them. User arguments accompanying `/skill:name` remain
intact when older skill instructions are omitted.

### Unload a skill

Ask the assistant to unload a skill it no longer needs. It must emit a final reply
containing only this marker, using the skill’s name:

```text
[[UNLOAD_SKILL:example-skill]]
```

This is an **assistant marker, not a slash command**. Pasting it yourself does not
unload anything. Multiple markers can appear on separate lines, but extra prose,
code fences, tool calls, or an interrupted reply invalidate the message. Names
must contain only lowercase letters, digits, and hyphens and identify one skill
path unambiguously.

A subsequent read or `/skill:name` invocation loads the skill again.

### Inspect the savings

After a model request, run:

```text
/context-lean
```

The notification reports:

- Serialized message size before and after cleanup.
- Digested exchanges, repeated-output references, and cleaned or excerpted output.
- Retired skill loads and omitted payloads, counted separately for multipart reads.
- Protected tool groups and retained tool-result envelopes.

Figures describe the **latest context pass**, not cumulative savings. Sizes are
characters, not tokens or the final provider request size; a pass can increase
size. Retained tool-result envelopes may contain omission notices.

## How tool digestion works

Only complete historical call/result groups preceding a normal final assistant
reply are eligible. The current tool loop remains intact. When a group is
condensed, its calls and matching results are replaced together, avoiding orphan
tool results.

The digester preserves groups containing active or uncertain skill reads, errors,
non-text results, or ambiguous pairing. Groups mixing skill reads with unrelated
tools also remain intact, so retiring a skill does not shorten a sibling result.

Digests retain excerpts, **not every detail**. If omitted information matters,
consult the saved transcript or reread the source. Repeating a command may have
side effects or return different data; it is not a substitute for the original
record.

## Manage the extension

```bash
pi list                 # Show package registrations
pi config               # Enable or disable resources
pi update --extensions  # Update installed packages, not Pi itself
```

Use `pi config -l` for project overrides. Pinned Git sources stay at their
configured ref; install the same source with a different tag to change the pin.
Keep development work in your own checkout, not Pi-managed Git clones, which may
be reset during updates.

To remove a local installation:

```bash
pi remove /absolute/path/to/pi-context-lean
```

Add `-l` if you installed it in project scope. For Git installations, remove the
configured source shown by `pi list`. Start a fresh session after disabling or
removing the extension.

### Migration

If you previously installed `context-lean.ts` as a loose extension:

1. Back it up outside Pi’s extension discovery directories.
2. Remove or disable the old registration, including any `-e` launch argument.
   Check both global and project settings; renaming a file in place may not stop
   discovery.
3. Install this package and start a fresh session.
4. Check loaded resources for exactly one Context Lean extension and one
   `/context-lean` command. `pi list` alone does not reveal loose extensions.

To roll back, disable or remove the package first, restore the loose copy, and
start a fresh session. Never run both copies together.

## Compatibility and limitations

- Developed against Pi **0.85.1** APIs and built-in read semantics. Compatibility
  with other versions is not established by the wildcard peer dependency.
- Skill tracking supports native `/skill:name` expansions and the built-in
  `read`. Shell reads, MCP tools, and replacement readers are outside its scope.
- Explicit read limits, missing metadata, uncertain paths, and overlapping reads
  can prevent proving completeness—and therefore reduce savings.
- State is reconstructed from available context on every pass. It cannot recover
  history removed by compaction, resolve every filesystem alias, or guarantee an
  atomic snapshot across paginated reads.
- Unload origin checks prevent incidental text from acting as a marker; they are
  not a prompt-injection security boundary.
- There is no automated regression suite or guaranteed reduction in tokens,
  latency, or cost. Validate behavior in a disposable session before relying on
  it for important work.

## License

[MIT](LICENSE) © 2026 Bruno Llacer Trotti
