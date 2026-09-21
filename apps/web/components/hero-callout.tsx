import { cn } from '@/lib/utils'

const CALLOUT = 'This is a real video editor, click it!'

export function HeroCallout({ hidden, className }: { hidden: boolean; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'hidden items-start gap-2 pt-1 pl-6 text-muted-foreground transition-opacity duration-300 select-none motion-reduce:transition-none sm:flex',
        hidden && 'opacity-0',
        className,
      )}
    >
      <span className="mt-4 -rotate-2 text-[1.4rem] leading-none" style={{ fontFamily: "var(--font-hand), 'Caveat', cursive" }}>
        {CALLOUT}
      </span>
      <svg
        viewBox="0 0 72 56"
        className="-mt-1 h-14 w-auto shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 50c9-1 17-6 23-13 5-6 8-13 15-19 5-4 10-8 16-11" />
        <path d="M46 9c4-2 8-2 12-3-1 4-2 8-3 12" />
      </svg>
    </div>
  )
}
