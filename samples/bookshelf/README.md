# Bookshelf

A small JSON API for a shared reading list. No dependencies: it runs on Node's
built-in HTTP server and type stripping, and tests use `node:test`.

```sh
npm start        # http://localhost:3000
npm test
```

## API

| Method   | Path         | Description                     |
| -------- | ------------ | ------------------------------- |
| `GET`    | `/books`     | List books, newest first        |
| `GET`    | `/books/:id` | Fetch one book                  |
| `POST`   | `/books`     | Add a book                      |
| `PATCH`  | `/books/:id` | Update a book's status or notes |
| `DELETE` | `/books/:id` | Remove a book                   |

Errors are always `{ "error": { "code": string, "message": string } }` with a
matching HTTP status.

## Code layout

- `src/main.ts` starts the server.
- `src/app.ts` maps routes to handlers. Handlers stay thin: they parse the
  request, call the store, and shape the response.
- `src/store.ts` owns the data. Nothing else touches the `Map`.
- `src/validation.ts` turns untrusted input into typed values or throws
  `HttpError`. All input validation lives here.
- `src/http.ts` has the HTTP plumbing: JSON bodies, responses, `HttpError`.
