"""Run with: python3 -m unittest discover -s scripts/notation -p 'test_*.py'."""
import importlib
import unittest

import numpy as np

alignment = importlib.import_module('align-score')
match_sequence = alignment.match_sequence
Converter = importlib.import_module('lilypond-score').Converter


class AlignmentTests(unittest.TestCase):
    def test_outro_does_not_move_final_score_note(self):
        pairs = match_sequence(np.array([60, 64, 67, 72]), np.array([60, 64, 67, 72, 65, 72]))
        self.assertEqual(pairs, [(0, 0), (1, 1), (2, 2), (3, 3)])

    def test_inserted_ornament_preserves_following_sequence(self):
        pairs = match_sequence(np.array([60, 64, 67, 72]), np.array([60, 64, 65, 64, 67, 72]))
        self.assertEqual(pairs[0], (0, 0))
        self.assertEqual(pairs[-2:], [(2, 4), (3, 5)])

    def test_unsupported_music_fails_loudly(self):
        with self.assertRaisesRegex(ValueError, 'Unsupported musical node'):
            Converter({}).convert({'upper': {'name': 'UnknownMusic'}})

    def test_two_voices_share_one_physical_key_attack(self):
        notes = [dict(id=nid, position=pos, midi=pitch, length=0.5, grace=False)
            for nid, pos, pitch in [('upper:C4', 0, 60), ('lower:C4', 0, 60), ('upper:E4', 0.5, 64)]]
        performance = [dict(midi=60, start=1.0, end=1.8), dict(midi=64, start=2.0, end=2.8)]
        timing, report = alignment.align(dict(measures=[{}], spanners=[]), notes, performance, {'performanceEnd': 3.0})
        self.assertEqual(report['physicalScoreAttacks'], 2)
        self.assertEqual(report['matchedAttacks'], 3)
        self.assertEqual(report['interpolatedAttacks'], [])
        self.assertEqual(timing['notes']['upper:C4'], timing['notes']['lower:C4'])


if __name__ == '__main__':
    unittest.main()
