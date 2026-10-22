import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { book, startServer } from "./helpers.ts";

describe("GET /books", () => {
  it("lists books newest first", async () => {
    const api = await startServer([book("First"), book("Second"), book("Third")]);
    const { status, json } = await api.request("GET", "/books");
    assert.equal(status, 200);
    assert.deepEqual(
      json.books.map((entry: { title: string }) => entry.title),
      ["Third", "Second", "First"],
    );
  });

  it("returns an empty list when there are no books", async () => {
    const api = await startServer();
    const { json } = await api.request("GET", "/books");
    assert.deepEqual(json.books, []);
  });
});

describe("GET /books/:id", () => {
  it("returns one book", async () => {
    const api = await startServer([book("Dune")]);
    const [dune] = api.store.list();
    const { status, json } = await api.request("GET", `/books/${dune!.id}`);
    assert.equal(status, 200);
    assert.equal(json.book.title, "Dune");
  });

  it("404s for an unknown id", async () => {
    const api = await startServer();
    const { status, json } = await api.request("GET", "/books/nope");
    assert.equal(status, 404);
    assert.equal(json.error.code, "not_found");
  });
});

describe("POST /books", () => {
  it("adds a book with defaults", async () => {
    const api = await startServer();
    const { status, json } = await api.request("POST", "/books", {
      title: "Emma",
      author: "Jane Austen",
    });
    assert.equal(status, 201);
    assert.equal(json.book.status, "to-read");
    assert.equal(json.book.year, null);
    assert.equal(api.store.list().length, 1);
  });

  it("rejects a missing title", async () => {
    const api = await startServer();
    const { status, json } = await api.request("POST", "/books", { author: "Nobody" });
    assert.equal(status, 400);
    assert.equal(json.error.code, "invalid_field");
  });

  it("rejects an unknown status", async () => {
    const api = await startServer();
    const { status } = await api.request("POST", "/books", {
      title: "X",
      author: "Y",
      status: "lost",
    });
    assert.equal(status, 400);
  });
});

describe("PATCH /books/:id", () => {
  it("updates the status", async () => {
    const api = await startServer([book("Dune")]);
    const [dune] = api.store.list();
    const { status, json } = await api.request("PATCH", `/books/${dune!.id}`, {
      status: "reading",
    });
    assert.equal(status, 200);
    assert.equal(json.book.status, "reading");
  });

  it("rejects an empty update", async () => {
    const api = await startServer([book("Dune")]);
    const [dune] = api.store.list();
    const { status } = await api.request("PATCH", `/books/${dune!.id}`, {});
    assert.equal(status, 400);
  });
});

describe("DELETE /books/:id", () => {
  it("removes the book", async () => {
    const api = await startServer([book("Dune")]);
    const [dune] = api.store.list();
    const { status } = await api.request("DELETE", `/books/${dune!.id}`);
    assert.equal(status, 204);
    assert.equal(api.store.list().length, 0);
  });
});
