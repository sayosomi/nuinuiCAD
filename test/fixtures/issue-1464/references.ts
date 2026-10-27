// Independent authored declaration routes, not identities learned from candidates.
// `via` distinguishes instance/group routes even when leaf geometry is identical.
export type ReferenceOracle = { from: string; to: string; via?: string; parameterOf?: string };
const r = (from: string, to: string, via?: string): ReferenceOracle => ({from,to,...(via?{via}:{})});
export const references: Record<string,ReferenceOracle[]> = {
  E01:[r("L","P"),r("User","L")], E02:[r("read","local")], E03:[r("User","P")],
  E04:[r("G::User","G::P"),r("Outer","P")], E05:[r("L","P"),r("L","Base"),r("read","L")],
  E06:[r("L","A"),r("L","B"),r("read","A"),r("read","B")],
  I01:[r("User","Stamp::P","Copy")], I02:[r("L","Stamp::P","First"),r("L","Stamp::P","Second")],
  I03:[r("User","Stamp::L","Second")], I04:[r("L","Outer::P","Copy")], I05:[], I06:[],
  C01:[r("L","Base"),r("L","P")], C02:[r("User","P")], C03:[r("Skip","Base")],
  C04:[r("L","Base"),r("L","P")], C05:[r("P","width")], C06:[r("L","Base"),r("L","P")],
  S01:[r("read","P"),r("User","P")], S02:[r("User","Seam_bake"),r("End","Stamp::L","Copy")],
  S03:[r("L","Base"),r("L","P")], S04:[r("User","P")], S05:[r("Arc","Center"),r("read","Arc")], S06:[r("L","P")],
  X01:[r("read","b")], X02:[r("L","M::P","A"),r("L","M::P","B"),r("read","M::P","A"),r("read","M::P","B")],
  X03:[r("Control","width")], X04:[r("read","local")], X05:[r("read","n"),r("read","P")],
  R01:[r("L","M::P","A"),r("L","M::P","B")], R02:[r("read","b")], R03:[r("read","P")], R04:[], R05:[r("read","b")]
};
