# Chess opening atlas

A curated move-prefix tree, not an engine search or a complete opening book.
Each edge adds one legal half-move. Equal positions reached through different
move histories remain separate. No evaluation or frequency is implied.

`lines.json` contains 24 selected records from Lichess chess-openings, volumes
b, c, and d, revision `c67912be581f0793dbaa776be5ccf111e01f88d9` (retrieved
2026-09-22). Names, ECO codes, and PGN are preserved. The family field is our
navigation grouping; Queen's Gambit includes Slav and Semi-Slav lines.

Source: https://github.com/lichess-org/chess-openings/tree/c67912be581f0793dbaa776be5ccf111e01f88d9
Data license: CC0, as declared in the source README. Attribution retained here
and in the UI. No Lichess imagery or piece assets are copied.

Board snapshots are generated offline by legal move replay. Install
`python-chess==1.999` in an isolated environment, then run:

```
python docs/src/components/ChessAtlas/generate.py
python docs/src/components/ChessAtlas/generate.py --check
```

The browser ships the snapshots, not Python or a chess engine. Dagr computes
node positions and edge routes. Shared GraphViewport provides camera controls.
AtlasCanvas renders the graph on a DPR-sized 2D canvas and culls offscreen nodes and edges. Cached miniature
boards show piece occupancy below 72 CSS pixels per board. Between 72 and 136
pixels, detailed glyphs fade in. Detailed boards are cached at power-of-two
resolutions at least as large as their current device-pixel size, then reused
during camera motion. The cache retains at most 24 boards and replaces smaller
resolutions when zooming in; it is cleared on theme or font changes. Backing
stores are limited to 32 MiB. Above a 2048px board, visible boards are drawn
directly instead of allocating a large texture or magnifying a smaller one.
Only the inspector uses SVG. Its selector, move buttons, and FEN provide keyboard and text access
to every position. Piece glyphs use the system chess font.

Node and edge labels use a separate resolution-aware cache, capped at 256
entries and 8 MiB of backing stores. Camera changes draw through the shared
viewport adapter without React updates. Theme and font changes clear caches.
