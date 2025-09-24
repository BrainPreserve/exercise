# exercise
# Brain-Health Exercise Protocols

This repository stores a single source-of-truth CSV: `master.csv`.

## What is `master.csv`?
A table of brain-health–focused exercise protocols and coaching text that integrates:
- Exercise labels for the app (user-friendly)
- Code-safe keys (snake_case) for the backend
- Starting protocols and progressions
- Safety gates, biomarker-based adjustments (HRV, BP, CGM, sleep)
- Coaching text templates (non-API and API-driven)

## How to update (no coding)
1. Click `master.csv` → the pencil icon (Edit).
2. Drag-and-drop your updated CSV or edit cells.
3. Add a short note (e.g., “update plyometrics safety notes”) and **Commit changes**.

## PHI and privacy
- This repo stores **protocol metadata only** (no client PHI).
- Keep the repo **Private** unless you intend to share externally.

## Columns (quick reference)
- **Exercise Type** (display name) and **exercise_key** (code-safe key)
- **modality** (e.g., resistance, aerobic, dual_task, plyometric)
- **protocol_start**, **progression_rule**, **contraindications_flags**
- **biomarker_hooks** (JSON), **cognitive_targets**, **mechanism_tags**
- **safety_notes**, **home_equipment**
- **coach_script_non_api**, **coach_prompt_api**
- User-friendly + snake_case duplicates (e.g., *Direct Cognitive Benefits* and `direct_cognitive_benefits`).

