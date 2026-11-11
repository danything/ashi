import { describe, expect, test } from "bun:test";

import { isSoftwareRenderer } from "../src/lib/lite.ts";

describe("ソフトウェアで描いている端末の見分け", () => {
  test("ソフトウェアの描き手の名前なら、動き続けるものを止める側", () => {
    expect(
      isSoftwareRenderer(
        "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)",
      ),
    ).toBe(true);
    expect(isSoftwareRenderer("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe(true);
    expect(
      isSoftwareRenderer("ANGLE (Microsoft, Microsoft Basic Render Driver)"),
    ).toBe(true);
  });

  test("WebGL を作れなければソフトウェアとみなす", () => {
    expect(isSoftwareRenderer(null)).toBe(true);
  });

  test("GPU の名前や、見分けられない名前では止めない", () => {
    expect(
      isSoftwareRenderer(
        "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)",
      ),
    ).toBe(false);
    expect(isSoftwareRenderer("Apple GPU")).toBe(false);
  });
});
