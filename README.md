# pi-context-lean

A Pi extension that reduces repeated skill instructions and digests eligible
historical tool exchanges in the context sent to the model. It leaves the full
saved session transcript unchanged. It registers one extension and the
`/context-lean` command; there is no custom installer.

**Release status:** implementation and manual qualification are still in progress.
No public repository URL or release tag is configured, and no npm publication is
claimed. See [Verification status](#verification-status) before using it.

## What changes in context

### Skill loads

- Skill identity comes from the path in a built-in `read` call paired with its
  result by call ID, or the location in a native `/skill:name` expansion—not from
  matching instruction text against today's file contents.
- The newest complete load stays active until a later complete load supersedes it
  or an explicit unload retires it. A completed read does not mean the assistant
  has finished using the skill.
- Multipart reads are kept together conservatively. Earlier instructions retire
  only when a replacement has proven contiguous coverage from line 1 through EOF.
  A later chunk alone is not a replacement. Uncertain limit reads, gaps, ambiguous
  grouping, missing pairs, and unknown EOF preserve instructions rather than
  guessing. Explicit read limits may prevent proving completeness.
- For recognized skill wrappers, only the retired instruction payload is omitted;
  accompanying user arguments remain. Retired loads receive omission notices,
  consolidated only where the tool protocol permits.
- Paths are normalized with available cwd evidence. This is not universal
  filesystem-alias deduplication or an atomic snapshot across multiple reads.
  Lifecycle state is reconstructed from the available context each pass; history
  lost through compaction cannot be reconstructed from current file contents.

### Explicit unload

Ask the assistant to emit a final reply containing only markers, for example:

```text
[[UNLOAD_SKILL:example-skill]]
```

This is **not** a slash command. The marker must come from a normally completed
assistant message made solely of text blocks. Every nonblank line must be a valid
marker; prose, quotation fences, tool calls, or other content invalidate the whole
message. Names contain only lowercase letters, digits, and hyphens, and must
resolve unambiguously to one skill path. Multiple markers may occupy separate
lines.

Markers in user messages, tool output, reasoning, errors, or aborted assistant
messages do not authorize unloading. A valid unload retires attributable loads
already present; it does not prevent a later read from loading the skill again.
Origin checks are not a security boundary: model-generated text can still be
influenced by instructions it encounters.

### Historical tool digests

After a normal final assistant reply, eligible older, complete call/result groups
may become labeled historical digests. These are **lossy**: terminal formatting is
cleaned, arguments and outputs may be excerpted, and identical outputs may refer
to an earlier digest in the same outgoing context.

The current tool loop, active or uncertain skill reads, mixed skill/unrelated
groups, errors, non-text results, and ambiguous or incomplete groups stay out of
generic digestion. Retired skill payloads may already contain omission notices
inside otherwise retained groups. Digestion removes calls and their matching
results together rather than leaving orphan results.

If detail is needed again, ask the assistant to reread the file or consult the
original saved transcript. Rerunning a command is appropriate only if its side
effects are understood; a new read or run may observe different data.

### Statistics

Run `/context-lean` inside Pi after a model request. Its UI notification describes
only the **latest outgoing context pass**, not a whole turn or cumulative savings:

- Serialized message characters before and after, including any size increase.
  These are not tokens or the final provider request size.
- Digested exchanges, repeated-output references, terminal-cleaned outputs, and
  excerpted exchanges.
- Retired logical skill loads separately from individual instruction payloads
  omitted, so a multipart load is not counted as several retired loads.
- Complete groups protected from digestion and retained tool-result envelopes.
  Retained envelopes may contain omission notices, not verbatim instructions.

There is no guaranteed size, latency, cost, or performance improvement. The
extension rescans available history on each context pass.

## Install and manage

**Review the source first.** Pi extensions execute with your system privileges.
This package adds neither a sandbox nor a privacy guarantee. If migrating from a
loose extension, follow the migration sequence below before enabling the package.

With Pi installed, register your reviewed local checkout:

```bash
pi install /absolute/path/to/pi-context-lean
pi list
pi config
```

Local packages reference the checkout without copying it. Develop there, not in
a Pi-managed Git clone. Global installation uses `~/.pi/agent/settings.json`;
project installation uses `.pi/settings.json`:

```bash
pi install -l /absolute/path/to/pi-context-lean
pi config -l
```

Choose one scope. Do not copy the extension into both global and project
auto-discovery directories. `pi config` starts with global settings and supports
switching to project settings with Tab; `pi config -l` starts in project overrides.
Use it to enable or disable the package's extension, then start a fresh session.

Once the owner supplies a real remote and release tag, the Git install template
is below. **Replace the placeholders; no such remote or tag is asserted here.**

```bash
pi install 'git:<host>/<owner>/<repository>@<tag>'
```

Prefer an explicit release tag for reproducibility. Manage package updates with:

```bash
pi update --extensions
```

Plain `pi update` updates Pi itself, not its packages. Unpinned Git sources follow
Pi's native update behavior. Pinned refs are reconciled to their configured ref;
updates do not select a newer tag. To change a pin, use `pi install` with the same
repository source and the new tag. Pi-managed Git clones are disposable:
reconciliation may reset and clean them. Never keep development work there.

Disable the extension with `pi config`, or remove the local registration with:

```bash
pi remove /absolute/path/to/pi-context-lean
# If installed in project scope instead:
pi remove -l /absolute/path/to/pi-context-lean
```

For Git packages, use `pi remove <source>` with the configured source shown by
`pi list`. Start a fresh session after disabling or removing a registration.

## Migrate from a loose extension

These are owner actions, not automatic package behavior:

1. Back up the existing loose extension **outside** both `~/.pi/agent/extensions/`
   and `.pi/extensions/`, and outside any other configured discovery path. Keep
   the backup for rollback; merely renaming a `.ts` file in place is insufficient.
2. Disable or move the loose copy out of discovery and remove any explicit
   registration or launch-time `-e` argument that loads it. Check both scopes.
3. Install and enable the package in the chosen scope. Start a fresh Pi session.
4. Inspect loaded resources and settings: there should be exactly one
   `context-lean` extension path and one `/context-lean` command, with no duplicate
   registration warnings. `pi list` alone cannot rule out loose-file discovery.
5. Make a model request, run `/context-lean`, and perform the checks below.

For rollback, disable/remove the package registration first, restore or re-enable
the backed-up loose copy, and start a fresh session. Verify one instance again.
Never run the loose and packaged copies concurrently in either direction. This
package does not delete the old extension or edit your settings itself.

## Verification status

The implementation was developed against inspected Pi **0.85.1** documentation
and native-read source. Inspection is not runtime compatibility verification.
No exact Pi/Node version pair has been recorded as completing the release smoke
checks. Skill-lifecycle, digestion, and statistics checks were owner-reported as
passed, not independently verified. Installation, migration, removal, and rollback
qualification remain pending. Git installation is a release gate until a real
owner-created remote/ref exists. The wildcard Pi peer dependency is not a compatibility guarantee.

There are no automated regression tests in this scope. Only one built-in `read`
is assumed; replacement readers and arbitrary shell/MCP/custom-tool reads are
outside the supported lifecycle. New Pi read semantics must be checked before
claiming compatibility. Uncertain coverage can intentionally save less context.

### Manual qualification checklist

Use a disposable working directory outside your project and a separate Pi config
directory. For example, in a separate shell:

```bash
export PI_CODING_AGENT_DIR="$(mktemp -d)"
workdir="$(mktemp -d)"
cd "$workdir"
pi --version
node --version
pi install /absolute/path/to/pi-context-lean
pi list
pi config
pi
```

This isolates Pi configuration, **not system access**. Configure provider access
for this disposable instance through your normal authentication method. Do not
copy credentials into this repository. Keep the same config environment and
working directory for the management checks; closing this shell leaves your
normal config selection unchanged.

Record exact Pi and Node versions and observed results when performing each check:

- Changed-content whole-file reload, contiguous pagination, uncertain limit-read
  preservation, wrapper arguments, explicit unload/reload, and rejected markers.
- An older still-active skill surviving historical digestion; a retired multipart
  load shrinking without orphan results; mixed groups retaining unrelated output.
- `/context-lean` counts compared with actual outgoing payloads, including logical
  loads versus chunks. Inspect outgoing context, not just the command's counters,
  and compare it with the unchanged saved transcript.
- Local installation; a disposable loose-copy migration and rollback rehearsal;
  one loaded instance; command availability after a model request; disabling and
  removal followed by fresh-session inspection. Do not use the live loose copy
  for the rehearsal. Confirm the package introduces no `/tmp/out.txt` writes.
- Source and history review for private material before publication, and Git
  installation from the real release ref once one exists.

Unchecked behavior is not qualified by this README. Do not treat package loading
or a successful statistics notification as proof of lifecycle correctness.

## License

MIT. See [LICENSE](LICENSE).
