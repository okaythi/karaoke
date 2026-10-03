import unittest
from closing_passage import prepare_closing_passage


class ClosingPassageTests(unittest.TestCase):
    def test_closing_passage_retains_every_attack_on_its_recorded_timeline(self):
        performance = [dict(midi=60, start=1.0, end=2.0),
            dict(midi=38, start=5.0, end=5.8), dict(midi=62, start=5.01, end=5.9),
            dict(midi=66, start=5.5, end=7.2)]
        passage = prepare_closing_passage(performance, 3.0, 7.0)
        self.assertEqual([n['audioStart'] for n in passage['notes']], [5.0, 5.01, 5.5])
        self.assertEqual([n['midi'] for n in passage['notes']], [38, 62, 66])
        self.assertEqual([n['tick'] for n in passage['notes']], [0, 0, 480])
        self.assertEqual(passage['notes'][-1]['audioEnd'], 7.0)


if __name__ == "__main__":
    unittest.main()
