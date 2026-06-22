import { env } from "./config/env";
import { createApp } from "./app";

const app = createApp();

app.listen(env.PORT, () => {
  console.log(`photographic-photos-api listening on ${env.PORT}`);
});
