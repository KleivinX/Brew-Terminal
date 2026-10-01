# Third-party notices

Brew Terminal is AGPL-3.0-or-later. Its dependencies carry their own licences, listed with the
reason for each in [`DEPENDENCIES.md`](DEPENDENCIES.md). This file is for the one case that is
not a dependency: third-party work that has been **ported into this repository** rather than
linked against.

## Kronos

`src-tauri/src/localai/kronos.rs` is a Rust port of the inference path of
[Kronos](https://github.com/shiyu-coder/Kronos) — specifically of `model/kronos.py` and
`model/module.py`. It is a translation of that code, so it is a derivative of it, and it is
included here under the terms below.

`src-tauri/tests/fixtures/kronos/` holds three files copied unmodified from the same repository's
`tests/data/`: `regression_input.csv`, `regression_output_256.csv` and
`regression_output_512.csv`. They are upstream's own regression fixture, and
`src-tauri/tests/kronos_parity.rs` uses them to check this port against the reference
implementation.

The model **weights** are not in this repository and are not distributed with the app. A user who
switches the feature on downloads them directly from the publisher's Hugging Face pages
(`NeoQuasar/Kronos-small`, `NeoQuasar/Kronos-Tokenizer-base`), both published under the MIT
licence, at the commits and checksums pinned in `src-tauri/src/localai/catalogue.rs`.

Brew Terminal is not affiliated with, endorsed by, or reviewed by the authors of Kronos.

```
MIT License

Copyright (c) 2025 ShiYu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The paper: Shi et al., _Kronos: A Foundation Model for the Language of Financial Markets_,
[arXiv:2508.02739](https://arxiv.org/abs/2508.02739).
