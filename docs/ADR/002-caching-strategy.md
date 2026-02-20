# ADR 002: Caching Strategy and Storage Structure

## Status
Proposed

## Context
The previous implementations (`hatebu-ai` and `hmggg`) stored data within the project directory (e.g., `public/data/` or `tmp/gyazo_cache/`). This is problematic for portable CLI tools. We need a standardized location for cache files and a robust structure to handle large datasets.

## Decision
We will use the user's home directory for storage and implement a nested directory structure.

### 1. Storage Location
Caching will adhere to the XDG Base Directory Specification (or equivalent for the OS).
- **Hatebucli:** `~/.cache/hatebucli/`
- **Gyazocli:** `~/.cache/gyazocli/`

### 2. Nested Directory Structure
To avoid performance issues with a single directory containing tens of thousands of files, we will use a nested structure.
- **Hatebucli:** `YYYY/MM/DD.json`
- **Gyazocli:** Using the first 1-2 characters of the `image_id` for nesting.
  - Example: `~/.cache/gyazocli/images/a/1/a1b2c3d4.json`

### 3. Cache Revalidation
Cached data must be refreshable to account for updates (e.g., Gyazo OCR metadata).
- **Stale-While-Revalidate:** The CLI will have a `--refresh` or `--no-cache` flag to force re-fetching.
- **Hatebucli:** Bookmarks for the current day should be re-fetched frequently, while past days can be assumed stable (though bookmarks can be deleted).
- **Gyazocli:** OCR and object recognition are asynchronous processes. Cached results without OCR should be re-validated periodically.

## Consequences
- **Performance:** Scalable to years of activity without file system overhead.
- **Portability:** Data is kept outside the source code, preventing repo bloat.
- **Consistency:** Both tools follow a similar logic for data retrieval.
- **Complexity:** Requires logic to determine if a cache entry is "stale" (e.g., checking if the OCR field is missing).
