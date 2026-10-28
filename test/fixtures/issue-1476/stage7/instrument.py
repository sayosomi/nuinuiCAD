from pathlib import Path
import hashlib,json
out=Path(__file__).parent
files=['rust-evaluator/src/evaluation/conditional_dependency_runtime.rs','rust-evaluator/src/evaluation/mod.rs']
for f in files:
 p=Path(f);b=p.read_bytes();(out/(p.name+'.base')).write_bytes(b)
p=Path(files[0]);s=p.read_text()
def replace(old,new,count=1):
 global s
 assert s.count(old)==count,(old[:100],s.count(old));s=s.replace(old,new)
replace('use serde::Deserialize;','thread_local! { static STAGE7_DEP_VISITS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) }; }\n\nuse serde::Deserialize;')
replace('    fn from_edges(edges: Vec<ConditionalDependencyEdge>) -> Self {','    fn from_edges(edges: Vec<ConditionalDependencyEdge>) -> Self {\n        eprintln!("STAGE7 {}", serde_json::json!({"event":"construct", "E":edges.len()}));')
start=s.index('    pub(crate) fn early_geometry_input_bindings(');end=s.index('    /// Scalar bindings referenced',start)
part=s[start:end];part=part.replace('        let mut prerequisites =','        let mut edge_visits = 0usize;\n        let mut prerequisites =').replace('        for edge in &self.edges {','        for edge in &self.edges {\n            edge_visits += 1;')
part=part.replace('        early\n','        eprintln!("STAGE7 {}", serde_json::json!({"event":"early", "edgeVisits":edge_visits, "linearBindings":linear_bindings.len(), "early":early.len()}));\n        early\n');s=s[:start]+part+s[end:]
start=s.index('    pub(crate) fn ready_dependency_scheduled_binding_ids(');end=s.index('    pub(crate) fn has_activation(',start)
part=s[start:end]
part=part.replace('        if readiness.candidate_binding_ids.is_empty() {','        let before = STAGE7_DEP_VISITS.with(|c|c.get());\n        let mut edge_visits = 0usize;\n        eprintln!("STAGE7 {}", serde_json::json!({"event":"readiness-start", "candidates":readiness.candidate_binding_ids, "E":self.edges.len()}));\n        if readiness.candidate_binding_ids.is_empty() {\n            eprintln!("STAGE7 {}", serde_json::json!({"event":"readiness-end", "edgeVisits":0, "dependencyEdgeVisits":0, "ready":0}));')
part=part.replace('        for edge in &self.edges {','        for edge in &self.edges {\n            edge_visits += 1;')
part=part.replace('                    edges.iter().all(|edge| {','                    edges.iter().all(|edge| {\n                        STAGE7_DEP_VISITS.with(|c|c.set(c.get()+1));')
part=part.replace('        ready\n','        eprintln!("STAGE7 {}", serde_json::json!({"event":"readiness-end", "edgeVisits":edge_visits, "dependencyEdgeVisits":STAGE7_DEP_VISITS.with(|c|c.get())-before, "ready":ready.len()}));\n        ready\n')
s=s[:start]+part+s[end:]
# Count every dependency edge inspected by the existing recursive readiness path.
start=s.index('fn geometry_property_prerequisites_are_ready(');end=s.index('impl ConditionalDependencyGraph',start)
part=s[start:end];part=part.replace('                        .all(|edge| {','                        .all(|edge| {\n                            STAGE7_DEP_VISITS.with(|c|c.set(c.get()+1));');s=s[:start]+part+s[end:]
# The first classification uses the same edge records in from-context; instrument each inspected outgoing edge there.
start=s.index('    fn ready_geometry_dependent_binding_ids_from_context(')
end=s.index('\n    pub(crate) fn',start)
part=s[start:end];part=part.replace('.all(|edge| {','.all(|edge| {\n                    STAGE7_DEP_VISITS.with(|c|c.set(c.get()+1));');s=s[:start]+part+s[end:]
p.write_text(s)
p=Path(files[1]);s=p.read_text();old='            let Some(resolver) = resolver else {\n                return HashSet::new();\n            };\n            let early = project_early_binding_ids(branch_selections);'
assert s.count(old)==1
s=s.replace(old,'            eprintln!("STAGE7 {}", serde_json::json!({"event":"source-order-query", "sourceOrder":source_order, "resolver":resolver.is_some(), "positions":execution_positions.len()}));\n'+old)
old='            conditional_dependency_graph\n                .as_ref()\n                .map(|graph| {\n                    graph.ready_dependency_scheduled_binding_ids('
assert s.count(old)==1
s=s.replace(old,'            eprintln!("STAGE7 {}", serde_json::json!({"event":"candidate-projection", "versions":binding_versions.as_ref().map_or(0, |v|v.versions.len()), "early":early.len(), "positions":execution_positions.len(), "candidates":candidate_binding_ids.len()}));\n'+old)
p.write_text(s)
print('Temporary counter instrumentation installed; exact original bytes backed up')
