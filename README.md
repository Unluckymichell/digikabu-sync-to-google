# DigiKabu to Google Calendar Sync

A small Node.js/TypeScript service that logs into DigiKabu, pulls timetables and school events, and keeps them in sync with Google Calendar. It creates per-user calendars, shares them to configured Google accounts, and runs scheduled incremental/full syncs.

## Features

- Syncs DigiKabu timetable entries into Google Calendar.
- Syncs DigiKabu events (termine/holidays/tests) into Google Calendar.
- Creates calendars per DigiKabu user and shares them with configured Google accounts.
- Scheduled syncs:
  - Full sync on startup.
  - Quick sync every 2 hours between 06:00–18:00 (Mon–Fri).
  - Full sync nightly at 01:00 (Mon–Fri).

## Requirements

- Node.js 20+ for local runs.
- Google Calendar API enabled.
- Google service account JSON key file with calendar access.
- DigiKabu credentials for each account to sync.

## Configuration

This app is configured via environment variables.

- `GOOGLE_SECRET_FILE`: Absolute or relative path to the Google service account JSON file.
- `GOOGLE_SECRET_JSON`: The full JSON contents of the Google service account key (takes precedence over `GOOGLE_SECRET_FILE`).
- `DIGI_GOOLE_SYNCS`: JSON object mapping `"user:password"` to an array of Google emails to share calendars with.

Example:

```
GOOGLE_SECRET_FILE=./path/to/google-service-account.json
DIGI_GOOLE_SYNCS={"user1:pass1":["user1@gmail.com"],"user2:pass2":["user2@gmail.com","other@gmail.com"]}

# or, without mounting a file
GOOGLE_SECRET_JSON={"type":"service_account","project_id":"...", ...}
DIGI_GOOLE_SYNCS={"user1:pass1":["user1@gmail.com"]}
```

## Local run

1. Install dependencies.
2. Build.
3. Run.

```
npm install
npm run build
npm start
```

## Docker

Build the image:

```
docker build -t digikabu-sync .
```

Run the container (mount the service account key and pass env vars):

```
docker run --rm \
  -e GOOGLE_SECRET_FILE=/secrets/google.json \
  -e DIGI_GOOLE_SYNCS='{"user:pass":["user@gmail.com"]}' \
  -v /absolute/path/to/google.json:/secrets/google.json:ro \
  ghcr.io/unluckymichell/digikabu-sync-to-google:latest
```

Or pass the JSON directly (no file mount required):

```
docker run --rm \
  -e GOOGLE_SECRET_JSON='{"type":"service_account","project_id":"...", ...}' \
  -e DIGI_GOOLE_SYNCS='{"user:pass":["user@gmail.com"]}' \
  ghcr.io/unluckymichell/digikabu-sync-to-google:latest
```

## Security notes

- Do **not** commit `.env` files or Google service account keys to a public repository.
- Rotate any credentials that were previously committed.

## License

MIT
