// Run via `npm run db:seed:dev` (uses tsx --env-file=.env.local).
// Direct invocation requires env vars set in the shell.
//
// Idempotent: re-running upserts users, programs, and categories, and skips
// projects/inventory items that already exist (matched by title / serial).
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  categories,
  inventoryItems,
  programInstructors,
  programs,
  projectCategories,
  projects,
  user,
} from "../src/db/schema";
import { auth } from "../src/lib/auth";

const PASSWORD = "password";

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

type SeedUser = {
  email: string;
  name: string;
  role: "user" | "instructor" | "admin";
  affiliation?: string;
  linkedin?: string;
};

const USERS = {
  // Original dev accounts — kept for backwards compatibility.
  student: {
    email: "user@example.com",
    name: "Dev User",
    role: "user",
    affiliation: "Oregon State University (CS, Senior)",
  },
  instructor: {
    email: "instructor@example.com",
    name: "Dev Instructor",
    role: "instructor",
    affiliation: "OSU School of EECS",
  },
  admin: {
    email: "admin@example.com",
    name: "Dev Admin",
    role: "admin",
    affiliation: "OSU Capstone Program Office",
  },
  // Faculty proposers.
  facultyKim: {
    email: "grace.kim@oregonstate.edu",
    name: "Dr. Grace Kim",
    role: "instructor",
    affiliation: "OSU School of EECS — Robotics & Vision Lab",
    linkedin: "https://www.linkedin.com/in/grace-kim-eecs",
  },
  facultyAlvarez: {
    email: "miguel.alvarez@oregonstate.edu",
    name: "Dr. Miguel Alvarez",
    role: "instructor",
    affiliation: "OSU School of EECS — Human-Computer Interaction",
    linkedin: "https://www.linkedin.com/in/miguel-alvarez-hci",
  },
  // Industry sponsors (external proposers, plain users).
  sponsorAcme: {
    email: "dana.whitfield@acmerobotics.com",
    name: "Dana Whitfield",
    role: "user",
    affiliation: "Acme Robotics — Warehouse Automation",
    linkedin: "https://www.linkedin.com/in/dana-whitfield",
  },
  sponsorNorthstar: {
    email: "priya.natarajan@northstar.io",
    name: "Priya Natarajan",
    role: "user",
    affiliation: "NorthStar Analytics — Platform Engineering",
    linkedin: "https://www.linkedin.com/in/priya-natarajan",
  },
  sponsorVitalink: {
    email: "evan.cho@vitalink.health",
    name: "Evan Cho",
    role: "user",
    affiliation: "VitaLink Health — Connected Devices",
    linkedin: "https://www.linkedin.com/in/evan-cho-vitalink",
  },
  // Student-led proposers.
  studentJordan: {
    email: "leej@oregonstate.edu",
    name: "Jordan Lee",
    role: "user",
    affiliation: "Oregon State University (CS, Senior)",
  },
  studentSam: {
    email: "riveras@oregonstate.edu",
    name: "Sam Rivera",
    role: "user",
    affiliation: "Oregon State University (CS, Senior)",
  },
} satisfies Record<string, SeedUser>;

/** Sign up (or find) a user, then force role + verified state. Returns the row. */
async function ensureUser(seed: SeedUser) {
  const [existing] = await db
    .select()
    .from(user)
    .where(eq(user.email, seed.email));
  if (existing) {
    await db
      .update(user)
      .set({
        role: seed.role,
        emailVerified: true,
        affiliation: seed.affiliation ?? existing.affiliation,
        linkedin: seed.linkedin ?? existing.linkedin,
      })
      .where(eq(user.id, existing.id));
    console.log(`user: ${seed.email} (exists, role=${seed.role})`);
    return { ...existing, role: seed.role };
  }
  const result = await auth.api.signUpEmail({
    body: { email: seed.email, password: PASSWORD, name: seed.name },
  });
  if (!result?.user) {
    console.error(`sign-up did not return a user for ${seed.email}`);
    process.exit(1);
  }
  await db
    .update(user)
    .set({
      role: seed.role,
      emailVerified: true,
      affiliation: seed.affiliation ?? null,
      linkedin: seed.linkedin ?? null,
    })
    .where(eq(user.id, result.user.id));
  console.log(`user: ${seed.email} (created, password=${PASSWORD})`);
  const [row] = await db.select().from(user).where(eq(user.id, result.user.id));
  return row;
}

