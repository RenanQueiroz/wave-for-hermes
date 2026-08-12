# Security policy

Wave handles gateway session credentials, private conversations, microphone audio, and an optional
user-supplied OpenAI API key. Please report suspected vulnerabilities privately so they can be
investigated before public disclosure.

## Supported versions

Wave is pre-release and does not yet publish store binaries or versioned security releases. Only
the current `main` branch receives fixes during this phase.

## Reporting a vulnerability

Use **Report a vulnerability** on this repository's GitHub **Security** tab to open a private
security advisory. If private vulnerability reporting is not available, contact the maintainer
privately through the contact method on their GitHub profile. Do not include sensitive details,
credentials, conversation content, or an unpatched exploit in a public issue.

Include, when possible:

- the affected commit, build variant, platform, and OS version;
- a concise description of the impact and required attacker access;
- minimal reproduction steps or a proof of concept with secrets and personal data removed;
- whether the issue has been disclosed anywhere else.

If a real credential may have been exposed, revoke or rotate it before sending the report. Never
send live API keys, gateway passwords, session tokens, signing credentials, or private conversation
data.

The maintainer will acknowledge reports as soon as practical, validate their scope, and coordinate
a fix and disclosure plan. Please allow time for a release or mitigation before publishing details.

## Scope

Reports about the Wave mobile client, the runtime-neutral contracts, or the repository's own test
tooling are in scope. Vulnerabilities in Hermes itself, Expo, React Native, PanelUI, OpenAI, or
another dependency should also be reported to that upstream project; please still notify Wave
privately when its use of the dependency creates a concrete impact here.

Wave's trust boundaries, credential handling, abuse cases, implemented controls, and accepted
residual risks are documented in the [`security model`](./docs/security.md). The current dependency
and supply-chain review is in [`docs/dependency-security.md`](./docs/dependency-security.md).
