# Form Check — Video Review Pipeline

A frame-sampled video form review any vision-capable model can execute
(validated on cable lateral raises). The EXPENSIVE part — reading frames — can
be delegated to a cheaper vision model or subagent, while the trainer agent
keeps judgment, verification, and all data writes. Needs `ffmpeg`.

**This is not calibrated biomechanics.** Findings are high-confidence visual
observations from sampled frames — phrase them that way. Never report joint
angles as measurements, never make medical/injury claims. What this method is
genuinely good at: trunk lean, free-limb counterbalance, bar/handle path and
finish height, tempo class (controlled vs bounced), left/right differences,
fatigue-drift across a set.

## Division of labor (who does what)

1. **The athlete** films one working set per arm/angle (phone on the floor
   works fine), drops the files somewhere the agent can read, tells the trainer.
2. **Delegate reviewer** (cheap vision model, dispatched on the bus) runs the
   extraction recipes below, reads the frames, returns the output contract.
3. **Trainer agent** (the Claude session) spot-checks 2–3 of the reviewer's
   cited keyframes itself before accepting any finding, then writes the
   distilled ruling into `data/<user>/coaching-notes.md` and the relevant
   goal's `next_micro_target`. **The reviewer never writes data or docs.**

## Step 0 — Orientation and handedness (do this FIRST, it burns reviews)

- `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,duration -of csv=p=0 FILE`
- Phone clips carry rotation metadata: a "3840x2160" file is usually
  PORTRAIT after auto-rotation (2160x3840). All crop coordinates below assume
  the rotated (as-displayed) frame.
- **Do not trust "screen left = subject's right."** Front-camera footage may
  be mirrored. Anchor handedness on asymmetric landmarks (a watch, a ring —
  record the athlete's in `coaching-notes.md`). Find them in a crop before
  claiming which arm is which, and state the anchor in the report.

## Step 1 — Contact sheet (structure of the clip)

    ffmpeg -v error -i FILE -vf "fps=12/DURATION,scale=-2:480,tile=4x3" -frames:v 1 overview.png

One image, 12 evenly spaced frames. Identifies setup time vs working set,
camera angle, and roughly when reps happen.

## Step 2 — Rep strips (the main evidence)

    ffmpeg -v error -ss START -t 20 -i FILE -vf "fps=2,scale=-2:360,tile=5x8" -frames:v 1 strip.png

2 fps over the working window (each strip = 20 s = 40 frames, one image).
Two strips usually cover a set. At 2 fps you can read: rep cadence, top/bottom
positions, drift across the set. Frame timestamp = START + index × 0.5 s.

## Step 3 — Full-resolution keyframes (verify before you claim)

    ffmpeg -v error -ss T -i FILE -frames:v 1 -vf scale=-2:900 key-T.png

Pull 3–6 single frames at moments the strips flag (rep top early vs late in
the set is the highest-value comparison). Every finding in the report must
cite at least one keyframe timestamp.

## Step 4 — Crops (only when a detail decides something)

    ffmpeg -v error -ss T -i FILE -frames:v 1 -vf "crop=W:H:X:Y,scale=500:-2" crop.png

Wrist/landmark identification, grip details, bar-to-chest distance.

## What to look for (generic, all lifts)

- **Fatigue drift**: compare rep 1–3 keyframes against final-rep keyframes.
  The difference IS the finding — early-set form shows what the lifter can
  do; late-set drift shows what the load forces.
- **Free-limb counterbalance**: the non-working arm/leg drifting or flinging
  outward — it means the trunk is doing part of the work.
- **Trunk angle**: side-bend or layback relative to the first rep.
- **Tempo class**: from 2 fps strips — controlled (~2–3 s/rep, distinct
  top/bottom holds) vs bounced (bottom positions barely sampled).
- **ROM endpoints**: where the implement starts and finishes, early vs late.

## Per-lift form gates (example — keep the athlete's real list in coaching-notes.md)

- **Cable lateral raise**: handle finishes AT shoulder height (not above);
  outward arc, not vertical yank; torso still — watch the free arm fling and
  lean-away; soft constant elbow bend (~15°).
- **Seated cable row**: handle to sternum, shoulder blades squeeze, torso
  lean-back ≤ ~10–15° and CONSTANT.
- **Romanian deadlift**: flat back through the hinge, bar close to legs,
  hips travel back not down. Flag ANY rounding, phrase gently.
- **Barbell bench**: descent control, elbow flare, hips staying on the bench.

## Output contract (what the reviewer returns — nothing else)

    {
      "video": "IMG_xxxx.MOV",
      "arm_or_angle": "left | right | front | side (state the landmark used)",
      "reps_observed": 12,
      "ruling": "one sentence: strict / acceptable / breaking down",
      "primary_compensation": "one sentence, with keyframe timestamps",
      "secondary_observation": "optional, one sentence, with timestamps",
      "cue_for_next_time": "one actionable cue",
      "left_right_note": "only if both arms reviewed",
      "confidence": "high | medium | low — visual observation, not measurement",
      "evidence": ["key-21.0.png", "key-51.0.png"]
    }

## Dispatching the review

Hand the review to a cheaper vision-capable subagent or agent CLI with a
charter containing: video path(s), the lift, this file's path (the reviewer
reads it first), the per-lift gate, a scratch dir for extracted frames, and
the output contract. The trainer then verifies cited keyframes and writes the
record. The reviewer runs read-only.

## Proactivity policy

- **Analysis is on-demand**: run the pipeline when the athlete provides video.
- **Suggestions are allowed but capped**: the trainer may INVITE a video —
  one lift, at most about once a week, only when that lift's progression is
  explicitly form-gated (e.g. "if you think of it Friday, film set 1 of
  rows") — folded into a plan note, never a standing demand. No nagging; the
  set count is never blocked on footage.
- The weekly review may name ONE candidate lift for next week's filming when
  a form gate is active.
