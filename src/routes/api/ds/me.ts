import { createFileRoute } from "@tanstack/react-router";
import { bearerFromRequest, dsCurrentUser } from "@/lib/deepseek/server";

export const Route = createFileRoute("/api/ds/me")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = bearerFromRequest(request);
        if (!token) return Response.json({ error: "Not signed in." }, { status: 401 });
        try {
          const me = await dsCurrentUser(token);
          return Response.json(me);
        } catch (e) {
          return Response.json(
            { error: e instanceof Error ? e.message : "Session expired." },
            { status: 401 },
          );
        }
      },
    },
  },
});
