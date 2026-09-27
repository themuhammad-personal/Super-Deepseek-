import { createFileRoute } from "@tanstack/react-router";
import { bearerFromRequest, dsCreateSession } from "@/lib/deepseek/server";

export const Route = createFileRoute("/api/ds/session")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = bearerFromRequest(request);
        if (!token) return Response.json({ error: "Not signed in." }, { status: 401 });
        try {
          const id = await dsCreateSession(token);
          return Response.json({ id });
        } catch (e) {
          return Response.json(
            { error: e instanceof Error ? e.message : "Could not create session." },
            { status: 502 },
          );
        }
      },
    },
  },
});
