import type { AddressInfo } from "node:net";
import { after } from "node:test";
import { createApp } from "../src/app.ts";
import { BookStore } from "../src/store.ts";
import type { NewBook } from "../src/books.ts";

export interface TestServer {
  store: BookStore;
  request: (method: string, path: string, body?: unknown) => Promise<{ status: number; json: any }>;
}

/** Starts the app on a random port with a clock that ticks one minute per book. */
export async function startServer(books: NewBook[] = []): Promise<TestServer> {
  let minute = 0;
  const store = new BookStore(() => new Date(Date.UTC(2024, 0, 1, 0, minute++)));
  for (const book of books) store.add(book);

  const server = createApp(store);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;

  return {
    store,
    async request(method, path, body) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      return { status: response.status, json: text === "" ? null : JSON.parse(text) };
    },
  };
}

export function book(title: string, overrides: Partial<NewBook> = {}): NewBook {
  return { title, author: "Ann Author", year: 2020, status: "to-read", notes: "", ...overrides };
}
