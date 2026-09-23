const glyphs: Record<string, string> = {
  p: '♟',
  n: '♞',
  b: '♝',
  r: '♜',
  q: '♛',
  k: '♚',
};

/** Board coordinates are always White's perspective, a8 at the upper left. */
export default function Board({
  board,
  lastMove = [],
  size = 160,
}: {
  board: string;
  lastMove?: number[];
  size?: number;
}) {
  const cells = board
    .split('/')
    .flatMap((row) =>
      [...row].flatMap((piece) =>
        /[1-8]/.test(piece)
          ? (Array(Number(piece)).fill('') as string[])
          : [piece],
      ),
    );
  return (
    <svg width={size} height={size} viewBox="0 0 160 160" aria-hidden="true">
      {cells.map((piece, i) => {
        const file = i % 8,
          rank = Math.floor(i / 8),
          square = (7 - rank) * 8 + file;
        const white = piece !== '' && piece === piece.toUpperCase();
        return (
          <g key={i}>
            <rect
              x={file * 20}
              y={rank * 20}
              width={20}
              height={20}
              fill={
                lastMove.includes(square)
                  ? 'var(--atlas-move)'
                  : (file + rank) % 2
                    ? 'var(--atlas-dark-square)'
                    : 'var(--atlas-light-square)'
              }
            />
            {piece && (
              <text
                x={file * 20 + 10}
                y={rank * 20 + 16.5}
                textAnchor="middle"
                fontSize={19}
                fontFamily="Georgia, 'DejaVu Sans', serif"
                fill={
                  white
                    ? 'var(--atlas-white-piece)'
                    : 'var(--atlas-black-piece)'
                }
                stroke={
                  white
                    ? 'var(--atlas-black-piece)'
                    : 'var(--atlas-white-piece)'
                }
                strokeWidth={white ? 0.45 : 0.2}
                paintOrder="stroke"
              >
                {glyphs[piece.toLowerCase()]}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
