---
"@mcut/media": patch
---

A reversed clip whose source is longer than the one-buffer mix can hold now exports reversed audio in bounded chunks, instead of a finished file with that clip silent. A reversed clip that is also time-stretched past the same limit fails the export, and the error names the clip.
