// The default project categories (#31). Client-safe and dependency-free: the
// dev seed reads it, and a parity test pins the data migration that put it in
// production, `drizzle/0043_default_categories.sql`, to this list.
//
// After that migration the live list belongs to staff, who edit it on
// `/admin/categories`. Changing a row here changes the seed and fails the
// parity test; it changes nothing in production without a new migration.

/**
 * The four facets, each stored as a category's `type` with exactly this
 * spelling. Every one is discipline-neutral, so another department adds
 * categories to Field and Industry rather than a facet, and none restates a
 * column on `projects` or the program (ADR-0021).
 *
 * - Field: what engineering area the work is in. One or two per project.
 * - Technology: what goes on a resume. At most two.
 * - Industry: who the result serves. At most two.
 * - Kind of work: how the year will run. Exactly one.
 */
export const FIELD_TYPE = "Field";
export const TECHNOLOGY_TYPE = "Technology";
export const INDUSTRY_TYPE = "Industry";
export const KIND_OF_WORK_TYPE = "Kind of work";

export const DEFAULT_CATEGORY_TYPES = [
  FIELD_TYPE,
  TECHNOLOGY_TYPE,
  INDUSTRY_TYPE,
  KIND_OF_WORK_TYPE,
] as const;

export type DefaultCategoryType = (typeof DEFAULT_CATEGORY_TYPES)[number];

export interface DefaultCategory {
  /**
   * One sentence, the definition a model is given when it picks categories.
   * The names a model misread when this list was evaluated were the
   * ambiguous ones, so the definitions are part of the list, not decoration.
   */
  description: string;
  name: string;
  type: DefaultCategoryType;
}

/**
 * Kind of work is listed in precedence order: the first that fits a project
 * wins, so a research prototype built for a competition is Competition.
 */
