import { createApp } from "./app.ts";
import { BookStore, seed } from "./store.ts";

const port = Number(process.env.PORT ?? 3000);
const store = new BookStore();
seed(store);

createApp(store).listen(port, () => {
  console.log(`bookshelf listening on http://localhost:${port}`);
});
