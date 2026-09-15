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

Requires [Pi](https://pi.dev) installed separately. This is a Pi extension,
not a standalone CLI; use `pi install`, not `npm install -g`, to register it.

### From npm

Install the published package from [npm](https://www.npmjs.com/package/pi-context-lean):

```bash
pi install npm:pi-context-lean
```

For a project-only installation:

```bash
pi install -l npm:pi-context-lean
```

Or try it for one session without registering it:

```bash
pi -e npm:pi-context-lean
```

To pin version `0.1.0`:

```bash
pi install npm:pi-context-lean@0.1.0
```

Pinned versions are skipped by package updates. To change a pin, install the
chosen version explicitly.

### From Git or a local checkout

For development or installation directly from source:

```bash
pi install git:github.com/brunoCCOS/pi-context-lean
# Or use a local development checkout:
pi install /absolute/path/to/pi-context-lean
```

Installations are user-wide by default. Add `-l` to `pi install` for project
scope.

Start a fresh Pi session after installing. Context Lean runs automatically
before each model request; no additional configuration is required.

> Pi extensions run with full system access. Review the source before installing,
> and load only one copy of Context Lean. Remove any previous loose
> `context-lean.ts` installation first.

### Migrating an existing installation to npm

Run `pi list` to identify the existing source. Remove its registration before
installing from npm so Pi does not load both copies:

```bash
pi remove git:github.com/brunoCCOS/pi-context-lean
pi install npm:pi-context-lean
```

If the old source is a pinned Git ref or local path, use that exact source in
`pi remove`. Use `-l` on both commands for a project-only installation.
For a loose `context-lean.ts`, back it up outside Pi's extension discovery
folders and remove or disable its old registration first. Keep the backup
until the npm installation works. Start a fresh session and check that only
one copy is enabled with `pi config`.

Check both the user and project sections of `pi list`: a local registration
in either scope can leave a second copy enabled. If `pi remove` does not remove
the old registration, edit the `packages` array in `~/.pi/agent/settings.json`
(user scope) or `<project>/.pi/settings.json` (project scope). Remove only the
matching source string, or the object whose `source` matches it. Relative local
sources may appear as `..` or another relative path. Keep the JSON valid and
leave unrelated entries unchanged. Removing a local registration does not
delete your source checkout.

To roll back, remove the npm registration, reinstall the previous source or
restore the loose extension, and start a fresh session. Never enable both.

## Updates

```bash
pi list
pi update npm:pi-context-lean
```

Start a fresh Pi session afterward. For a pinned installation, explicitly
install the desired version instead. Local checkouts use your working files;
update those yourself rather than editing a Pi-managed npm or Git installation.

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

## Verification

The installed npm release **0.1.0** passed **56 isolated runtime smoke checks**
with Pi **0.85.1** and Node.js **24.16.0**, using Pi's actual extension loader,
native file reader, and temporary session storage. Checks covered:

- Extension hooks and `/context-lean` command registration.
- Changed-file skill reloads, unload/reload, and invalid or ambiguous markers.
- Pagination, gaps, limited reads, oversized lines, and uncertain paths.
- Skill-wrapper argument and image preservation.
- Historical digestion, repeated-output references, and tool-call/result pairing.
- Preservation of active skills, errors, images, and unfinished exchanges.
- Latest-pass statistics, session reset, and unchanged saved transcripts.

These were ad-hoc checks, not a committed automated test suite. No defects were
reproduced in those cases; this is not exhaustive verification or a live
provider/TUI end-to-end test. No model calls were made. Compatibility with
other Pi or Node.js versions has not been established by these checks.

## Limitations

- Targets Pi **0.85.1**; see [Verification](#verification) for the checked baseline.
- Tracks native `/skill:name` expansions and built-in `read` calls, not shell
  reads, MCP tools, or replacement readers.
- Incomplete reads, uncertain paths, and missing metadata can reduce cleanup.
- Works from the context available on each pass. It cannot recover history
  removed by compaction or guarantee a consistent file snapshot across
  paginated reads.
- Unload-marker checks are not a prompt-injection security boundary.

## Uninstall

```bash
pi remove npm:pi-context-lean
```

Add `-l` for a project-only installation. If you installed a pinned npm
version, from Git, or from a local path, use the exact source shown by
`pi list` instead. Start a fresh Pi session afterward.

## Publishing (maintainers)

Publication is manual. `pi-context-lean@0.1.0` is published on the public npm
registry. For a new release, first edit `version` in `package.json` to a new
semantic version; published name/version pairs cannot be reused.

Run these commands from the repository root in a regular interactive terminal,
not through Pi's shell runner, so npm can complete browser/2FA approval:

1. Review the release source, README, and MIT license for public distribution.
   No build step is needed: Pi loads the shipped TypeScript extension directly.
2. Preview the package without creating a tarball or publishing:

   ```bash
   npm pack --dry-run --ignore-scripts
   ```

   Expect exactly `package.json`, `extensions/context-lean.ts`, `README.md`,
   and `LICENSE`. The `files` allowlist keeps `.local/`, `.pi/`, and other
   development files out of the npm package.
3. Authenticate as an npm account allowed to publish this package name:

   ```bash
   npm login --registry=https://registry.npmjs.org/
   npm whoami --registry=https://registry.npmjs.org/
   ```

4. When ready to make the release public, publish and complete npm's requested
   authentication or two-factor challenge:

   ```bash
   npm publish --access public --registry=https://registry.npmjs.org/
   ```

   Login alone does not approve publication. Follow the new authentication URL
   npm displays, complete the browser challenge, and leave the terminal running
   until publication finishes. If a browser does not open automatically (for
   example, under WSL), open the URL manually. An `EOTP` error in a non-interactive
   shell can mean npm could not start this approval flow; retry in an interactive
   terminal. Do not share approval URLs, OTPs, or tokens.

   `publishConfig` also sets the public registry and access. Resolve any registry
   permissions or authentication rejection before announcing the new release.
5. Confirm the registry version, then check installation in a separate Pi
   configuration with no other copy of this extension enabled:

   ```bash
   npm view pi-context-lean version --registry=https://registry.npmjs.org/
   pi install npm:pi-context-lean
   ```

   Start a fresh session, make a model request, and inspect `/context-lean`.
   A package preview alone does not verify runtime behavior.

npm name/version pairs cannot be reused, even after unpublishing. Repository
README changes do not update the README bundled in an already-published npm
version; include documentation updates in the next release. No Git commits,
tags, or pushes are performed by these instructions.

## License

[MIT](LICENSE) © 2026 Bruno Llacer Trotti
