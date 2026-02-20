# Hatena Bookmark RSS API (as used by hatebucli)

`hatebucli` fetches daily bookmarks from Hatena RSS using `rss-parser`.

## Endpoint

Default base URL:

`https://b.hatena.ne.jp/{user}/bookmark.rss`

Request URL format:

`GET {base_url}?date=YYYYMMDD`

Example:

`GET https://b.hatena.ne.jp/example/bookmark.rss?date=20260219`

## Base URL Override

The base URL can be overridden with environment variable:

- `HATENA_BOOKMARK_RSS_URL`

The value must include `%s` as a username placeholder.

Example:

`HATENA_BOOKMARK_RSS_URL=https://b.hatena.ne.jp/%s/bookmark.rss`

## Query Parameter

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `date` | string | Target date in `YYYYMMDD` |

## Parsed Output Schema

Each RSS item is mapped into:

```json
{
  "title": "string",
  "link": "string",
  "date": "string",
  "description": "string"
}
```

Field mapping in implementation:

- `title`: `item.title || ''`
- `link`: `item.link || ''`
- `date`: `item.isoDate || item.dcDate || ''`
- `description`: `item.contentSnippet || item.description || ''`

## Error Handling

- On fetch/parse failure, the CLI logs an error and returns an empty array.
- Public bookmark RSS does not require authentication in this implementation.
