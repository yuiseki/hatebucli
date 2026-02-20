# ADR 001: Credential Management and Configuration

## Status
Proposed

## Context
The previous implementations (`hatebu-ai` and `hmggg`) had inconsistent ways of handling user-specific configurations and credentials. To make `hatebucli` and `gyazocli` portable, secure, and user-agnostic, we need a unified approach using environment variables.

## Decision
We will use Environment Variables as the primary mechanism for credentials and configuration.

### 1. Unified `.env` Support
Both tools will support loading a `.env` file from the current working directory or the user's home directory.

### 2. Hatebucli Specifics
- `HATENA_USER`: (Required) The Hatena ID of the target user.
- `HATENA_BOOKMARK_RSS_URL`: (Optional) Override for the base RSS URL.

### 3. Gyazocli Specifics
Gyazocli supports both Personal Access Tokens and OAuth2 Application credentials.
- `GYAZO_ACCESS_TOKEN`: (Required for personal use) The OAuth2 personal access token.
- `GYAZO_CLIENT_ID`: (Optional/Required for OAuth2 flow) The OAuth2 Client ID (API ID).
- `GYAZO_CLIENT_SECRET`: (Optional/Required for OAuth2 flow) The OAuth2 Client Secret (API Secret).
- `GYAZO_CACHE_DIR`: (Optional) Custom path for JSON/Markdown caches.

### 4. Implementation Guidelines
- Use the `dotenv` package to load variables.
- Prioritize actual environment variables over `.env` file values.
- Never commit `.env` files (enforced via `.gitignore`).
- Provide a `.env.example` file in the repository root.

## Consequences
- **Security:** Sensitive tokens and secrets are kept out of the codebase.
- **Flexibility:** Supports both simple personal token usage and full OAuth2 application integration.
- **Portability:** Users can easily switch targets or applications by changing environment variables.
