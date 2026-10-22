export const STATUSES = ["to-read", "reading", "finished"] as const;

export type Status = (typeof STATUSES)[number];

export interface Book {
  id: string;
  title: string;
  author: string;
  year: number | null;
  status: Status;
  notes: string;
  addedAt: string;
}

export interface NewBook {
  title: string;
  author: string;
  year: number | null;
  status: Status;
  notes: string;
}

export type BookUpdate = Partial<Pick<Book, "status" | "notes">>;
