const mitLicense = (copyright) => `MIT License

${copyright}

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
SOFTWARE.`;

export const distributedDevelopmentPackages = new Set(["electron"]);

export const packageOverrides = new Map([
  [
    "@excalidraw/excalidraw@0.18.1",
    {
      license: "MIT",
      repository: "https://github.com/excalidraw/excalidraw",
      licenseTexts: [mitLicense("Copyright (c) 2020 Excalidraw")],
    },
  ],
  [
    "fuzzy@0.1.3",
    {
      license: "MIT",
      repository: "https://github.com/mattyork/fuzzy",
      licenseTexts: [mitLicense("Copyright (c) 2015 Matt York")],
    },
  ],
  [
    "khroma@2.1.0",
    {
      license: "MIT",
      repository: "https://github.com/fabiospampinato/khroma",
      licenseTexts: [
        mitLicense(
          "Copyright (c) 2019-present Fabio Spampinato, Andrew Maney",
        ),
      ],
    },
  ],
  [
    "qrcode-terminal@0.12.0",
    {
      license: "Apache-2.0",
      repository: "https://github.com/gtanner/qrcode-terminal",
      licenseTextFiles: [
        "node_modules/@chevrotain/cst-dts-gen/LICENSE.txt",
      ],
      additionalNotices: [
        `This product also includes QRCode for JavaScript.

Copyright (c) 2009 Kazuhiko Arase
https://www.d-project.com/

QRCode for JavaScript is licensed under the MIT license. The words "QR Code"
are registered trademarks of DENSO WAVE INCORPORATED.`,
      ],
    },
  ],
]);
