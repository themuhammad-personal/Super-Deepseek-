import { createFileRoute } from "@tanstack/react-router";
import { dsLogin } from "@/lib/deepseek/server";

export const Route = createFileRoute("/api/ds/login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { email?: string; mobile?: string; password?: string; area_code?: string };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json({ error: "Invalid request" }, { status: 400 });
        }
        if (!body.password || (!body.email && !body.mobile)) {
          return Response.json({ error: "Email or phone and password are required." }, { status: 400 });
        }
        try {
          const session = await dsLogin({
            email: body.email,
            mobile: body.mobile,
            password: body.password,
            area_code: body.area_code,
          });
          return Response.json(session);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Sign in failed.";
          return Response.json({ error: msg }, { status: 401 });
        }
      },
    },
  },
});