// ---------------------------------------------------------------------------
// Programs (CS capstone sequence) and categories
// ---------------------------------------------------------------------------

const PROGRAMS = [
  {
    courseId: "CS 461",
    courseName: "Senior Software Engineering Project I",
    description:
      "Fall term. Teams of 3-4 students scope a year-long capstone, write requirements and design documents, and stand up project infrastructure.",
  },
  {
    courseId: "CS 462",
    courseName: "Senior Software Engineering Project II",
    description:
      "Winter term. Teams implement the core of their capstone, demo incremental progress, and conduct a midpoint review.",
  },
  {
    courseId: "CS 463",
    courseName: "Senior Software Engineering Project III",
    description:
      "Spring term. Teams finish, test, and present their capstone at Expo, delivering documentation and a maintainable handoff.",
  },
] as const;

async function ensureProgram(p: (typeof PROGRAMS)[number]) {
  const [existing] = await db
    .select()
    .from(programs)
    .where(eq(programs.courseId, p.courseId));
  if (existing) {
    console.log(`program: ${p.courseId} (exists)`);
    return existing;
  }
  const [row] = await db.insert(programs).values(p).returning();
  console.log(`program: ${p.courseId} (created)`);
  return row;
}

type Cat = { name: string; type: string };

const CATEGORIES: Cat[] = [
  // Sponsorship model.
  { name: "Industry Sponsored", type: "project_type" },
  { name: "Faculty Sponsored", type: "project_type" },
  { name: "Student Led", type: "project_type" },
  // Field.
  { name: "Web Development", type: "field" },
  { name: "Robotics", type: "field" },
  { name: "Data Science", type: "field" },
  { name: "AR / VR", type: "field" },
  { name: "IoT / Embedded", type: "field" },
  { name: "Mobile", type: "field" },
  { name: "Health Tech", type: "field" },
  // Technology.
  { name: "React", type: "technology" },
  { name: "Python", type: "technology" },
  { name: "C++ / Embedded", type: "technology" },
  { name: "Machine Learning", type: "technology" },
  { name: "Unity / VR", type: "technology" },
  { name: "AWS Cloud", type: "technology" },
  { name: "React Native", type: "technology" },
];

