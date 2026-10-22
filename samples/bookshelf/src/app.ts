import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { HttpError, readJson, sendError, sendJson } from "./http.ts";
import type { BookStore } from "./store.ts";
import { parseBookUpdate, parseNewBook } from "./validation.ts";

type Handler = (
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  id?: string,
) => Promise<void>;

function routes(store: BookStore): Record<string, Handler> {
  return {
    "GET /books": async (_request, response) => {
      sendJson(response, 200, { books: store.list() });
    },

    "GET /books/:id": async (_request, response, _url, id = "") => {
      const book = store.get(id);
      if (book === undefined) throw new HttpError(404, "not_found", "No such book");
      sendJson(response, 200, { book });
    },

    "POST /books": async (request, response) => {
      const book = store.add(parseNewBook(await readJson(request)));
      sendJson(response, 201, { book });
    },

    "PATCH /books/:id": async (request, response, _url, id = "") => {
      const book = store.update(id, parseBookUpdate(await readJson(request)));
      if (book === undefined) throw new HttpError(404, "not_found", "No such book");
      sendJson(response, 200, { book });
    },

    "DELETE /books/:id": async (_request, response, _url, id = "") => {
      if (!store.remove(id)) throw new HttpError(404, "not_found", "No such book");
      response.writeHead(204).end();
    },
  };
}

/** Splits `/books/abc` into the route key `GET /books/:id` and the id. */
function match(method: string, pathname: string): { key: string; id?: string } {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 2 && parts[0] === "books")
    return { key: `${method} /books/:id`, id: parts[1] };
  return { key: `${method} /${parts.join("/")}` };
}

export function createApp(store: BookStore): Server {
  const table = routes(store);
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const { key, id } = match(request.method ?? "GET", url.pathname);
      const handler = table[key];
      if (handler === undefined) throw new HttpError(404, "not_found", "No such route");
      await handler(request, response, url, id);
    } catch (error) {
      sendError(response, error);
    }
  });
}
