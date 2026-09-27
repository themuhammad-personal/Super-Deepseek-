import { LogoMark } from "./logo-mark";

export function Splash() {
  return (
    <div className="fixed inset-0 z-[80] flex flex-col items-center justify-center bg-bg text-fg">
      <LogoMark className="size-20" />
      <p className="mt-8 text-lg font-semibold tracking-tight">Super DeepSeek</p>
      <p className="mt-2 text-sm text-muted">Frontier reasoning, native feel</p>
    </div>
  );
}
