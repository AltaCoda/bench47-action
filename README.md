# Bench47 Action

Ask a [Bench47](https://bench47.com) gate, post a sign-off, or start a Bench47
hook from a GitHub workflow, with one `uses:` line.

The Action downloads the `bnch` release it is pinned to, checks its signature
against a key built into the Action, keeps it in the runner's tool cache and
runs `bnch ci`. `bnch` writes the step outputs, the job summary and an error
annotation when the step fails. The step's result is `bnch`'s exit code:

| Exit | Gate | Start with `wait` |
| --- | --- | --- |
| 0 | open | ended well |
| 1 | not open | failed, was declined, or the time ran out |
| 2 | could not be evaluated | could not be started |

## Examples

A trusted workflow asks a gate. It needs no secret: the job proves which
repository, branch and workflow it is with GitHub's token, and a trusted
workflow rule in Bench47 says what it may do.

```yaml
permissions:
  id-token: write
  contents: read

steps:
  - uses: AltaCoda/bench47-action@v1
    with:
      org: acme
      gate: release-ready
      inputs: |
        sha=${{ github.sha }}
        release=${{ github.ref_name }}
```

Start a hook and wait up to 20 minutes for how it ends:

```yaml
  - uses: AltaCoda/bench47-action@v1
    with:
      org: acme
      start: release-notes
      inputs: |
        tag=${{ github.ref_name }}
      wait: 20m
```

Post a sign-off:

```yaml
  - uses: AltaCoda/bench47-action@v1
    with:
      org: acme
      signoff: qa
      subject: release:${{ github.ref_name }}
      link: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
```

With an API key instead of a trusted workflow, for example in a repository
Bench47 does not trust yet:

```yaml
  - uses: AltaCoda/bench47-action@v1
    with:
      gate: release-ready
      api-key: ${{ secrets.BENCH47_API_KEY }}
      inputs: |
        sha=${{ github.sha }}
```

When both an API key and GitHub's token are available, the API key is used.

## Inputs

Set exactly one of `gate`, `signoff` and `start`.

| Input | What it is |
| --- | --- |
| `org` | The Bench47 organization. Needed when the job has no API key. |
| `gate` | The gate to ask. The step passes when it is open. |
| `signoff` | The sign-off to post. |
| `start` | The hook to start. |
| `inputs` | The gate's or hook's inputs, one `key=value` per line. A gate takes every input it declares and no other, so pass the commit as `sha=${{ github.sha }}`. |
| `subject` | For a sign-off: what it is about, such as `release:v1.2.3`. Required for a sign-off. |
| `state` | For a sign-off: `given` or `refused`. Default `given`. |
| `summary` | For a sign-off: a short sentence about it. |
| `link` | For a sign-off: a link to what it is based on, such as this run. |
| `wait` | How long to keep asking until the gate opens or the started hook ends, such as `10m`. At most `30m`. Waiting uses CI minutes, so the default is no wait. |
| `dedupe-key` | For `start`: a key that makes a retried step answer `deduped` instead of starting the hook again, such as `release-${{ github.ref_name }}`. |
| `api-key` | A Bench47 API key. Leave it out in a trusted workflow. The Action masks it in the log. |
| `server` | Your Bench47 server's URL, for a self-hosted Bench47. Default the hosted Bench47. |
| `version` | The `bnch` version to run. Default the version this release of the Action is pinned to. |

## Outputs

`bnch ci` sets these; each is empty when it does not apply.

| Output | What it is |
| --- | --- |
| `open` | For a gate: `true` or `false`. |
| `failing` | For a gate: the requirements that are not met. |
| `url` | A link to the gate, sign-off or started job in Bench47. |
| `signoff_id` | For a sign-off: its id. |
| `disposition` | For `start`: what became of the start, such as `composed`, `awaiting_approval` or `deduped`. |
| `job_id` | For `start`: the job's id. |
| `run_id` | For `start` of a workflow hook: the run's id. |
| `outcome` | For `start` with `wait`: how it ended. |
| `last_line` | For `start` with `wait`: the job's or run's last line. |

## Pin to a commit

`@v1` moves to each new `v1.x` release. Pinning to a full commit SHA is the
safer form, because a commit cannot be moved:

```yaml
  - uses: AltaCoda/bench47-action@<full commit sha> # v1.0.0
```

Dependabot and Renovate can keep a pinned SHA up to date.

## Self-hosted Bench47

Set `server` to your Bench47's URL:

```yaml
  - uses: AltaCoda/bench47-action@v1
    with:
      server: https://bench47.example.com
      org: acme
      gate: release-ready
      inputs: |
        sha=${{ github.sha }}
```

The Action then downloads `bnch` from your server
(`<server>/dispatch/bnch/releases/…`), and runs the version your server
carries, so the client always matches the server. Set `version` to run another
one your server carries. The signature check is the same.

## Runners

`bnch` is built for Linux and macOS, on x64 and arm64. On a Windows runner
the step fails with "bnch has no Windows build; run this step on a Linux or
macOS runner." Run the Bench47 step in a Linux or macOS job.

## How bnch is checked

Every `bnch` release archive is signed with minisign, and the signature's
trusted comment names the product, version and file
(`bnch 0.19.0 bnch_linux_amd64.tar.gz`). The Action carries the release public
key (key id `120603FBC15897DB`) in its own code and checks, before anything is
unpacked or run:

1. the archive's signature under that key,
2. the signature over the trusted comment, and
3. that the trusted comment names exactly the version and file it asked for,
   so a genuine archive of another version cannot stand in for this one.

A failed check fails the step and nothing is run. The checked `bnch` is kept
in the runner's tool cache and reused by later steps on the same runner. The
check uses only Node's built-in Ed25519 and BLAKE2b; the Action has no
third-party cryptography.

## Development

```sh
npm ci
npm run typecheck
npm test
npm run build   # writes dist/index.js, which must be committed
```

`.github/workflows/test.yml` runs the unit tests, checks that `dist/` matches
the source, and runs the built Action on Linux and macOS against a recorded
server (`e2e/`) with a fake `bnch` signed by a test key generated for the run.

### Releasing

Releases need no manual tagging.

- **A new bnch.** The Bump bnch workflow (`.github/workflows/bnch-bump.yml`)
  checks `https://get.bench47.com/bnch/releases/latest.json` every six hours
  (or on demand, or on a `bnch-released` repository dispatch). When a newer
  bnch is out, it raises `BNCH_VERSION` in `src/release.ts`, bumps the patch
  version in `package.json`, rebuilds `dist/`, opens a pull request and runs
  the tests on it. A new bnch major is not bumped: the workflow fails and a
  person makes that change.
- **Any other change.** Raise `version` in `package.json` in the same pull
  request (`npm version <patch|minor> --no-git-tag-version`) and commit the
  rebuilt `dist/`.
- **On merge.** When the tests pass on `main`, the Release workflow
  (`.github/workflows/release.yml`) tags `vX.Y.Z` from `package.json`, publishes
  a GitHub release and moves `v1` to it. A merge that leaves the version
  unchanged releases nothing.

## Licence

MIT. See [LICENSE](LICENSE). To report a security problem, see
[SECURITY.md](SECURITY.md).
