export function LogoMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="var(--color-elevated)" />
      <circle cx="32" cy="32" r="18" fill="none" stroke="var(--color-accent)" strokeWidth="1.6" opacity="0.45" />
      <circle cx="32" cy="32" r="10" fill="var(--color-accent)" opacity="0.22" />
      <circle cx="32" cy="32" r="4.5" fill="var(--color-accent)" />
      <circle cx="22" cy="20" r="2" fill="var(--color-accent)" opacity="0.8" />
      <circle cx="44" cy="42" r="1.6" fill="var(--color-fg)" opacity="0.55" />
      <path
        d="M18 34c6 8 22 8 28 0"
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.7"
      />
    </svg>
  );
}
