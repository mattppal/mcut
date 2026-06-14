import { cn } from "@/lib/utils";

export function BrandMark({
  className,
  wordmark = false,
}: {
  className?: string;
  wordmark?: boolean;
}) {
  return (
    <span
      aria-label="mcut"
      className={cn(
        "inline-flex select-none items-center text-3xl font-bold leading-none italic",
        className,
      )}
      style={{
        fontFamily: "var(--font-logo), 'Instrument Serif', Georgia, serif",
      }}
    >
      {wordmark ? "mcut" : "m"}
    </span>
  );
}
