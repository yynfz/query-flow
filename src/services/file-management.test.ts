import { describe, expect, it } from "vitest";
import { buildFileManagementPlan, isValidManagementDate } from "./file-management";

const directories = [
  "2026-10-17",
  "2026-10-17/query_jumlah_remark",
  "63 - KALIMANTAN SELATAN",
  "63 - KALIMANTAN SELATAN/6301 - TANAH LAUT",
  "65 - KALIMANTAN UTARA",
  "65 - KALIMANTAN UTARA/6571 - KOTA TARAKAN",
  "65 - KALIMANTAN UTARA/6571 - KOTA TARAKAN/2026-10-17",
];

describe("Tim 34 file management planning", () => {
  it("validates real ISO dates", () => {
    expect(isValidManagementDate("2026-10-17")).toBe(true);
    expect(isValidManagementDate("2026-02-29")).toBe(false);
    expect(isValidManagementDate("17-10-2026")).toBe(false);
  });

  it("routes Excel files, creates missing date folders, and numbers collisions", () => {
    const plan = buildFileManagementPlan({
      directories,
      files: [
        "2026-10-17/Kategori_A_6301_abc.xlsx",
        "2026-10-17/again/Kategori_A_6301_abc.xlsx",
        "63 - KALIMANTAN SELATAN/6301 - TANAH LAUT/2026-10-17/Kategori_A_6301_ABC.XLSX",
        "65 - KALIMANTAN UTARA/6571 - KOTA TARAKAN/2026-10-17/existing_partial.xlsx",
      ],
    }, "2026-10-17");

    expect(plan.dateDirectories).toEqual(["63 - KALIMANTAN SELATAN/6301 - TANAH LAUT/2026-10-17"]);
    expect(plan.operations.map((operation) => operation.destinationName)).toEqual([
      "Kategori_A_6301_abc_2.xlsx",
      "Kategori_A_6301_abc_3.xlsx",
    ]);
    expect(plan.partialFiles).toEqual(["65 - KALIMANTAN UTARA/6571 - KOTA TARAKAN/2026-10-17/existing_partial.xlsx"]);
  });

  it("adds known Rantab query names and routes generic runs without renaming", () => {
    const plan = buildFileManagementPlan({
      directories: [...directories, "2026-10-17/run-unknown"],
      files: [
        "2026-10-17/query_jumlah_remark/RantabDBNAS_6571_1pf912l.xlsx",
        "2026-10-17/run-unknown/RantabDBNAS_6571_abc.xlsx",
        "2026-10-17/no-code.xlsx",
      ],
    }, "2026-10-17");

    expect(plan.operations[0]?.destinationName).toBe("RantabDBNAS_6571_1pf912l_query_jumlah_remark.xlsx");
    expect(plan.operations[1]?.destinationName).toBe("RantabDBNAS_6571_abc.xlsx");
    expect(plan.operations[1]?.renamed).toBe(false);
    expect(plan.issues.map((issue) => issue.reason)).toEqual(["no-code"]);
  });
});