async function ensureCategory(c: Cat) {
  const [existing] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.name, c.name), eq(categories.type, c.type)));
  if (existing) return existing;
  const [row] = await db.insert(categories).values(c).returning();
  return row;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Users.
  const u = {} as Record<keyof typeof USERS, Awaited<ReturnType<typeof ensureUser>>>;
  for (const key of Object.keys(USERS) as (keyof typeof USERS)[]) {
    u[key] = await ensureUser(USERS[key]);
  }

  // Programs.
  const [p461, p462, p463] = await Promise.all(PROGRAMS.map(ensureProgram));
  // Wire faculty + admin as program instructors so the manager dropdowns are populated.
  for (const prog of [p461, p462, p463]) {
    for (const uid of [u.instructor.id, u.facultyKim.id, u.facultyAlvarez.id]) {
      await db
        .insert(programInstructors)
        .values({ programId: prog.id, userId: uid })
        .onConflictDoNothing();
    }
  }
  console.log(`programs: ${[p461, p462, p463].length} linked to instructors`);

  // Categories (keyed by name for easy lookup below).
  const catRows = await Promise.all(CATEGORIES.map(ensureCategory));
  const cat = new Map(catRows.map((c) => [c.name, c.id]));
  console.log(`categories: ${catRows.length} ready`);

  const now = new Date();
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

  // Projects. Each is fully populated; categories[] are resolved by name.
  type SeedProject = {
    title: string;
    description: string;
    problemStatement: string;
    objectives: string;
    minQualifications: string;
    prefQualifications: string;
    url: string;
    contactEmail: string;
    contactName: string;
    imageUrl: string;
    licenseRestrictions: string;
    notes: string;
    proposerId: string;
    programId: string;
    programManagerId: string;
    status:
      | "draft"
      | "submitted"
      | "approved"
      | "changes_requested"
      | "published"
      | "archived";
    publishedAt: Date | null;
    categories: string[];
  };

  const PROJECTS: SeedProject[] = [
    {
      title: "Autonomous Warehouse Robot Fleet Coordinator",
      description:
        "Build a coordination service that dispatches and deconflicts a fleet of autonomous mobile robots (AMRs) moving inventory across a simulated warehouse floor. The team will work against Acme's ROS 2 simulator and deliver a scheduler plus a live operations dashboard.",
      problemStatement:
        "Acme's current warehouse robots plan paths independently, causing gridlock at aisle intersections and idle time near charging docks. There is no central view of fleet state, so operators cannot anticipate or resolve congestion.",
      objectives:
        "1. Design a central coordinator that assigns pick/drop tasks to robots.\n2. Implement intersection reservation and collision avoidance.\n3. Expose a real-time web dashboard of robot positions, battery, and task queues.\n4. Demonstrate a measurable throughput improvement over independent planning in the simulator.",
      minQualifications:
        "Comfortable with Python and basic data structures/algorithms; willing to learn ROS 2 fundamentals.",
      prefQualifications:
        "Exposure to robotics or path planning, concurrency, or WebSocket-based real-time UIs.",
      url: "https://github.com/acme-robotics/amr-fleet-capstone",
      contactEmail: USERS.sponsorAcme.email,
      contactName: USERS.sponsorAcme.name,
      imageUrl:
        "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?auto=format&fit=crop&w=1200&q=60",
      licenseRestrictions:
        "Team code released under MIT. Acme's proprietary simulator binaries are under NDA and must not be redistributed.",
      notes:
        "Sponsor can provide two AMR dev units on loan for spring term if the team reaches hardware integration.",
      proposerId: u.sponsorAcme.id,
      programId: p461.id,
      programManagerId: u.instructor.id,
      status: "published",
      publishedAt: daysAgo(40),
      categories: [
        "Industry Sponsored",
        "Robotics",
        "Python",
        "C++ / Embedded",
      ],
    },
    {
      title: "Real-Time Analytics Dashboard for IoT Sensor Networks",
      description:
        "Develop a streaming analytics platform that ingests telemetry from thousands of distributed IoT sensors, computes rolling aggregates, and renders an interactive dashboard with alerting. Deployed on AWS using a serverless ingestion pipeline.",
      problemStatement:
        "NorthStar's customers deploy large IoT fleets but rely on nightly batch reports. They need sub-minute visibility into anomalies (temperature spikes, dropped devices) to act before incidents escalate.",
      objectives:
        "1. Build an ingestion pipeline (Kinesis/Lambda) that handles bursty sensor traffic.\n2. Compute windowed aggregates and detect anomalies.\n3. Deliver a React dashboard with live charts and configurable alerts.\n4. Load-test to 10k events/sec and document cost per million events.",
      minQualifications:
        "JavaScript/TypeScript and React; basic understanding of REST and JSON.",
      prefQualifications:
        "AWS experience (Lambda, DynamoDB, Kinesis), time-series data, or WebSockets.",
      url: "https://northstar.io/capstone/iot-dashboard",
      contactEmail: USERS.sponsorNorthstar.email,
      contactName: USERS.sponsorNorthstar.name,
      imageUrl:
        "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1200&q=60",
      licenseRestrictions:
        "Apache-2.0. Sponsor requests attribution in the README and a short case-study writeup.",
      notes:
        "NorthStar will grant a sandbox AWS account with a monthly credit cap of $200.",
      proposerId: u.sponsorNorthstar.id,
      programId: p461.id,
      programManagerId: u.facultyAlvarez.id,
      status: "published",
      publishedAt: daysAgo(38),
      categories: [
        "Industry Sponsored",
        "Web Development",
        "React",
        "AWS Cloud",
        "IoT / Embedded",
      ],
    },
    {
      title: "ML-Powered Wildlife Camera-Trap Classifier",
      description:
        "Train and deploy a computer-vision model that classifies animal species in motion-triggered trail-camera images, then build a review tool so field researchers can correct labels and export datasets.",
      problemStatement:
        "The Robotics & Vision Lab collects millions of trail-camera images per season. Manual sorting takes graduate students hundreds of hours, and most frames are empty or contain common species.",
      objectives:
        "1. Curate and label a training set from existing camera-trap archives.\n2. Train a species classifier and an empty-frame filter.\n3. Build a human-in-the-loop web tool for verification and dataset export.\n4. Report precision/recall per species and processing throughput.",
      minQualifications:
        "Python; introductory machine learning or statistics coursework.",
      prefQualifications:
        "PyTorch/TensorFlow, transfer learning, data labeling pipelines, or image processing.",
      url: "https://eecs.oregonstate.edu/rvlab/cameratrap",
      contactEmail: USERS.facultyKim.email,
      contactName: USERS.facultyKim.name,
      imageUrl:
        "https://images.unsplash.com/photo-1564349683136-77e08dba1ef7?auto=format&fit=crop&w=1200&q=60",
      licenseRestrictions:
        "BSD-3-Clause. Image dataset is restricted to academic use under the lab's data-sharing agreement.",
      notes:
        "Dr. Kim can provide a labeled starter set (~5k images) and access to a lab GPU workstation.",
      proposerId: u.facultyKim.id,
      programId: p461.id,
      programManagerId: u.facultyKim.id,
      status: "published",
      publishedAt: daysAgo(35),
      categories: [
        "Faculty Sponsored",
        "Data Science",
        "Python",
        "Machine Learning",
      ],
    },
    {
      title: "VR Lab Safety Training Simulator",
      description:
        "Create an immersive VR experience that trains students on chemistry and engineering lab safety procedures, including hazard identification, correct PPE use, and emergency response, with scored scenarios for instructors.",
      problemStatement:
        "In-person lab safety orientations are inconsistent and hard to schedule at scale. Students often encounter hazards for the first time during real labs, raising risk and instructor workload.",
      objectives:
        "1. Build 3-4 interactive lab scenarios in Unity for Meta Quest.\n2. Implement scoring and a post-session report for instructors.\n3. Support hand-tracking interactions for PPE and equipment.\n4. Run a usability study with at least 8 students.",
      minQualifications:
        "C# or another C-family language; interest in 3D/game development.",
      prefQualifications:
        "Unity, VR development, 3D asset workflows, or UX research methods.",
      url: "https://eecs.oregonstate.edu/hci/vr-safety",
      contactEmail: USERS.facultyAlvarez.email,
      contactName: USERS.facultyAlvarez.name,
      imageUrl:
        "https://images.unsplash.com/photo-1622979135225-d2ba269cf1ac?auto=format&fit=crop&w=1200&q=60",
      licenseRestrictions:
        "MIT for code. Unity Asset Store assets remain under their original licenses and cannot be redistributed.",
      notes:
        "Two Meta Quest 3 headsets are reserved in inventory for this team during winter/spring.",
      proposerId: u.facultyAlvarez.id,
      programId: p461.id,
      programManagerId: u.facultyAlvarez.id,
      status: "approved",
      publishedAt: null,
      categories: ["Faculty Sponsored", "AR / VR", "Unity / VR"],
    },
    {
      title: "Campus Sustainability Tracker",
      description:
        "A student-initiated web and mobile app that gamifies sustainable habits on campus (transit, recycling, energy challenges) and visualizes aggregate impact for student organizations.",
      problemStatement:
        "Sustainability initiatives on campus are fragmented across departments with no shared way to track participation or celebrate progress, so student engagement stays low.",
      objectives:
        "1. Design a habit-tracking model with challenges and leaderboards.\n2. Build a React web app and a React Native companion.\n3. Aggregate anonymized impact metrics for org dashboards.\n4. Pilot with two student organizations and gather feedback.",
      minQualifications:
        "JavaScript/TypeScript and React fundamentals; Git workflow.",
      prefQualifications:
        "React Native, mobile UX, or experience shipping a side project.",
      url: "https://github.com/osu-students/sustainability-tracker",
      contactEmail: USERS.studentJordan.email,
      contactName: USERS.studentJordan.name,
      imageUrl:
        "https://images.unsplash.com/photo-1497436072909-60f360e1d4b1?auto=format&fit=crop&w=1200&q=60",
      licenseRestrictions:
        "GPL-3.0. Project is intended to remain open source and community-maintained after the capstone.",
      notes:
        "Student-led; the team is seeking a faculty advisor. Scope may need trimming to fit one year.",
      proposerId: u.studentJordan.id,
      programId: p461.id,
      programManagerId: u.instructor.id,
      status: "submitted",
      publishedAt: null,
      categories: ["Student Led", "Web Development", "React", "Mobile", "React Native"],
    },
    {
      title: "Edge AI Inference on Single-Board Computers",
      description:
        "Benchmark and optimize on-device deep-learning inference across single-board computers (Raspberry Pi 5, Jetson Orin Nano) and USB accelerators, then package a reusable deployment toolkit for low-power edge nodes.",
      problemStatement:
        "VitaLink wants to run inference on battery-powered field devices but lacks reliable guidance on which SBC + accelerator combinations meet latency and power budgets for their models.",
      objectives:
        "1. Build a reproducible benchmark harness across several SBCs and accelerators.\n2. Quantize and optimize a reference model for each target.\n3. Measure latency, throughput, and power draw.\n4. Ship a CLI toolkit and a decision guide for choosing hardware.",
      minQualifications:
        "Python; Linux command line; comfort flashing and configuring SBCs.",
      prefQualifications:
        "Embedded Linux, model quantization (TensorRT/TFLite), or hardware power measurement.",
      url: "https://vitalink.health/labs/edge-inference",
      contactEmail: USERS.sponsorVitalink.email,
      contactName: USERS.sponsorVitalink.name,
      imageUrl:
        "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=60",
      licenseRestrictions:
        "Apache-2.0 toolkit. Benchmark results may be published; VitaLink's proprietary model weights are confidential.",
      notes:
        "Hardware (Pi 5, Jetson Orin Nano, Coral accelerator) is available in inventory for checkout.",
      proposerId: u.sponsorVitalink.id,
      programId: p461.id,
      programManagerId: u.facultyKim.id,
      status: "published",
      publishedAt: daysAgo(20),
      categories: [
        "Industry Sponsored",
        "IoT / Embedded",
        "Machine Learning",
        "Python",
        "C++ / Embedded",
      ],
    },
    {
      title: "Accessible Course Scheduling Assistant",
      description:
        "Build a WCAG-compliant scheduling assistant that helps students plan degree-valid course schedules, with conflict detection, prerequisite checking, and screen-reader-first interaction design.",
      problemStatement:
        "Existing scheduling tools are difficult to use with assistive technology and do not surface prerequisite or time conflicts early, disproportionately burdening students who rely on screen readers.",
      objectives:
        "1. Model the course catalog, prerequisites, and term offerings.\n2. Implement conflict and prerequisite validation.\n3. Build a fully keyboard- and screen-reader-accessible React UI.\n4. Validate against WCAG 2.2 AA with automated and manual audits.",
      minQualifications:
        "React and TypeScript; semantic HTML.",
      prefQualifications:
        "Web accessibility (ARIA, screen readers), constraint solving, or design systems.",
      url: "https://eecs.oregonstate.edu/hci/a11y-scheduler",
      contactEmail: USERS.facultyAlvarez.email,
      contactName: USERS.facultyAlvarez.name,
      imageUrl:
        "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=1200&q=60",
      licenseRestrictions:
        "MIT. Course catalog data is public; no restrictions.",
      notes:
        "Strong fit for students interested in accessibility. Could integrate with the existing handbook site.",
      proposerId: u.facultyAlvarez.id,
      programId: p461.id,
      programManagerId: u.facultyAlvarez.id,
      status: "published",
      publishedAt: daysAgo(12),
      categories: ["Faculty Sponsored", "Web Development", "React"],
    },
    {
      title: "Open-Source Drone Telemetry Platform",
      description:
        "A student-led project to build an open telemetry and mission-planning platform for hobby drones: live flight data over MAVLink, a map-based ground station, and post-flight log analysis.",
      problemStatement:
        "Hobbyist drone telemetry is locked into closed apps tied to specific vendors. There is no friendly open-source ground station that works across common flight controllers.",
      objectives:
        "1. Ingest MAVLink telemetry over serial/UDP.\n2. Build a map-based ground station with live position and battery.\n3. Support waypoint mission planning and upload.\n4. Provide post-flight log parsing and charts.",
      minQualifications:
        "Python; basic networking concepts.",
      prefQualifications:
        "MAVLink/drones, mapping libraries (Leaflet/Mapbox), or real-time data streaming.",
      url: "https://github.com/osu-students/open-drone-telemetry",
      contactEmail: USERS.studentSam.email,
      contactName: USERS.studentSam.name,
      imageUrl:
        "https://images.unsplash.com/photo-1473968512647-3e447244af8f?auto=format&fit=crop&w=1200&q=60",
      licenseRestrictions:
        "GPL-3.0 to stay compatible with the broader MAVLink open-source ecosystem.",
      notes:
        "Draft proposal; the team still needs to confirm a faculty sponsor and a test drone (Tello EDU available in inventory).",
      proposerId: u.studentSam.id,
      programId: p461.id,
      programManagerId: u.instructor.id,
      status: "draft",
      publishedAt: null,
      categories: ["Student Led", "Robotics", "Python", "IoT / Embedded"],
    },
  ];

  let created = 0;
  for (const proj of PROJECTS) {
    const [existing] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.title, proj.title));
    if (existing) {
      console.log(`project: "${proj.title}" (exists)`);
      continue;
    }
    const { categories: catNames, ...values } = proj;
    const [row] = await db.insert(projects).values(values).returning({
      id: projects.id,
    });
    const categoryIds = catNames
      .map((name) => cat.get(name))
      .filter((id): id is string => Boolean(id));
    if (categoryIds.length > 0) {
      await db.insert(projectCategories).values(
        categoryIds.map((categoryId) => ({
          projectId: row.id,
          categoryId,
        })),
      );
    }
    created += 1;
    console.log(
      `project: "${proj.title}" (created, ${categoryIds.length} categories, status=${proj.status})`,
    );
  }
  console.log(`projects: ${created} created, ${PROJECTS.length} total defined`);

  // Inventory items. All fields populated. Holder fields set for held statuses.
  type SeedItem = {
    name: string;
    description: string;
    category: string;
    serial: string;
    location: string;
    notes: string;
    imageUrl: string;
    status:
      | "available"
      | "requested"
      | "reserved"
      | "checked_out"
      | "maintenance"
      | "retired";
    currentHolderId: string | null;
    currentHolderLabel: string | null;
  };

  const ITEMS: SeedItem[] = [
    {
      name: "Raspberry Pi 5 (8GB)",
      description:
        "Quad-core Arm Cortex-A76 single-board computer with 8GB RAM. Includes official 27W USB-C PSU, active cooler, and a 64GB microSD card preloaded with Raspberry Pi OS.",
      category: "Single-Board Computer",
      serial: "RPI5-8G-0001",
      location: "Kelley Engineering — Capstone Lab, Cabinet A, Bin 1",
      notes:
        "Heavily requested. Return with the original PSU and cooler attached.",
      imageUrl:
        "https://images.unsplash.com/photo-1610433572201-110753c6cff9?auto=format&fit=crop&w=1200&q=60",
      status: "available",
      currentHolderId: null,
      currentHolderLabel: null,
    },
    {
      name: "NVIDIA Jetson Orin Nano Developer Kit",
      description:
        "Edge-AI dev kit delivering up to 40 TOPS for on-device inference. Includes carrier board, power supply, and a preimaged microSD with JetPack.",
      category: "Single-Board Computer",
      serial: "JETSON-ORIN-N-0001",
      location: "Kelley Engineering — Capstone Lab, Cabinet A, Bin 2",
      notes:
        "Reserved for edge-AI capstones. Pair with the Coral accelerator for comparison benchmarks.",
      imageUrl:
        "https://images.unsplash.com/photo-1591799264318-7e6ef8ddb7ea?auto=format&fit=crop&w=1200&q=60",
      status: "available",
      currentHolderId: null,
      currentHolderLabel: null,
    },
    {
      name: "Meta Quest 3 (128GB)",
      description:
        "Standalone mixed-reality headset with color passthrough, two Touch Plus controllers, charging cable, and head strap. Developer mode enabled.",
      category: "VR / AR Headset",
      serial: "QUEST3-128-0007",
      location: "Kelley Engineering — HCI Lab, Locked Cabinet",
      notes:
        "Wipe guest data and sanitize the facial interface before returning.",
      imageUrl:
        "https://images.unsplash.com/photo-1622979135225-d2ba269cf1ac?auto=format&fit=crop&w=1200&q=60",
      status: "checked_out",
      currentHolderId: u.student.id,
      currentHolderLabel: "Dev User (CS 462 — VR Safety team)",
    },
    {
      name: "HTC Vive Pro 2 Kit",
      description:
        "Tethered PC-VR headset with 5K combined resolution, two base stations, and two controllers. Requires a VR-capable workstation.",
      category: "VR / AR Headset",
      serial: "VIVEPRO2-0002",
      location: "Kelley Engineering — HCI Lab, Shelf 3",
      notes:
        "Left controller tracking is intermittent; out for repair evaluation.",
      imageUrl:
        "https://images.unsplash.com/photo-1593508512255-86ab42a8e620?auto=format&fit=crop&w=1200&q=60",
      status: "maintenance",
      currentHolderId: null,
      currentHolderLabel: null,
    },
    {
      name: "Arduino Uno R4 WiFi",
      description:
        "Renesas RA4M1 microcontroller board with onboard ESP32-S3 Wi-Fi/Bluetooth and a 12x8 LED matrix. Includes USB-C cable.",
      category: "Microcontroller",
      serial: "ARD-UNOR4W-0014",
      location: "Kelley Engineering — Capstone Lab, Parts Drawer 4",
      notes: "Several units available; good for IoT prototyping.",
      imageUrl:
        "https://images.unsplash.com/photo-1553406830-ef2513450d76?auto=format&fit=crop&w=1200&q=60",
      status: "available",
      currentHolderId: null,
      currentHolderLabel: null,
    },
    {
      name: "ESP32-S3-DevKitC-1",
      description:
        "Dual-core Xtensa LX7 dev board with Wi-Fi and Bluetooth LE, USB-C, and 8MB flash. Ideal for low-cost connected sensors.",
      category: "Microcontroller",
      serial: "ESP32S3-DK-0031",
      location: "Kelley Engineering — Capstone Lab, Parts Drawer 5",
      notes: "Bulk stock; no need to reserve more than two per team.",
      imageUrl:
        "https://images.unsplash.com/photo-1608564697071-ddf911d81370?auto=format&fit=crop&w=1200&q=60",
      status: "available",
      currentHolderId: null,
      currentHolderLabel: null,
    },
    {
      name: "Intel RealSense Depth Camera D435i",
      description:
        "Stereo depth camera with an integrated IMU for robotics and 3D scanning. Includes USB-C cable and mounting tripod adapter.",
      category: "Sensor",
      serial: "RS-D435I-0005",
      location: "Kelley Engineering — Robotics & Vision Lab, Bin 7",
      notes: "Reserved for the warehouse robot fleet team's perception work.",
      imageUrl:
        "https://images.unsplash.com/photo-1527430253228-e93688616381?auto=format&fit=crop&w=1200&q=60",
      status: "reserved",
      currentHolderId: u.studentJordan.id,
      currentHolderLabel: "Jordan Lee (CS 461 — AMR Fleet team)",
    },
    {
      name: "Google Coral USB Accelerator",
      description:
        "Edge TPU coprocessor over USB-C providing fast, low-power TensorFlow Lite inference. Pairs with SBCs for accelerated on-device ML.",
      category: "AI Accelerator",
      serial: "CORAL-USB-0009",
      location: "Kelley Engineering — Capstone Lab, Cabinet A, Bin 3",
      notes: "Use with the Edge AI benchmarking project.",
      imageUrl:
        "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=60",
      status: "available",
      currentHolderId: null,
      currentHolderLabel: null,
    },
    {
      name: "DJI Tello EDU Drone",
      description:
        "Lightweight programmable quadcopter with a Python/Scratch SDK, 720p camera, and swarm support. Includes three batteries and a charging hub.",
      category: "Drone",
      serial: "TELLO-EDU-0003",
      location: "Kelley Engineering — Capstone Lab, Cabinet B (foam case)",
      notes:
        "Indoor flight only without instructor approval. Inspect props before each checkout.",
      imageUrl:
        "https://images.unsplash.com/photo-1473968512647-3e447244af8f?auto=format&fit=crop&w=1200&q=60",
      status: "available",
      currentHolderId: null,
      currentHolderLabel: null,
    },
    {
      name: "Logitech BRIO 4K Webcam",
      description:
        "4K UHD webcam with HDR and a wide field of view. Useful for computer-vision capture, demos, and remote Expo presentations. Includes clip mount and USB-C cable.",
      category: "Peripheral",
      serial: "BRIO-4K-0021",
      location: "Kelley Engineering — Capstone Lab, Cabinet A, Bin 4",
      notes: "Checked out for the camera-trap classifier team's demo rig.",
      imageUrl:
        "https://images.unsplash.com/photo-1587826080692-f439cd0b70da?auto=format&fit=crop&w=1200&q=60",
      status: "checked_out",
      currentHolderId: u.studentSam.id,
      currentHolderLabel: "Sam Rivera (CS 462 — Wildlife Classifier team)",
    },
  ];

  let itemsCreated = 0;
  for (const item of ITEMS) {
    const [existing] = await db
      .select({ id: inventoryItems.id })
      .from(inventoryItems)
      .where(eq(inventoryItems.serial, item.serial));
    if (existing) {
      console.log(`item: "${item.name}" (exists)`);
      continue;
    }
    await db.insert(inventoryItems).values(item);
    itemsCreated += 1;
    console.log(`item: "${item.name}" (created, status=${item.status})`);
  }
  console.log(`inventory: ${itemsCreated} created, ${ITEMS.length} total defined`);
}

main().then(() => process.exit(0));
