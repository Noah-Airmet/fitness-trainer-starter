import fs from 'fs';
import path from 'path';

const filePath = './data/exercises/exercises.json';

const exercisesToEnrich = {
  // Pushes
  "barbell_bench_press": {
    "score": 7.5, "tier": "B", "stability": "medium", "stretch": "medium", "sfr": "medium",
    "verdict": "Great strength benchmark, but chest stretch is limited by the physical bar hitting the chest."
  },
  "dumbbell_bench_press": {
    "score": 8.5, "tier": "A", "stability": "medium", "stretch": "high", "sfr": "high",
    "verdict": "Allows a deeper chest stretch and free arm convergence, though setup can limit top weights."
  },
  "incline_barbell_bench_press": {
    "score": 7.5, "tier": "B", "stability": "medium", "stretch": "medium", "sfr": "medium",
    "verdict": "Solid upper chest builder; similarly restricted by the bar path."
  },
  "incline_dumbbell_press": {
    "score": 9.0, "tier": "S", "stability": "medium", "stretch": "high", "sfr": "high",
    "verdict": "Top-tier upper-chest developer. Joint-friendly angle allows optimal alignment with upper chest fibers."
  },
  "incline_dumbbell_flyes": {
    "score": 6.5, "tier": "C", "stability": "low", "stretch": "high", "sfr": "low",
    "verdict": "Excellent stretch, but tension drops off to zero at the top. Cable variations are vastly superior."
  },
  "push_up": {
    "score": 7.5, "tier": "B", "stability": "medium", "stretch": "medium", "sfr": "high",
    "verdict": "Excellent shoulder blade movement (scapular freedom), but difficult to overload progressively."
  },
  "chest_press_machine": {
    "score": 9.5, "tier": "S", "stability": "high", "stretch": "high", "sfr": "high",
    "verdict": "Highly stable, allowing safe training close to absolute muscular failure without balance constraints."
  },
  "cable_crossover": {
    "score": 8.5, "tier": "A", "stability": "medium", "stretch": "high", "sfr": "high",
    "verdict": "Maintains constant tension across the entire range of motion, providing a great squeeze at the top."
  },
  "overhead_barbell_press": {
    "score": 6.0, "tier": "D", "stability": "low", "stretch": "medium", "sfr": "low",
    "verdict": "Excellent strength/overhead test, but high fatigue and lower back limits make it sub-optimal for shoulder growth."
  },
  "seated_dumbbell_shoulder_press": {
    "score": 8.0, "tier": "A", "stability": "high", "stretch": "high", "sfr": "high",
    "verdict": "Far superior shoulder hypertrophy stimulus than standing barbell press due to back support and stability."
  },
  "dumbbell_lateral_raise": {
    "score": 7.5, "tier": "B", "stability": "low", "stretch": "low", "sfr": "medium",
    "verdict": "Classic lateral head isolation, but suffers from zero tension at the bottom and max tension at the top."
  },
  "cable_lateral_raise": {
    "score": 9.0, "tier": "S", "stability": "medium", "stretch": "high", "sfr": "high",
    "verdict": "Superior to dumbbells due to constant cable tension, especially overloading the lateral delts in their stretched position."
  },
  "cable_tricep_pushdown": {
    "score": 9.0, "tier": "S", "stability": "high", "stretch": "medium", "sfr": "high",
    "verdict": "Superb lateral/medial tricep head builder. Extremely stable and easily customized."
  },
  "overhead_dumbbell_tricep_extension": {
    "score": 8.5, "tier": "A", "stability": "medium", "stretch": "high", "sfr": "high",
    "verdict": "Puts the long head of the triceps in a deep stretch, capitalizing on stretch-mediated hypertrophy."
  },
  "lying_tricep_extension": {
    "score": 8.0, "tier": "A", "stability": "medium", "stretch": "high", "sfr": "medium",
    "verdict": "Hits the long head under excellent load, but can cause elbow joint stress over time."
  },

  // Pulls
  "lat_pulldown": {
    "score": 8.5, "tier": "A", "stability": "high", "stretch": "high", "sfr": "high",
    "verdict": "Highly stable, easily progressive vertical pull that loads the lats optimally in the stretch."
  },
  "pull_up": {
    "score": 8.0, "tier": "A", "stability": "medium", "stretch": "high", "sfr": "medium",
    "verdict": "Classic vertical pull, but bodyweight limitation makes incremental loading less smooth."
  },
  "assisted_pull_up": {
    "score": 8.5, "tier": "A", "stability": "high", "stretch": "high", "sfr": "high",
    "verdict": "More scalable and controllable version of the pull-up, allowing strict lat isolation."
  },
  "seated_cable_row": {
    "score": 8.5, "tier": "A", "stability": "medium", "stretch": "high", "sfr": "high",
    "verdict": "Stable horizontal pull allowing great shoulder blade retraction and middle-back loading."
  },
  "chest_supported_row_machine": {
    "score": 9.5, "tier": "S", "stability": "high", "stretch": "high", "sfr": "high",
    "verdict": "Top-tier back builder. Chest support completely removes lower back limits, letting you isolate the upper back or lats."
  },
  "dumbbell_row": {
    "score": 8.0, "tier": "A", "stability": "medium", "stretch": "high", "sfr": "medium",
    "verdict": "Excellent single-arm row that provides a deep lat stretch, though core rotation can creep in."
  },
  "barbell_row": {
    "score": 6.5, "tier": "C", "stability": "low", "stretch": "medium", "sfr": "low",
    "verdict": "Great for overall strength, but highly limited by spinal erector fatigue rather than upper back fatigue."
  },
  "face_pull": {
    "score": 8.0, "tier": "A", "stability": "medium", "stretch": "medium", "sfr": "high",
    "verdict": "Outstanding for rear delts, lower traps, and general rotator cuff/shoulder health."
  },
  "reverse_dumbbell_fly": {
    "score": 7.0, "tier": "B", "stability": "low", "stretch": "low", "sfr": "medium",
    "verdict": "Good rear-delt builder, though tension is unevenly distributed through the arc."
  },
  "lat_pulldown_close_grip": {
    "score": 9.0, "tier": "S", "stability": "high", "stretch": "high", "sfr": "high",
    "verdict": "Close grip puts the lats in an excellent line of pull, leading to deep stretch and high activation."
  },
  "dumbbell_curl": {
    "score": 8.0, "tier": "A", "stability": "medium", "stretch": "medium", "sfr": "high",
    "verdict": "A baseline staple. Supinating the wrist at the top aligns with the biceps' main functions."
  },
  "hammer_curl": {
    "score": 8.0, "tier": "A", "stability": "medium", "stretch": "medium", "sfr": "high",
    "verdict": "Essential for building forearm thickness and upper-arm width by targeting brachialis and brachioradialis."
  },
  "incline_dumbbell_curl": {
    "score": 9.0, "tier": "S", "stability": "medium", "stretch": "high", "sfr": "high",
    "verdict": "Unrivaled stretch-mediated bicep builder. Keeps constant tension on the long head in its most lengthened position."
  },
  "preacher_curl": {
    "score": 8.5, "tier": "A", "stability": "high", "stretch": "medium", "sfr": "high",
    "verdict": "Arm support removes momentum, creating strict tension, but overloading is heaviest at the bottom extension."
  },
  "cable_bicep_curl": {
    "score": 8.5, "tier": "A", "stability": "medium", "stretch": "medium", "sfr": "high",
    "verdict": "Constant tension throughout the entire movement arc, preventing rest at the bottom or top."
  },

  // Legs
  "barbell_back_squat": {
    "score": 7.5, "tier": "B", "stability": "medium", "stretch": "high", "sfr": "low",
    "verdict": "Amazing strength movement, but systemic/lower-back fatigue limits direct quad growth compared to hack squats."
  },
  "goblet_squat": {
    "score": 7.0, "tier": "B", "stability": "medium", "stretch": "high", "sfr": "medium",
    "verdict": "Great for learning squat mechanics, but loading is limited by how much weight your arms can support."
  },
  "leg_press": {
    "score": 9.0, "tier": "S", "stability": "high", "stretch": "high", "sfr": "high",
    "verdict": "Superb quad hypertrophy tool. High stability removes back limitation, letting you load the quads deep in the stretch."
  },
  "romanian_deadlift": {
    "score": 9.5, "tier": "S", "stability": "medium", "stretch": "high", "sfr": "high",
    "verdict": "The gold standard for posterior chain hypertrophy. Overloads the hamstrings and glutes under deep eccentric stretch."
  },
  "barbell_deadlift": {
    "score": 5.0, "tier": "F", "stability": "low", "stretch": "low", "sfr": "low",
    "verdict": "Excellent whole-body power builder, but poor stimulus-to-fatigue ratio due to lack of eccentric control and high fatigue."
  },
  "seated_leg_curl": {
    "score": 9.5, "tier": "S", "stability": "high", "stretch": "high", "sfr": "high",
    "verdict": "Top-tier hamstring builder. Seated posture flexes the hips, placing hamstrings in a maximally stretched state."
  },
  "lying_leg_curl": {
    "score": 8.5, "tier": "A", "stability": "medium", "stretch": "medium", "sfr": "high",
    "verdict": "Isolates hamstrings, but offers slightly less growth stimulus than seated curls due to neutral hips."
  },
  "leg_extension": {
    "score": 8.5, "tier": "A", "stability": "high", "stretch": "low", "sfr": "high",
    "verdict": "The only exercise that isolates the rectus femoris (quad) under peak contraction. Excellent stability."
  },
  "barbell_hip_thrust": {
    "score": 8.0, "tier": "A", "stability": "medium", "stretch": "low", "sfr": "medium",
    "verdict": "Excellent peak contraction glute overload, but setup can be tedious and fatigue-inducing."
  },
  "bulgarian_split_squat": {
    "score": 9.0, "tier": "S", "stability": "low", "stretch": "high", "sfr": "high",
    "verdict": "Incredible quad and glute builder under stretch. Unilateral isolation is fantastic, though balance can be tricky."
  },
  "dumbbell_lunges": {
    "score": 7.5, "tier": "B", "stability": "low", "stretch": "medium", "sfr": "medium",
    "verdict": "Dynamic athletic movement, but balance requirements reduce absolute target muscle loading."
  },
  "standing_calf_raise": {
    "score": 8.0, "tier": "A", "stability": "medium", "stretch": "high", "sfr": "high",
    "verdict": "Essential for calf gastrocnemius growth; requires a deep stretch hold at the bottom."
  },
  "seated_calf_raise": {
    "score": 7.5, "tier": "B", "stability": "high", "stretch": "high", "sfr": "medium",
    "verdict": "Isolates the soleus (lower calf) because the bent knee deactivates the larger gastrocnemius muscle."
  },
  "trap_bar_deadlift": {
    "score": 8.0, "tier": "A", "stability": "medium", "stretch": "medium", "sfr": "medium",
    "verdict": "A hybrid hinge/squat that is easier on the back than conventional pulls and hits quads harder."
  },
  "goblet_box_squat": {
    "score": 6.5, "tier": "C", "stability": "medium", "stretch": "medium", "sfr": "medium",
    "verdict": "Good squat regression, but pausing on the box dissipates stored elastic energy and tension."
  },

  // Core
  "plank": {
    "score": 6.0, "tier": "D", "stability": "high", "stretch": "low", "sfr": "medium",
    "verdict": "Decent baseline stability builder, but static isometric hold is poor for direct abdominal hypertrophy."
  },
  "dead_bug": {
    "score": 7.0, "tier": "B", "stability": "high", "stretch": "low", "sfr": "high",
    "verdict": "Incredible for deep core stability (transversus abdominis) and anti-extension lumbar control."
  },
  "pallof_press": {
    "score": 7.5, "tier": "B", "stability": "medium", "stretch": "low", "sfr": "high",
    "verdict": "Outstanding anti-rotation exercise, teaching oblique/core engagement without shearing forces."
  },
  "hanging_knee_raise": {
    "score": 8.0, "tier": "A", "stability": "low", "stretch": "high", "sfr": "high",
    "verdict": "Highly effective for lower rectus abdominis, provided you actively tilt the pelvis upward at the top."
  },
  "russian_twist": {
    "score": 6.0, "tier": "D", "stability": "low", "stretch": "medium", "sfr": "low",
    "verdict": "Good oblique rotative idea, but frequently performed with high momentum and lower back shear."
  },
  "ab_wheel_rollout": {
    "score": 8.5, "tier": "A", "stability": "medium", "stretch": "high", "sfr": "high",
    "verdict": "Extreme anti-extension load. Smashes the rectus abdominis under stretch, but has a high entry barrier."
  },

  // Contrasts (to be added)
  "classic_sit_up": {
    "score": 4.0, "tier": "F", "stability": "medium", "stretch": "low", "sfr": "low",
    "verdict": "Low abdominal efficacy. Hip flexors perform the majority of the work while the lower back is heavily compressed."
  },
  "abdominal_crunch": {
    "score": 6.5, "tier": "C", "stability": "medium", "stretch": "low", "sfr": "medium",
    "verdict": "Slightly better than sit-ups because it excludes hip flexors, but has a very limited range of motion."
  }
};

