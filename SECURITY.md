# Security Policy

## Supported Versions

The latest release tag on the `main` branch
is supported. Older tags are supported on a best-effort basis — please
upgrade and confirm the issue reproduces on `main` before reporting.

## Reporting a Vulnerability

Please report vulnerabilities privately via
[GitHub Security Advisories](https://github.com/danjdewhurst/story-skills/security/advisories/new)
rather than opening a public issue.

Include, where possible:

- A description of the vulnerability and its impact
- Steps to reproduce or a proof of concept
- The commit or version you tested against

You can expect an initial response within 7 days. If the issue is
confirmed, a fix will be released as soon as practical and credited in
the release notes unless you prefer to remain anonymous. Please allow up
to 90 days of coordinated disclosure before publishing details, and let
us know if you are working to a shorter deadline.

## Safe Harbor

Good-faith security research against this repository is welcome: we will
not pursue legal action against researchers who follow this policy, avoid
harming users or disrupting services, and give us a chance to fix
confirmed issues before disclosing them.

## Verifying Releases

npm releases are published with
[npm provenance](https://docs.npmjs.com/generating-provenance-statements),
shown on the package page and checked by `npm audit signatures`.

The standalone binaries and their `story-skills_<version>_checksums.txt`
carry a signed build provenance attestation from releases after 0.21.0.
Check a download with the [GitHub CLI](https://cli.github.com/):

```shell
gh attestation verify story-skills_<version>_<os>_<arch>.tar.gz --repo danjdewhurst/story-skills
```

A passing check means the file was built by this repository's
`publish.yml` workflow. See
[Getting started](docs/getting-started.md) for checksum verification.

## Scope

This policy covers the code and plugin manifests in this repository
(`src/`, `bin/`, `skills/`, `.codex-plugin/`, `.claude-plugin/`).
Example stories under `examples/` are sample content, not a supported
attack surface, but reports are still welcome.
