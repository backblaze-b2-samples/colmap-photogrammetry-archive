import { describe, expect, it } from "vitest";
import { APP_DESCRIPTION, APP_NAME } from "@/lib/app-config";

describe("app identity", () => {
  it("ships the app name and description", () => {
    expect(APP_NAME).toBe("COLMAP Photogrammetry Archive");
    expect(APP_DESCRIPTION).toBe(
      "Structure-from-motion photogrammetry archive on Backblaze B2"
    );
  });
});
