# Og Skill

Brand-asset helper for canvas apps. This skill is used to generate custom share cards.

## Brand-asset pass:

To check the brand assets, run:

```
node scripts/brand-check.mjs --game
node scripts/brand-check.mjs --placeholder-ok --root /workspace
```

The brand task runs as a subagent. No wait_tasks, never get_task_output on it — consuming a task's output suppresses its completion notification.

The pending marker is at /workspace/.grok/og-pending and goes stale after 10 minutes.

Hand over the generated files atomically:

```
node scripts/write-atomic.mjs /workspace/.grok/og.jpg.tmp public/og.jpg
node scripts/write-atomic.mjs /workspace/.grok/x-banner.jpg.tmp public/x-banner.jpg
node scripts/write-atomic.mjs /workspace/.grok/site.json.tmp src/lib/og/site.json
```

Self-check the card before reporting:

```
node scripts/brand-check.mjs --game --root /workspace
```
