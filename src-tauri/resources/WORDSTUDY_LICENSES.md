# Word Study data

`wordstudy.sqlite.gz` is **not distributed in this repository**. It is generated
locally by `scripts/build_wordstudy.py` from:

- **morphgnt/strongs-dictionary-xml** — Strong's Greek Dictionary in XML with real Greek.
  License: CC0 waiver. Author: Dr. Ulrik Sandborg-Petersen.
- **eliranwong/BHS-Strong-no** — mapping of Strong numbers onto BHS.
  Text: Biblia Hebraica Stuttgartensia, © 1977/1997 Deutsche Bibelgesellschaft.
  Annotations: ETCBC / Open Hebrew Bible, CC BY.
- **morphgnt/tischendorf** — Tischendorf 8th Greek New Testament with morphology,
  Strong's numbers and lemmatization. Public Domain.

The generated database contains Strong entries and word occurrences. Even though
it does not reproduce the upstream files in full, it may contain text derived
from works whose rights belong to third parties, including the BHS text. **Do not
redistribute the generated database without clearing the applicable rights.**

See [`docs/DATA.md`](../../docs/DATA.md) and each upstream repository for complete
attribution and license texts.
