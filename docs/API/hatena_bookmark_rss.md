# Hatena Bookmark RSS API

Hatena Bookmark provides an RSS feed for each user. This CLI uses the date-specific RSS feed to fetch historical bookmarks.

## Endpoint

`GET https://b.hatena.ne.jp/{user}/bookmark.rss`

### Query Parameters

| Parameter | Type | Description | Example |
| :--- | :--- | :--- | :--- |
| `date` | `string` | Target date in `YYYYMMDD` format. | `20260219` |

## Response Format

The response is in RSS 1.0 (XML) format.

### Important Fields

- `channel`: Feed metadata.
- `item`: Individual bookmark entry.
  - `title`: Page title.
  - `link`: Original URL.
  - `dc:date`: Bookmark date (ISO 8601).
  - `description`: User's comment (if any).

## Usage Notes

- The API is public and does not require authentication for public bookmarks.
- Rate limiting is not officially documented, but a delay of 0.5s between requests is recommended.
