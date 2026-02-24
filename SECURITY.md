# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |
| < 0.1   | No        |

## Reporting a Vulnerability

**Please do NOT open public issues for security vulnerabilities.**

To report a vulnerability, use one of the following channels:

- **GitHub Security Advisories** (preferred): Use the "Report a vulnerability" button on the Security tab of this repository.
- **Email**: [security@annex.io](mailto:security@annex.io)

Include as much detail as possible: steps to reproduce, affected versions, and potential impact.

## Response Timeline

- **48 hours**: Initial acknowledgment of your report.
- **1 week**: Assessment and severity classification.
- **2 weeks**: Fix deployed for confirmed vulnerabilities.

Timelines may vary for issues of exceptional complexity, but we will keep you informed throughout the process.

## Security Layers

Scion implements multiple layers of defense:

- **Secret protection** — masks API keys and tokens in input before the LLM sees them, and sanitizes any leaked secrets from output before persistence.
- **SSRF protection** — validates all outbound URLs (web-fetch tool, MCP connections) against blocked ranges, preventing access to cloud metadata and internal services.
- **Gateway inbound security** — IP-based allow/deny lists with CIDR matching on all incoming HTTP requests.
- **Input pipeline with prompt injection detection** — screens incoming messages for injection attempts before they reach the model.
- **PII detection and redaction** — automatically identifies and strips personally identifiable information from inputs and outputs.
- **Adversarial pattern detection** — identifies known adversarial techniques and obfuscation strategies.
- **Container hardening** — non-root user, dropped capabilities, read-only filesystem, resource limits, and no-new-privileges.
- **Rate limiting per session/user** — prevents abuse through configurable request throttling.
- **Channel allowlists** — restricts which channels and sources can interact with the system.

For a full security assessment and architecture details, see [docs/SECURITY_ASSESSMENT.md](docs/SECURITY_ASSESSMENT.md).

## Credit

Security researchers who responsibly disclose vulnerabilities will be credited in the relevant release notes. If you prefer to remain anonymous, let us know when submitting your report.
