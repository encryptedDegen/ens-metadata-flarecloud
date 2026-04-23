import { Resvg, initWasm } from "@resvg/resvg-wasm";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import SatoshiBold from "../fonts/Satoshi-Bold.ttf";

// initWasm rejects on a second call within the same isolate, so cache the
// promise — every subsequent rasterize awaits the same init.
let wasmReady: Promise<void> | null = null;

function ensureWasm(): Promise<void> {
  if (!wasmReady) {
    wasmReady = initWasm(resvgWasm);
  }
  return wasmReady;
}

const SATOSHI_FONT = new Uint8Array(SatoshiBold);

export async function rasterizeNameImageSvg(svg: string): Promise<Uint8Array> {
  await ensureWasm();
  const resvg = new Resvg(svg, {
    font: {
      fontBuffers: [SATOSHI_FONT],
      defaultFontFamily: "Satoshi",
    },
    fitTo: { mode: "original" },
    textRendering: 1,
    shapeRendering: 2,
  });
  const rendered = resvg.render();
  try {
    return rendered.asPng();
  } finally {
    rendered.free();
    resvg.free();
  }
}