const contrastExercises = [
  {
    "id": "classic_sit_up",
    "name": "Classic Sit-Up",
    "category": "core",
    "equipment": [],
    "movement_pattern": "dynamic core",
    "primary_muscles": [
      "hip_flexors"
    ],
    "secondary_muscles": [
      "rectus_abdominis"
    ],
    "biomechanics": "Flexes the torso off the floor. Heavy activation of iliopsoas/rectus femoris (hip flexors) to lift the torso, causing spinal compression with minimal direct abdominal tension.",
    "setup_cues": [
      "Lie flat on your back with knees bent and feet anchored.",
      "Place hands behind head or crossed over chest.",
      "Lift your entire torso off the floor until your chest touches your thighs.",
      "Lower back down to the floor."
    ],
    "common_mistakes": [
      "Yanking the neck forward with hands.",
      "Relying entirely on hip flexors instead of squeezing the abs.",
      "Rounding and compressing the lumbar spine aggressively under load."
    ],
    "progression": "Perform on a decline bench or hold a plate to your chest.",
    "regression": "Perform abdominal crunches (keeping lower back on the floor).",
    "substitutions": [
      "dead_bug",
      "abdominal_crunch",
      "hanging_knee_raise"
    ],
    "media": {
      "url": null,
      "type": null,
      "license": null,
      "attribution": null
    }
  },
  {
    "id": "abdominal_crunch",
    "name": "Abdominal Crunch",
    "category": "core",
    "equipment": [],
    "movement_pattern": "dynamic core",
    "primary_muscles": [
      "rectus_abdominis"
    ],
    "secondary_muscles": [
      "obliques"
    ],
    "biomechanics": "Isolates the upper rectus abdominis by flexing only the thoracic spine, keeping the lumbar spine flat on the floor.",
    "setup_cues": [
      "Lie on back with knees bent, feet flat on the floor.",
      "Place fingers lightly behind ears, keeping elbows wide.",
      "Contract abs to lift shoulders off the floor while pressing lower back down.",
      "Exhale and squeeze at the top, then slowly lower shoulders down."
    ],
    "common_mistakes": [
      "Pulling on the head/neck.",
      "Lifting the lower back off the floor, which engages the hip flexors.",
      "Using momentum to bounce off the floor."
    ],
    "progression": "Decline crunch or cable crunch to add range and resistance.",
    "regression": "Hand-slide crunch (sliding hands up thighs toward knees).",
    "substitutions": [
      "classic_sit_up",
      "dead_bug",
      "hanging_knee_raise"
    ],
    "media": {
      "url": null,
      "type": null,
      "license": null,
      "attribution": null
    }
  }
];

function enrich() {
  console.log(`Reading exercises from ${filePath}...`);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  let currentList = data.exercises || [];

  // 1. Add contrast exercises if they don't exist
  for (const contrast of contrastExercises) {
    const exists = currentList.some(ex => ex.id === contrast.id);
    if (!exists) {
      console.log(`Adding new contrast exercise: ${contrast.name}`);
      currentList.push(contrast);
    }
  }

  // 2. Enrich each exercise in the list
  let enrichedCount = 0;
  const updatedExercises = currentList.map(exercise => {
    const ratingData = exercisesToEnrich[exercise.id];
    if (ratingData) {
      enrichedCount++;
      return {
        ...exercise,
        expert_rating: ratingData
      };
    } else {
      // Warmups / recovery / utility movements
      return {
        ...exercise,
        expert_rating: null
      };
    }
  });

  data.exercises = updatedExercises;
  
  console.log(`Writing back to ${filePath}...`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`Successfully enriched ${enrichedCount} exercises with science ratings!`);
}

enrich();
