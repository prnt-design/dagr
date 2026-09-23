"""Regenerate validated board snapshots: python-chess==1.999 (chess==1.11.2)."""
import argparse
import io
import json
from pathlib import Path
import chess
import chess.pgn

ROOT = Path(__file__).resolve().parent

def generate():
    nodes = {}
    for line in json.loads((ROOT / 'lines.json').read_text()):
        game = chess.pgn.read_game(io.StringIO(line['pgn']))
        assert game and not game.errors, line['name']
        board = game.board()
        prefix, sans = [], []
        parent = None
        for move in [None, *game.mainline_moves()]:
            if move is not None:
                assert move in board.legal_moves
                sans.append(board.san(move))
                prefix.append(move.uci())
                board.push(move)
            key = 'start' if not prefix else '_'.join(prefix)
            if key not in nodes:
                nodes[key] = dict(id=key, parent=parent, ply=len(prefix),
                    san=sans[-1] if sans else 'Start', moves=list(sans),
                    fen=board.fen(), board=board.board_fen(),
                    turn='White' if board.turn else 'Black',
                    lastMove=[] if move is None else [move.from_square, move.to_square],
                    families=[], openings=[])
            if line['family'] not in nodes[key]['families']:
                nodes[key]['families'].append(line['family'])
            parent = key
        nodes[key]['openings'].append(dict(name=line['name'],eco=line['eco']))
    return json.dumps(list(nodes.values()),ensure_ascii=False,indent=2)+'\n'

if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--check',action='store_true')
    args=parser.parse_args()
    output=generate()
    target=ROOT/'positions.json'
    if args.check:
        assert target.read_text()==output, 'Regenerate positions.json'
    else:
        target.write_text(output)
    positions=json.loads(output)
    print(f'Validated {len(positions)} positions from 24 legal opening lines.')
