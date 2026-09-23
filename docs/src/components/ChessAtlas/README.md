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
node positions and edge routes. Shared GraphViewport and SvgAdapter provide
camera controls and crisp vectors. Piece glyphs use the system chess font.