export const DEFAULT_CATEGORIES = [
  {
    type: FIELD_TYPE,
    name: "Web Development",
    description:
      "Web applications, sites and portals, and the back-end services and APIs a browser consumes.",
  },
  {
    type: FIELD_TYPE,
    name: "Game Development",
    description:
      "Video games and game mechanics, including gamified experiences built as games.",
  },
  {
    type: FIELD_TYPE,
    name: "Mobile Apps",
    description: "Native or cross-platform apps for phones and tablets.",
  },
  {
    type: FIELD_TYPE,
    name: "Machine Learning",
    description:
      "Training, evaluating or applying learned models, such as classifiers, predictors, reinforcement learning, or the evaluation and fine-tuning of language models.",
  },
  {
    type: FIELD_TYPE,
    name: "Embedded Systems",
    description:
      "Firmware and software running on microcontrollers or single-board computers, including IoT devices.",
  },
  {
    type: FIELD_TYPE,
    name: "Computer Vision",
    description:
      "Understanding images or video, such as detection, tracking, pose estimation or 3D reconstruction from cameras.",
  },
  {
    type: FIELD_TYPE,
    name: "Data & Visualization",
    description:
      "Data pipelines, databases, analytics and dashboards, where the data work is the substance of the project.",
  },
  {
    type: FIELD_TYPE,
    name: "Robotics & Controls",
    description:
      "Robots, drones, rovers and autonomous vehicles, and the feedback control systems that drive them, from perception to actuation.",
  },
  {
    type: FIELD_TYPE,
    name: "Geospatial & Mapping",
    description:
      "Maps, GIS, satellite or aerial imagery and other location data, where position on the earth is central to the work.",
  },
  {
    type: FIELD_TYPE,
    name: "Circuit & PCB Design",
    description:
      "Designing analog or mixed-signal circuits and printed circuit boards.",
  },
  {
    type: FIELD_TYPE,
    name: "Signal Processing",
    description:
      "Processing audio, acoustic, sonar, radio or sensor signals, digitally or in analog hardware.",
  },
  {
    type: FIELD_TYPE,
    name: "UX Design",
    description:
      "User research, interaction design, prototyping and usability testing, where the design of how people use the product is a main deliverable.",
  },
  {
    type: FIELD_TYPE,
    name: "Graphics & Simulation",
    description:
      "Rendering, real-time graphics, and software that simulates physics or a process.",
  },
  {
    type: FIELD_TYPE,
    name: "AR / VR",
    description:
      "Virtual, augmented or mixed reality experiences and headset software.",
  },
  {
    type: FIELD_TYPE,
    name: "Cybersecurity",
    description:
      "Security analysis, malware, cryptography, secure storage and vulnerability research.",
  },
  {
    type: FIELD_TYPE,
    name: "Systems Software",
    description:
      "Operating systems, compilers, programming languages, emulators, runtimes and virtualization.",
  },
  {
    type: FIELD_TYPE,
    name: "Communications & RF",
    description:
      "Wireless links, radios, antennas, telemetry, GNSS and satellite data links.",
  },
  {
    type: FIELD_TYPE,
    name: "Mechanical Design",
    description:
      "Designing the physical parts of a device, such as enclosures, mechanisms and structures, through CAD and fabrication.",
  },
  {
    type: FIELD_TYPE,
    name: "Cloud & DevOps",
    description:
      "Cloud infrastructure, deployment, containers, CI/CD and scaling services.",
  },
  {
    type: FIELD_TYPE,
    name: "Developer Tools",
    description:
      "Tools for programmers, such as code assistants, IDE features, testing, and code analysis or migration.",
  },
  {
    type: FIELD_TYPE,
    name: "Power Electronics",
    description:
      "Power conversion, battery charging and management, motor drives and grid-tied electronics.",
  },
  {
    type: FIELD_TYPE,
    name: "Sensors & Instrumentation",
    description:
      "Measurement hardware: designing sensors, detectors, analyzers and test instruments.",
  },
  {
    type: FIELD_TYPE,
    name: "Devices & Materials",
    description:
      "Semiconductor devices, fabrication processes, electronic materials and coatings.",
  },
  {
    type: FIELD_TYPE,
    name: "Digital Design & FPGA",
    description:
      "Digital logic in HDL for FPGAs or ASICs, VLSI design, and chip-design tooling.",
  },
  {
    type: TECHNOLOGY_TYPE,
    name: "Python",
    description:
      "The Python language, for scripting, data work, machine learning or back ends.",
  },
  {
    type: TECHNOLOGY_TYPE,
    name: "LLMs",
    description:
      "Building on large language models or agents, such as OpenAI, Claude, Gemini or Llama models, or retrieval-augmented generation.",
  },
  {
    type: TECHNOLOGY_TYPE,
    name: "JavaScript / TypeScript",
    description: "JavaScript or TypeScript, in the browser or on Node.js.",
  },
  {
    type: TECHNOLOGY_TYPE,
    name: "C / C++",
    description:
      "The C or C++ language, for systems, embedded or performance-critical code.",
  },
  {
    type: TECHNOLOGY_TYPE,
    name: "SQL",
    description:
      "Relational databases, such as PostgreSQL, MySQL, SQLite or SQL Server.",
  },
  {
    type: TECHNOLOGY_TYPE,
    name: "Flutter / React Native",
    description:
      "The cross-platform mobile frameworks Flutter or React Native.",
  },
  {
    type: TECHNOLOGY_TYPE,
    name: "Unity",
    description: "The Unity game engine.",
  },
  {
    type: TECHNOLOGY_TYPE,
    name: "React",
    description: "The React library, for web front ends.",
  },
  {
    type: TECHNOLOGY_TYPE,
    name: "Angular",
    description: "The Angular framework, for web front ends.",
  },
  {
    type: TECHNOLOGY_TYPE,
    name: "PyTorch / TensorFlow",
    description: "The deep learning frameworks PyTorch or TensorFlow.",
  },
  {
    type: TECHNOLOGY_TYPE,
    name: "ROS",
    description: "The Robot Operating System, ROS or ROS 2.",
  },
  {
    type: TECHNOLOGY_TYPE,
    name: "AWS",
    description:
      "Amazon Web Services, as the platform the project is built or deployed on.",
  },
  {
    type: TECHNOLOGY_TYPE,
    name: "C#",
    description: "The C# language, including .NET applications.",
  },
  {
    type: TECHNOLOGY_TYPE,
    name: "Godot",
    description: "The Godot game engine.",
  },
  {
    type: INDUSTRY_TYPE,
    name: "Education",
    description:
      "Teaching and learning tools for any level, from K-12 to university and professional training.",
  },
  {
    type: INDUSTRY_TYPE,
    name: "Media & Entertainment",
    description:
      "Film, music, broadcast, media monitoring and entertainment venues.",
  },
  {
    type: INDUSTRY_TYPE,
    name: "Environment & Sustainability",
    description: "Ecology, wildlife, water, climate, conservation and waste.",
  },
  {
    type: INDUSTRY_TYPE,
    name: "Healthcare",
    description:
      "Medicine, nursing, pharmacy, mental health and clinical care, and education in them.",
  },
  {
    type: INDUSTRY_TYPE,
    name: "Agriculture & Food",
    description: "Farming, crops, livestock, irrigation and food production.",
  },
  {
    type: INDUSTRY_TYPE,
    name: "Marine & Ocean",
    description: "Oceans, coasts, marine life and underwater systems.",
  },
  {
    type: INDUSTRY_TYPE,
    name: "Sports & Recreation",
    description: "Athletics, fitness, clubs and outdoor recreation.",
  },
  {
    type: INDUSTRY_TYPE,
    name: "Aerospace & Space",
    description: "Aircraft, rockets, satellites and planetary rovers.",
  },
  {
    type: INDUSTRY_TYPE,
    name: "Energy",
    description:
      "Electric power, renewables, nuclear power, and batteries at grid or vehicle scale.",
  },
  {
    type: INDUSTRY_TYPE,
    name: "Accessibility",
    description:
      "Tools for people with disabilities affecting vision, hearing, mobility or cognition.",
  },
  {
    type: INDUSTRY_TYPE,
    name: "Forestry & Wood Products",
    description: "Forests and their management, timber and wood products.",
  },
  {
    type: INDUSTRY_TYPE,
    name: "Transportation",
    description: "Vehicles, driving, traffic, cycling and rail.",
  },
  {
    type: INDUSTRY_TYPE,
    name: "Community & Nonprofit",
    description:
      "Volunteering, civic and public-sector services, and social good.",
  },
  {
    type: INDUSTRY_TYPE,
    name: "Manufacturing & Industry",
    description:
      "Factories, industrial operations, operator training and regulated industrial processes.",
  },
  {
    type: INDUSTRY_TYPE,
    name: "Finance",
    description: "Trading, banking and personal finance.",
  },
  {
    type: KIND_OF_WORK_TYPE,
    name: "Competition",
    description: "Built for an external competition or a competition team.",
  },
  {
    type: KIND_OF_WORK_TYPE,
    name: "Research",
    description:
      "A research group owns the question, and the deliverable is a result or a research prototype, not a product for users.",
  },
  {
    type: KIND_OF_WORK_TYPE,
    name: "Existing System",
    description:
      "The team's code goes into a codebase, product or device that already exists, including a rewrite of one, though a new app that only reads a sponsor's API is New Build.",
  },
  {
    type: KIND_OF_WORK_TYPE,
    name: "New Build",
    description:
      "Anything else built from scratch, such as a product, app, game or device.",
  },
] as const satisfies readonly DefaultCategory[];

export type DefaultCategoryName = (typeof DEFAULT_CATEGORIES)[number]["name"];
