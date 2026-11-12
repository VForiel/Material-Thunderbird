# Building Material-Thunderbird from source

Instructions for addons.thunderbird.net reviewers, and for anyone who wants to rebuild the
`.xpi` files.

## What is generated

All JavaScript is hand-written and shipped as is: no bundler, no transpiler, no minifier.
The only build step produces two files from plain source files:

| Shipped file | Built from | How |
|---|---|---|
| `extension/material-theme.css` | `chrome/tokens/*.css`, `chrome/components/*.css` | Concatenation in a fixed order (list `$Sources` in `scripts/build.ps1`), wrapped in one `@-moz-document` block that limits the sheet to Thunderbird's own chrome documents. |
| `extension/message-content.css` | `chrome/userContent.css` | Copied with a header comment. |

Everything else in the `.xpi` is copied unchanged from `extension/`.

The store build (`material-thunderbird-atn.xpi`) only differs from the self-hosted build
(`material-thunderbird.xpi`) by one line of `manifest.json`: `update_url` is replaced with
`"strict_max_version"` (value `$AtnMaxVersion` in `scripts/build.ps1`).

## Requirements

- Windows: Windows PowerShell 5.1 (built in) or PowerShell 7.
- Linux or macOS: PowerShell 7 (`pwsh`), see
  https://learn.microsoft.com/powershell/scripting/install/installing-powershell
- No Node.js, npm or other package is needed to build. Node.js 18 or later is only used to
  run the tests (`npm test`), which have no dependencies.

## Build

From the root of the source archive:

```
# Windows
powershell -ExecutionPolicy Bypass -File scripts/build.ps1

# Linux / macOS
pwsh scripts/build.ps1
```

Output, in `dist/`:

- `material-thunderbird-atn.xpi`: the package submitted to addons.thunderbird.net;
- `material-thunderbird.xpi`: the self-hosted package, with `update_url`.

The script also copies the colour tokens and the self-hosted package into `docs/` for the
project website; this does not affect the `.xpi` files.

## Checking the result

The build is deterministic: the generated CSS contains no date or machine-specific data. The
files inside the rebuilt `material-thunderbird-atn.xpi` are identical to those of the submitted
package (the zip container itself may differ by timestamps).

`npm test` also checks that `extension/material-theme.css` matches `chrome/`.
