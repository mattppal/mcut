---
"@mcut/media": patch
---

A reversed clip whose source is longer than the one-buffer mix can hold now exports reversed audio in bounded chunks, instead of a finished file with that clip silent. Each reversed decode starts 2048 frames early and drops that lead-in, so a chunk boundary or a join between reversed clips is not a click from a cold AAC decoder. A reversed clip that is also time-stretched past the same limit fails the export, and the error names the clip.
