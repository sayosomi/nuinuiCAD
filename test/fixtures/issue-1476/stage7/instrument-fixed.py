from pathlib import Path
p=Path(__file__).parent
files=['rust-evaluator/src/evaluation/conditional_dependency_runtime.rs','rust-evaluator/src/evaluation/mod.rs','rust-evaluator/src/bin/evaluation_stdio.rs']
for f in files:(p/(Path(f).name+'.fixed-clean')).write_bytes(Path(f).read_bytes())
f=Path(files[0]);s=f.read_text()
s=s.replace('use serde::Deserialize;','thread_local! { static STAGE7_DEP_VISITS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) }; }\n\nuse serde::Deserialize;',1)
s=s.replace('    fn from_edges(edges: Vec<ConditionalDependencyEdge>) -> Self {','    fn from_edges(edges: Vec<ConditionalDependencyEdge>) -> Self {\n        eprintln!("STAGE7 {}", serde_json::json!({"event":"construct", "E":edges.len()}));',1)
a=s.index('    pub(crate) fn early_geometry_input_bindings(');b=s.index('    /// Scalar bindings referenced',a);t=s[a:b].replace('        let mut prerequisites =','        let mut edge_visits = 0usize;\n        let mut prerequisites =').replace('        for edge in &self.edges {','        for edge in &self.edges {\n            edge_visits += 1;').replace('        early\n','        eprintln!("STAGE7 {}", serde_json::json!({"event":"early", "edgeVisits":edge_visits, "linearBindings":linear_bindings.len(), "early":early.len()}));\n        early\n');s=s[:a]+t+s[b:]
a=s.index('    pub(crate) fn ready_dependency_scheduled_binding_ids');b=s.index('    pub(crate) fn has_activation(',a);t=s[a:b]
t=t.replace('        if readiness.candidate_binding_ids.is_empty() {','        let before = STAGE7_DEP_VISITS.with(|c|c.get());\n        let mut edge_visits = 0usize;\n        eprintln!("STAGE7 {}", serde_json::json!({"event":"readiness-start", "candidates":readiness.candidate_binding_ids, "E":self.edges.len()}));\n        if readiness.candidate_binding_ids.is_empty() {\n            eprintln!("STAGE7 {}", serde_json::json!({"event":"readiness-end", "edgeVisits":0, "dependencyEdgeVisits":0, "ready":0}));')
t=t.replace('            for edge in &self.edges {','            for edge in &self.edges {\n                edge_visits += 1;')
t=t.replace('        ready\n','        eprintln!("STAGE7 {}", serde_json::json!({"event":"readiness-end", "edgeVisits":edge_visits, "dependencyEdgeVisits":STAGE7_DEP_VISITS.with(|c|c.get())-before, "ready":ready.len()}));\n        ready\n');s=s[:a]+t+s[b:]
s=s.replace('.filter(|edge| edge_is_active(edge, context.branch_selections))','.filter(|edge| { STAGE7_DEP_VISITS.with(|c|c.set(c.get()+1)); edge_is_active(edge, context.branch_selections) })')
f.write_text(s)
f=Path(files[1]);s=f.read_text();old='            let Some(resolver) = resolver else {\n                return HashSet::new();\n            };\n            let early = project_early_binding_ids(branch_selections);';assert s.count(old)==1
s=s.replace(old,'            eprintln!("STAGE7 {}", serde_json::json!({"event":"source-order-query", "sourceOrder":source_order, "resolver":resolver.is_some(), "positions":execution_positions.len()}));\n'+old)
old='            conditional_dependency_graph\n                .as_ref()\n                .map(|graph| {\n                    graph.ready_dependency_scheduled_binding_ids(';assert s.count(old)==1
s=s.replace(old,'            eprintln!("STAGE7 {}", serde_json::json!({"event":"candidate-projection", "versions":binding_versions.as_ref().map_or(0, |v|v.versions.len()), "early":early.len(), "positions":execution_positions.len(), "candidates":candidate_binding_ids.len()}));\n'+old);f.write_text(s)
f=Path(files[2]);s=f.read_text().replace('    let request: NativeRequest = serde_json::from_str(line)?;','    let request: NativeRequest = serde_json::from_str(line)?;\n    if let NativeRequest::Evaluation(request) = &request {\n        eprintln!("STAGE7 {}", serde_json::json!({"event":"request-start", "id":request.id}));\n    }');f.write_text(s)
print('Fixed tree instrumented; repair-only production bytes preserved')
