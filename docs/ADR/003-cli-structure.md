# ADR 003: CLI Command Structure and Interface

## Status
Proposed

## Context
The user needs a consistent CLI experience across `hatebucli` and `gyazocli`, similar to the sub-command structure of `gogcli`.

## Decision
Both tools will implement a nested sub-command structure with standard global flags.

### 1. Global Flags
Common flags for all commands:
- `-j, --json`: Output raw data in JSON format (ideal for piped commands).
- `-p, --plain`: Output stable, parseable text (TSV).
- `-v, --verbose`: Enable verbose logging.
- `--no-cache`: Force fetch from the API and update the local cache.

### 2. Hatebucli Command Structure
- **`bookmarks list [--date YYYY-MM-DD] [--limit N]`**: List bookmarks for a specific day or recently.
- **`bookmarks sync [--days N]`**: Fetch and cache bookmarks from the RSS feed for the last N days.
- **`bookmarks summary [--date YYYY-MM-DD]`**: Generate a Markdown summary for the target date (using AI integration).
- **`stats [--month YYYY-MM]`**: Output basic statistics (most bookmarked domains, tags, etc.).

### 3. Gyazocli Command Structure
- **`images list [--date YYYY-MM-DD] [--limit N]`**: List images based on creation date or recent captures.
- **`images get <image_id>`**: Display detailed metadata, including OCR and object recognition results.
- **`images search <query> [--limit N]`**: Perform a full-text or date-based search via the Gyazo API.
- **`images sync [--max-pages N]`**: Fetch recent images and enrich with details (OCR) to populate the local cache.

## Consequences
- **User Experience:** Predictable sub-command patterns across different tools.
- **Automation Ready:** JSON output and standard flags make the tools easy to use in shell scripts or by AI agents.
- **Consistency:** Both tools follow the same logic for handling data and output.
