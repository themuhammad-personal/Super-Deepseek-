import type { ReactNode } from "react";
import { Drawer } from "vaul";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  children: ReactNode;
  title?: string;
  nested?: boolean;
};

export function BottomSheet({ open, onOpenChange, children, title }: Props) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} shouldScaleBackground={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Drawer.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[88dvh] w-full max-w-lg flex-col",
            "rounded-t-[var(--radius-xl)] bg-surface text-fg shadow-[var(--shadow-pop)]",
            "pb-[max(12px,env(safe-area-inset-bottom))]",
          )}
        >
          <div className="sheet-handle" />
          {title ? (
            <Drawer.Title className="px-5 pb-2 pt-1 text-base font-semibold tracking-tight">
              {title}
            </Drawer.Title>
          ) : (
            <Drawer.Title className="sr-only">Sheet</Drawer.Title>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-2">
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
