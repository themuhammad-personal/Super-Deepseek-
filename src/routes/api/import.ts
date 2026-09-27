import { createFileRoute } from "@tanstack/react-router";

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function parseGithub(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com\/([^/]+)\/([^/#?]+)/i) || url.match(/^([^/\s]+)\/([^/#?\s]+)$/);
  if (!m) return null;
  return { owner: m[1]!, repo: m[2]!.replace(/\.git$/, "") };
}

export const Route = createFileRoute("/api/import")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { type?: string; url?: string; githubToken?: string };
        try {
          body = (await request.json()) as { type?: string; url?: string; githubToken?: string };
        } catch {
          return Response.json({ ok: false, error: "Invalid request" }, { status: 400 });
        }
        const url = (body.url ?? "").trim();
        if (!url.startsWith("http://") && !url.startsWith("https://") && body.type !== "github") {
          return Response.json({ ok: false, error: "Enter a valid URL" }, { status: 400 });
        }

        try {
          if (body.type === "github") {
            const parsed = parseGithub(url);
            if (!parsed) {
              return Response.json({ ok: false, error: "Not a GitHub repository URL" }, { status: 400 });
            }
            const ghHeaders: Record<string, string> = { Accept: "application/vnd.github.raw" };
            if (body.githubToken) ghHeaders.Authorization = `Bearer ${body.githubToken}`;
            const readmeRes = await fetch(
              `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/readme`,
              { headers: ghHeaders },
            );
            const readme = readmeRes.ok ? await readmeRes.text() : "";
            const repoRes = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`, {
              headers: body.githubToken ? { Authorization: `Bearer ${body.githubToken}` } : undefined,
            });
            const repo = repoRes.ok
              ? ((await repoRes.json()) as { description?: string; full_name?: string })
              : {};
            const text = [`# ${repo.full_name ?? `${parsed.owner}/${parsed.repo}`}`, repo.description ?? "", readme]
              .filter(Boolean)
              .join("\n\n")
              .slice(0, 40_000);
            if (!text.trim()) {
              return Response.json({ ok: false, error: "Could not read that repository" }, { status: 404 });
            }
            return Response.json({
              ok: true,
              title: repo.full_name ?? parsed.repo,
              text,
            });
          }

          const res = await fetch(url, {
            headers: { "User-Agent": "SuperDeepSeek/1.0" },
            redirect: "follow",
          });
          if (!res.ok) {
            return Response.json({ ok: false, error: `Fetch failed (${res.status})` }, { status: 502 });
          }
          const html = await res.text();
          const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? url;
          const text = stripHtml(html).slice(0, 40_000);
          return Response.json({ ok: true, title, text });
        } catch {
          return Response.json({ ok: false, error: "Import failed" }, { status: 502 });
        }
      },
    },
  },
});
