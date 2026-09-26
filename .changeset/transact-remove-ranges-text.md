---
"@mcut/mcp-server": patch
---

The `transact` description and its error for a rejected tool now list `remove_ranges` with timeline ranges among the calls it accepts. The `remove_ranges`, `apply_captions`, and `find_retakes` descriptions say to call `apply_captions` on its own after `remove_ranges`, never inside `transact`, and that one `find_retakes` call after the cut is enough.
