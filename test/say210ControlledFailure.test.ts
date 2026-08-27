describe("SAY-210 controlled Discord failure reproduction", () => {
  it("fails intentionally and must never be merged", () => {
    expect("controlled-failure").toBe("success");
  });
});
