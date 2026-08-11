# Third-party notices

LightMark bundles the following libraries for offline Markdown rendering:

- [marked](https://github.com/markedjs/marked), version 16.2.1, MIT License.
- [DOMPurify](https://github.com/cure53/DOMPurify), version 3.2.6, Apache-2.0 or MPL-2.0.
- [AnyDoc](https://github.com/firecrawl/anydoc), version 0.1.8, MIT License. Copyright (c) 2026 Sideguide Technologies Inc.

Copyright and license notices are retained in the bundled JavaScript files under `Resources/`.
LightMark includes a modified copy of AnyDoc 0.1.8's Markdown renderer under `src-tauri/src/anydoc_markdown/`; the modification resolves embedded image assets to local relative paths while preserving their reading position.

AnyDoc is distributed under the MIT License:

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.
