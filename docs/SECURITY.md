# SECURITY.md - Security Policy & Guidelines

## Overview
Security and privacy are fundamental principles of **JB³ GameHub**. GameHub handles server RCON credentials, user identity profiles, and local network connections.

## Reporting a Vulnerability
If you discover a security vulnerability within JB³ GameHub, please disclose it responsibly by contacting the maintainers directly at:
`security@jb3gamehub.net` or via private security advisory on GitHub.

Please do NOT create public GitHub issues for security vulnerabilities.

## Security Architecture
1. **RCON Security**: RCON passwords and authorization keys are stored encrypted at rest and never exposed to the client browser.
2. **AI Guardrails**: Natural language commands dispatched to JB AI Copilot are sanitized and checked against strict execution bounds (e.g. prohibiting arbitrary file system deletion or shell execution outside RCON scope).
3. **Isolated Port Bindings**: Internal server communications occur on bound internal network interfaces unless explicitly configured by the user.
