# Project instructions

- Before running any test, separately tell the user its scope and expected effects. Be explicit about whether it runs only in Node or operates the live AE project.
- Do not automatically run AE host tests as part of the normal Node suite.
- AE tests use an identified temporary composition, leave existing compositions and layers alone, and remove their temporary items afterward. Do not save or overwrite the user's project.
- Read back cleanup results. AE `itemByID` can throw for a deleted item on the current build; scan project items to confirm absence instead.
- Distinguish package/preflight tests, actual AE property tests, and rendered pixel checks in reports.
