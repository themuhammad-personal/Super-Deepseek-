import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 font-medium transition-[transform,opacity,background-color,color] duration-150 ease-out disabled:opacity-40 disabled:pointer-events-none active:not-disabled:scale-[0.96] select-none",
  {
    variants: {
      variant: {
        primary:
          "bg-accent text-accent-fg hover:opacity-92",
        ghost:
          "bg-transparent text-fg hover:bg-elevated",
        subtle:
          "bg-elevated text-fg hover:bg-surface shadow-[var(--shadow-border)]",
        danger: "bg-danger/15 text-danger hover:bg-danger/25",
        icon: "bg-transparent text-muted hover:text-fg hover:bg-elevated",
      },
      size: {
        sm: "h-8 px-3 text-xs rounded-[var(--radius-sm)]",
        md: "h-10 px-4 text-sm rounded-[var(--radius-md)]",
        lg: "h-12 px-5 text-sm rounded-[var(--radius-lg)]",
        icon: "size-11 rounded-[var(--radius-pill)]",
        iconSm: "size-9 rounded-[var(--radius-pill)]",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>
>(function Button({ className, variant, size, ...props }, ref) {
  return (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
});
