"""
Helper: print the YAML snippet we'll add to api-manifest/ta.yaml for ta.correlation,
plus the test block we'll add to tests/ta-missing.test.ts.

This is a planning helper only; the actual edits are applied via the Edit tool.
"""

snippet_yaml = """\
  - name: correlation
    signature:
      params:
        - { name: source1, type: series<float> }
        - { name: source2, type: series<float> }
        - { name: length, type: int, constraints: { min: 1 } }
    returns: series<float>
    semantics:
      warmup: length - 1
      na: "bars where either source is na are skipped; fewer than length paired samples yield na"
      formula: "Pearson correlation coefficient over the last length non-na paired samples"
    impl: { module: src/ta/statistics.ts, export: correlation }
    status: draft
    vectors: []
"""

print(snippet_yaml)
