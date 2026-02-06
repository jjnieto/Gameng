import { createApp } from "./app.js";

const app = createApp();

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

// E2E graceful shutdown endpoint — only when GAMENG_E2E=1
if (process.env.GAMENG_E2E === "1") {
  app.post("/__shutdown", (_req, reply) => {
    reply.send({ ok: true });
    setImmediate(() => {
      app.close().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
  });
}

app.listen({ port, host }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});

// Graceful shutdown on SIGTERM (Linux/macOS containers)
process.on("SIGTERM", () => {
  app.close().then(
    () => process.exit(0),
    () => process.exit(1),
  );
});
