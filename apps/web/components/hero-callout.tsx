import { cn } from '@/lib/utils'

const CALLOUT = 'This is a real video editor, click it!'

export function HeroCallout({ hidden, className }: { hidden: boolean; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'hidden items-start gap-1 pl-3 pt-2 text-muted-foreground transition-opacity duration-300 select-none motion-reduce:transition-none sm:flex',
        hidden && 'opacity-0',
        className,
      )}
    >
      <svg
        viewBox="0 0 48 64"
        className="mt-[-0.25rem] h-14 w-auto shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M40 60c-6-7-8-16-13-24-3-6-5-12-9-19-1-2-3-4-4-7" />
        <path d="M6 18l7-9 8 7" />
      </svg>
      <span className="-rotate-2 text-[1.35rem] leading-tight" style={{ fontFamily: "var(--font-hand), 'Caveat', cursive" }}>
        {CALLOUT}
      </span>
    </div>
  )
}
