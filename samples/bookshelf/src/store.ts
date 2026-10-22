import { randomUUID } from "node:crypto";
import type { Book, BookUpdate, NewBook } from "./books.ts";

export class BookStore {
  readonly #books = new Map<string, Book>();
  readonly #now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.#now = now;
  }

  /** Every book, newest first. */
  list(): Book[] {
    return [...this.#books.values()].sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }

  get(id: string): Book | undefined {
    return this.#books.get(id);
  }

  add(input: NewBook): Book {
    const book: Book = { id: randomUUID(), addedAt: this.#now().toISOString(), ...input };
    this.#books.set(book.id, book);
    return book;
  }

  update(id: string, changes: BookUpdate): Book | undefined {
    const existing = this.#books.get(id);
    if (existing === undefined) return undefined;
    const updated = { ...existing, ...changes };
    this.#books.set(id, updated);
    return updated;
  }

  remove(id: string): boolean {
    return this.#books.delete(id);
  }
}

export function seed(store: BookStore): void {
  const books: NewBook[] = [
    {
      title: "The Pragmatic Programmer",
      author: "David Thomas",
      year: 1999,
      status: "finished",
      notes: "",
    },
    {
      title: "Designing Data-Intensive Applications",
      author: "Martin Kleppmann",
      year: 2017,
      status: "reading",
      notes: "",
    },
    {
      title: "A Philosophy of Software Design",
      author: "John Ousterhout",
      year: 2018,
      status: "to-read",
      notes: "",
    },
    {
      title: "Refactoring",
      author: "Martin Fowler",
      year: 2018,
      status: "finished",
      notes: "2nd edition",
    },
    {
      title: "Working Effectively with Legacy Code",
      author: "Michael Feathers",
      year: 2004,
      status: "to-read",
      notes: "",
    },
  ];
  for (const book of books) store.add(book);
}
