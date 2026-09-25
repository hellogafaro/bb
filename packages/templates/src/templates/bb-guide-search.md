# Search

`bb search <query>` finds threads, projects, settings controls, machines, and core actions on the connected server. Active and archived threads are included. Search is read only; action results name operations and do not execute them.

Use `--project <id>` to rank that project's threads higher, `--limit-per-group <1-50>` to set each group size, and `--cursor <cursor>` to continue one group. The cursor is bound to the query and project context. `--json` prints `{query, groups}` with typed result data and each group's `nextCursor`.

Queries are limited to 256 Unicode code points. A one-character query returns names and catalog matches; message text requires two non-whitespace characters. Search covers this server and does not search connected services or machine files.

Thread title typo matching uses a bounded title candidate set and may miss first-letter typos or older titles in very large result sets.
